import type { DefinitionEntry, DefinitionResult } from '@boggle/shared';

import { lookupLocal } from './definitions-local.js';
import { getSpellingIndex } from './dictionary.js';

/**
 * Definitions drawn from the French Wiktionary.
 *
 * Three obstacles, all handled here:
 *
 * 1. There is no usable definition API: the REST endpoint
 *    `/page/definition/` answers 501 on fr.wiktionary. So we go through
 *    `action=query&prop=extracts`, which returns the page as plain text, and
 *    pull the first definition out of it.
 * 2. Our words have lost their accents, as the rules demand, while Wiktionary
 *    indexes them accented: `getSpellingIndex()` gives the real spellings back.
 * 3. Inflected forms, which make up most of a grid's solutions, carry no
 *    definition but a pointer ("... du verbe bouder"). We then follow the lemma
 *    to fetch the real definition.
 */

const API = 'https://fr.wiktionary.org/w/api.php';
const USER_AGENT =
  'boggle-multiplayer/1.0 (https://github.com/AltarBeastiful/boggle-multiplayer)';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;
/**
 * Wiktionary is a free service, so we stay discreet. But a word with several
 * spellings ("pommes", "pommés"), each needing a second call to its lemma, made
 * a cap of 4 serialise the lookup into two waves and double the delay. Eight
 * stays negligible for the API and removes that wait.
 */
const MAX_CONCURRENT = 8;

// -- grammatical sections ----------------------------------------------------

/** Sections carrying a real definition. */
const REAL_POS =
  /^(Nom commun|Nom propre|Verbe|Adjectif[^\n]*|Adverbe[^\n]*|Interjection|Préposition|Conjonction[^\n]*|Pronom[^\n]*|Article[^\n]*|Locution[^\n]*|Symbole|Onomatopée)$/;
/** Pointer sections: "Forme de verbe", "Forme d'adjectif" and so on. */
const FORM_POS = /^Forme d/;

/**
 * Lines to skip before the definition: inflection-table headers
 * ("Singulier Pluriel") and pronunciation lines ("mot \mo\ masculin").
 *
 * Anchoring the end is essential: "Pluriel de uropode." opens with a table word
 * yet is the definition of a plural form, and therefore of half a grid's
 * solutions.
 */
const TABLE_WORDS = 'Singulier|Pluriel|Masculin|Féminin|Invariable';
const TABLE_LINE = new RegExp(`^(?:${TABLE_WORDS})(?:\\s+(?:${TABLE_WORDS}))*$`);
const PRONUNCIATION = /\\[^\\]+\\/;

function isNoise(line: string): boolean {
  return TABLE_LINE.test(line) || PRONUNCIATION.test(line);
}

/** Senses returned per spelling, matching the bundled file. */
const MAX_SENSES = 3;

interface ParsedSection {
  partOfSpeech: string;
  definitions: string[];
}

/** Splits the "== Français ==" section into grammatical sections. */
function parseFrenchSections(extract: string): ParsedSection[] {
  const french = /^== Français ==$([\s\S]*?)(?=^== [^=]+ ==$|$(?![\s\S]))/m.exec(extract);
  if (!french?.[1]) return [];

  const sections: ParsedSection[] = [];
  const pattern = /^=== ([^=\n]+) ===$([\s\S]*?)(?=^=== |$(?![\s\S]))/gm;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(french[1])) !== null) {
    const partOfSpeech = (match[1] ?? '').trim();
    const lines = (match[2] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    // The first line is the headword ("chien \ʃjɛ̃\ masculin"); the senses are
    // the useful lines that follow, main one first.
    const definitions = lines.slice(1).filter((line) => !isNoise(line)).slice(0, MAX_SENSES);
    if (definitions.length > 0) sections.push({ partOfSpeech, definitions });
  }
  return sections;
}

/**
 * Finds the lemma named by a "Forme de ..." section. These pointers always end
 * on the word they target, whatever the wording:
 *   "... du passé simple de bouder."        -> bouder
 *   "... du passé simple du verbe bouder."  -> bouder
 *   "Pluriel de uropode."                   -> uropode
 * Taking the last word therefore covers all three phrasings.
 */
function extractLemma(definition: string): string | null {
  const cleaned = definition.trim().replace(/[.\s]+$/, '');
  const match = /([\p{L}][\p{L}’'-]*)$/u.exec(cleaned);
  const lemma = match?.[1];
  if (!lemma || lemma.length < 2) return null;
  // A pointer ends on a word, not on a grammatical category.
  if (/^(verbe|singulier|pluriel|masculin|féminin|présent|passé|futur)$/i.test(lemma)) return null;
  return lemma;
}

// -- network calls -----------------------------------------------------------

let inFlight = 0;
const queue: Array<() => void> = [];

/** Small semaphore: never more than MAX_CONCURRENT outbound requests. */
async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  inFlight++;
  try {
    return await run();
  } finally {
    inFlight--;
    queue.shift()?.();
  }
}

async function fetchExtract(title: string): Promise<string | null> {
  const url = `${API}?action=query&prop=extracts&explaintext=1&format=json&redirects=1&titles=${encodeURIComponent(title)}`;
  try {
    const response = await withSlot(() =>
      fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      query?: { pages?: Record<string, { extract?: string; missing?: unknown }> };
    };
    const pages = Object.values(payload.query?.pages ?? {});
    const page = pages[0];
    if (!page || 'missing' in page) return null;
    return page.extract ?? null;
  } catch {
    // Network down, timeout, unexpected JSON: the game carries on without a definition.
    return null;
  }
}

/** Definition of one precise spelling, following the lemma when needed. */
async function lookupSpelling(spelling: string): Promise<DefinitionEntry | null> {
  const extract = await fetchExtract(spelling);
  if (!extract) return null;

  const sections = parseFrenchSections(extract);
  if (sections.length === 0) return null;

  const direct = sections.find((section) => REAL_POS.test(section.partOfSpeech));
  if (direct) {
    return { spelling, partOfSpeech: direct.partOfSpeech, definitions: direct.definitions };
  }

  const form = sections.find((section) => FORM_POS.test(section.partOfSpeech));
  if (!form) return null;

  const first = form.definitions[0] ?? '';
  const lemma = extractLemma(first);
  if (!lemma || lemma.toLowerCase() === spelling.toLowerCase()) {
    return { spelling, partOfSpeech: form.partOfSpeech, definitions: form.definitions };
  }

  const lemmaExtract = await fetchExtract(lemma);
  const lemmaSection = lemmaExtract
    ? parseFrenchSections(lemmaExtract).find((section) => REAL_POS.test(section.partOfSpeech))
    : undefined;

  if (!lemmaSection) {
    return { spelling, partOfSpeech: form.partOfSpeech, definitions: form.definitions };
  }
  return {
    spelling,
    partOfSpeech: lemmaSection.partOfSpeech,
    definitions: lemmaSection.definitions,
    lemma,
  };
}

// -- cache -------------------------------------------------------------------

const cache = new Map<string, { value: DefinitionResult; expires: number }>();
const pending = new Map<string, Promise<DefinitionResult>>();

function readCache(word: string): DefinitionResult | null {
  const hit = cache.get(word);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(word);
    return null;
  }
  // Move to the end of the Map, so the oldest entries are evicted first.
  cache.delete(word);
  cache.set(word, hit);
  return hit.value;
}

function writeCache(word: string, value: DefinitionResult): void {
  cache.set(word, { value, expires: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Definitions of a normalised word, in capitals and without accents.
 *
 * The bundled file is consulted first; Wiktionary only serves as a fallback,
 * for words it does not cover or when no file is shipped. Never rejects: a
 * missing definition is an empty result.
 */
export async function getDefinition(normalized: string): Promise<DefinitionResult> {
  const word = normalized.toUpperCase();

  const local = lookupLocal(word);
  if (local && local.length > 0) return { word, entries: local, source: 'local' };

  const cached = readCache(word);
  if (cached) return cached;

  const running = pending.get(word);
  if (running) return running;

  const task = (async (): Promise<DefinitionResult> => {
    // Possible spellings: "COTE" -> cote, coté, côte, côté.
    // The unaccented form goes first: it usually exists too, and is generally
    // the one the player had in mind (portes rather than portés).
    const spellings = [...new Set([word.toLowerCase(), ...(getSpellingIndex().get(word) ?? [])])];
    const found = await Promise.all(spellings.slice(0, 4).map((spelling) => lookupSpelling(spelling)));
    const entries = found.filter((entry): entry is DefinitionEntry => entry !== null);
    const result: DefinitionResult = { word, entries, source: 'wiktionary' };
    writeCache(word, result);
    return result;
  })().finally(() => pending.delete(word));

  pending.set(word, task);
  return task;
}

export function definitionCacheSize(): number {
  return cache.size;
}
