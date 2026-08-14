import type { DefinitionEntry, DefinitionResult } from '@boggle/shared';

import { getSpellingIndex } from './dictionary.js';

/**
 * Définitions tirées du Wiktionnaire francophone.
 *
 * Trois difficultés, traitées ici :
 *
 * 1. Il n'existe pas d'API de définition exploitable : l'endpoint REST
 *    `/page/definition/` répond 501 sur fr.wiktionary. On passe donc par
 *    `action=query&prop=extracts`, qui renvoie la page en texte brut, et on
 *    en extrait la première définition.
 * 2. Nos mots ont perdu leurs accents (règle du jeu) alors que le Wiktionnaire
 *    les indexe accentués : `getSpellingIndex()` redonne les graphies réelles.
 * 3. Les formes fléchies, qui font l'essentiel des solutions d'une grille, ne portent
 *    pas de définition mais un renvoi (« ... du verbe bouder »). On suit alors
 *    le lemme pour aller chercher la vraie définition.
 */

const API = 'https://fr.wiktionary.org/w/api.php';
const USER_AGENT =
  'boggle-multiplayer/1.0 (https://github.com/AltarBeastiful/boggle-multiplayer)';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;
/** Le Wiktionnaire est un service gratuit : on reste discret. */
const MAX_CONCURRENT = 4;

// -- sections grammaticales --------------------------------------------------

/** Sections qui portent une vraie définition. */
const REAL_POS =
  /^(Nom commun|Nom propre|Verbe|Adjectif[^\n]*|Adverbe[^\n]*|Interjection|Préposition|Conjonction[^\n]*|Pronom[^\n]*|Article[^\n]*|Locution[^\n]*|Symbole|Onomatopée)$/;
/** Sections de renvoi : « Forme de verbe », « Forme d'adjectif »… (de / d' / d’) */
const FORM_POS = /^Forme d/;

/**
 * Lignes à sauter avant la définition : en-têtes de tableaux de flexion
 * (« Singulier Pluriel ») et lignes de prononciation (« mot \mo\ masculin »).
 *
 * L'ancrage de fin est indispensable : « Pluriel de uropode. » commence par un
 * mot de tableau mais c'est bien la définition d'une forme au pluriel, donc de
 * la moitié des solutions d'une grille.
 */
const TABLE_WORDS = 'Singulier|Pluriel|Masculin|Féminin|Invariable';
const TABLE_LINE = new RegExp(`^(?:${TABLE_WORDS})(?:\\s+(?:${TABLE_WORDS}))*$`);
const PRONUNCIATION = /\\[^\\]+\\/;

function isNoise(line: string): boolean {
  return TABLE_LINE.test(line) || PRONUNCIATION.test(line);
}

interface ParsedSection {
  partOfSpeech: string;
  definition: string;
}

/** Découpe la section « == Français == » en sections grammaticales. */
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
    // La première ligne est la vedette (« chien \ʃjɛ̃\ masculin ») : la
    // définition est la première ligne utile qui suit.
    const definition = lines.slice(1).find((line) => !isNoise(line));
    if (definition) sections.push({ partOfSpeech, definition });
  }
  return sections;
}

/**
 * Retrouve le lemme cité par une section « Forme de ... ». Ces renvois se
 * terminent toujours par le mot visé, quelle que soit la tournure :
 *   « ... du passé simple de bouder. »        -> bouder
 *   « ... du passé simple du verbe bouder. »  -> bouder
 *   « Pluriel de uropode. »                   -> uropode
 * On prend donc le dernier mot, ce qui couvre les trois formulations.
 */
function extractLemma(definition: string): string | null {
  const cleaned = definition.trim().replace(/[.\s]+$/, '');
  const match = /([\p{L}][\p{L}’'-]*)$/u.exec(cleaned);
  const lemma = match?.[1];
  if (!lemma || lemma.length < 2) return null;
  // Un renvoi se termine par un mot, pas par une catégorie grammaticale.
  if (/^(verbe|singulier|pluriel|masculin|féminin|présent|passé|futur)$/i.test(lemma)) return null;
  return lemma;
}

// -- appels réseau -----------------------------------------------------------

let inFlight = 0;
const queue: Array<() => void> = [];

/** Petit sémaphore : jamais plus de MAX_CONCURRENT requêtes sortantes. */
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
    // Réseau coupé, délai dépassé, JSON inattendu : le jeu continue sans définition.
    return null;
  }
}

/** Définition d'une graphie précise, en suivant le lemme si nécessaire. */
async function lookupSpelling(spelling: string): Promise<DefinitionEntry | null> {
  const extract = await fetchExtract(spelling);
  if (!extract) return null;

  const sections = parseFrenchSections(extract);
  if (sections.length === 0) return null;

  const direct = sections.find((section) => REAL_POS.test(section.partOfSpeech));
  if (direct) {
    return { spelling, partOfSpeech: direct.partOfSpeech, definition: direct.definition };
  }

  const form = sections.find((section) => FORM_POS.test(section.partOfSpeech));
  if (!form) return null;

  const lemma = extractLemma(form.definition);
  if (!lemma || lemma.toLowerCase() === spelling.toLowerCase()) {
    return { spelling, partOfSpeech: form.partOfSpeech, definition: form.definition };
  }

  const lemmaExtract = await fetchExtract(lemma);
  const lemmaSection = lemmaExtract
    ? parseFrenchSections(lemmaExtract).find((section) => REAL_POS.test(section.partOfSpeech))
    : undefined;

  if (!lemmaSection) {
    return { spelling, partOfSpeech: form.partOfSpeech, definition: form.definition };
  }
  return {
    spelling,
    partOfSpeech: lemmaSection.partOfSpeech,
    definition: lemmaSection.definition,
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
  // Remise en fin de Map : les entrées les plus anciennes sortent en premier.
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
 * Définitions d'un mot normalisé (majuscules, sans accents).
 * Ne rejette jamais : une absence de définition est un résultat vide.
 */
export async function getDefinition(normalized: string): Promise<DefinitionResult> {
  const word = normalized.toUpperCase();

  const cached = readCache(word);
  if (cached) return cached;

  const running = pending.get(word);
  if (running) return running;

  const task = (async (): Promise<DefinitionResult> => {
    // Graphies possibles : « COTE » -> cote, coté, côte, côté.
    // La forme sans accent passe en premier : elle existe souvent aussi, et
    // c'est généralement celle que le joueur avait en tête (portes / portés).
    const spellings = [...new Set([word.toLowerCase(), ...(getSpellingIndex().get(word) ?? [])])];
    const found = await Promise.all(spellings.slice(0, 4).map((spelling) => lookupSpelling(spelling)));
    const entries = found.filter((entry): entry is DefinitionEntry => entry !== null);
    const result: DefinitionResult = { word, entries };
    writeCache(word, result);
    return result;
  })().finally(() => pending.delete(word));

  pending.set(word, task);
  return task;
}

export function definitionCacheSize(): number {
  return cache.size;
}
