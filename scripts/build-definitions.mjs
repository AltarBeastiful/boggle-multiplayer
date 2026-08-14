#!/usr/bin/env node
/**
 * Construit le fichier de définitions embarquées (option C).
 *
 *   node scripts/build-definitions.mjs
 *
 * Deux sources, toutes deux libres :
 *
 * - **kaikki.org**, l'extraction du Wiktionnaire francophone par wiktextract,
 *   déjà analysée. Le champ `form_of` donne le lemme explicitement, ce que la
 *   recherche en direct devait deviner au dernier mot d'une phrase.
 * - **Lexique 3.83**, les fréquences d'usage réelles (occurrences par million,
 *   sous-titres de films et livres). Elles servent à classer les homographes :
 *   pour COTE, « côté » doit passer avant « coté », ce qu'aucune heuristique de
 *   forme ne peut deviner.
 *
 * Aucun des deux fichiers n'est décompressé sur disque : lecture en flux.
 *
 * Sortie : server/data/definitions.tsv.gz, **une ligne par sens**
 *   FORME_NORMALISEE \t nature \t graphie \t lemme \t définition
 *
 * Contenu sous CC BY-SA 4.0, voir server/data/LICENCE-DEFINITIONS.md
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

import { buildDictionary, normalizeWord } from '@boggle/shared';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(resolve(root, 'server/package.json'));

const WIKT_URL = 'https://kaikki.org/dictionary/downloads/fr/fr-extract.jsonl.gz';
const LEXIQUE_URL = 'http://www.lexique.org/databases/Lexique383/Lexique383.tsv';
const USER_AGENT = 'boggle-multiplayer/1.0 (https://github.com/AltarBeastiful/boggle-multiplayer)';

const WORK_DIR = process.env.BOGGLE_WORK_DIR ?? resolve(root, '.work');
const WIKT_FILE = resolve(WORK_DIR, 'fr-extract.jsonl.gz');
const LEXIQUE_FILE = resolve(WORK_DIR, 'Lexique383.tsv');
const OUT_FILE = resolve(root, 'server/data/definitions.tsv.gz');

/** Une définition plus longue relève de l'encyclopédie, pas du jeu. */
const MAX_DEFINITION = 400;
/** Sens conservés par graphie. Au-delà, on encombre plus qu'on n'informe. */
const MAX_SENSES = 3;
/** Graphies conservées par forme normalisée. */
const MAX_SPELLINGS = 4;

const log = (message) => console.log(`[définitions] ${message}`);

// ---------------------------------------------------------------------------

async function download(url, target, minSize) {
  mkdirSync(WORK_DIR, { recursive: true });
  if (existsSync(target) && statSync(target).size > minSize) {
    log(`déjà présent : ${target.split('/').pop()} (${(statSync(target).size / 1e6).toFixed(0)} Mo)`);
    return;
  }

  log(`téléchargement de ${url}`);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok || !response.body) throw new Error(`téléchargement impossible : ${response.status}`);

  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let lastLogged = 0;
  const progress = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length;
      if (received - lastLogged > 100_000_000) {
        lastLogged = received;
        log(`  ${(received / 1e6).toFixed(0)} Mo${total ? ` (${((received / total) * 100).toFixed(0)} %)` : ''}`);
      }
      controller.enqueue(chunk);
    },
  });

  await pipeline(response.body.pipeThrough(progress), createWriteStream(target));
  log(`téléchargé : ${(statSync(target).size / 1e6).toFixed(0)} Mo`);
}

/**
 * Fréquence d'usage par graphie, en occurrences par million.
 * Une même graphie apparaît plusieurs fois (par lemme et catégorie) : on garde
 * la plus élevée, celle de l'emploi le plus courant.
 */
async function loadFrequencies() {
  const frequencies = new Map();
  const lines = createInterface({ input: createReadStream(LEXIQUE_FILE), crlfDelay: Infinity });
  let first = true;
  for await (const line of lines) {
    if (first) {
      first = false;
      continue;
    }
    const columns = line.split('\t');
    const ortho = columns[0];
    if (!ortho) continue;
    const films = Number.parseFloat(columns[8] ?? '0') || 0;
    const books = Number.parseFloat(columns[9] ?? '0') || 0;
    const score = films + books;
    const known = frequencies.get(ortho);
    if (known === undefined || score > known) frequencies.set(ortho, score);
  }
  return frequencies;
}

async function forEachFrenchEntry(onEntry) {
  const lines = createInterface({
    input: createReadStream(WIKT_FILE).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let seen = 0;
  for await (const line of lines) {
    if (line.length < 2 || line[0] !== '{') continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    seen++;
    // Le fichier couvre toutes les langues décrites par le Wiktionnaire francophone.
    if (entry.lang_code === 'fr') onEntry(entry);
  }
  return seen;
}

function cleanDefinition(text) {
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= MAX_DEFINITION) return cleaned;
  const cut = cleaned.slice(0, MAX_DEFINITION);
  const stop = cut.lastIndexOf('. ');
  return (stop > MAX_DEFINITION / 2 ? cut.slice(0, stop + 1) : cut).trim() + '…';
}

/** Les sens propres d'une entrée (hors renvois), le principal en premier. */
function ownSenses(entry) {
  const senses = [];
  for (const sense of entry.senses ?? []) {
    if (sense.form_of || sense.alt_of) continue;
    const gloss = sense.glosses?.[0];
    if (!gloss) continue;
    const definition = cleanDefinition(gloss);
    if (!senses.includes(definition)) senses.push(definition);
    if (senses.length >= MAX_SENSES) break;
  }
  return senses;
}

/** Premier sens qui renvoie vers un lemme. */
function formSense(entry) {
  for (const sense of entry.senses ?? []) {
    const target = sense.form_of?.[0]?.word ?? sense.alt_of?.[0]?.word;
    if (target) return { lemma: String(target), gloss: sense.glosses?.[0] ?? null };
  }
  return null;
}

// ---------------------------------------------------------------------------

async function main() {
  await download(WIKT_URL, WIKT_FILE, 600_000_000);
  await download(LEXIQUE_URL, LEXIQUE_FILE, 20_000_000);

  log('chargement des fréquences d’usage (Lexique 3.83)');
  const frequencies = await loadFrequencies();
  log(`${frequencies.size} graphies avec fréquence connue`);

  log('chargement du dictionnaire du jeu');
  const dictionary = buildDictionary(require('an-array-of-french-words'));
  log(`${dictionary.size} mots jouables`);

  // -- passe 1 : les sens des lemmes ----------------------------------------
  log('passe 1/2 : sens des lemmes');
  const lemmaDefs = new Map();
  const totalRead = await forEachFrenchEntry((entry) => {
    const senses = ownSenses(entry);
    if (senses.length === 0) return;
    const word = String(entry.word ?? '');
    if (!word || lemmaDefs.has(word)) return;
    lemmaDefs.set(word, { partOfSpeech: entry.pos_title ?? entry.pos ?? '', definitions: senses });
  });
  log(`${totalRead} entrées lues, ${lemmaDefs.size} lemmes définis`);

  // -- passe 2 : ne garder que les mots jouables ----------------------------
  log('passe 2/2 : rattachement des formes fléchies');
  const rows = new Map();
  let direct = 0;
  let viaLemma = 0;
  let unresolved = 0;

  await forEachFrenchEntry((entry) => {
    const spelling = String(entry.word ?? '');
    if (!spelling) return;
    // Le Wiktionnaire décrit aussi les affixes et les locutions à trait d'union.
    // Sans ce filtre, « -eté » écrase « été », « -ane » écrase « âne » et
    // « de-ci » écrase « déci » : ils se normalisent sur la même clé. C'est la
    // règle qu'applique déjà le dictionnaire du jeu.
    if (!/^[\p{L}]+$/u.test(spelling)) return;
    const normalized = normalizeWord(spelling);
    if (normalized.length < 3 || !dictionary.has(normalized)) return;

    const key = `${normalized}\t${spelling}`;
    const existing = rows.get(key);
    if (existing && existing.lemma === '') return; // déjà une définition propre

    const own = ownSenses(entry);
    if (own.length > 0) {
      rows.set(key, {
        normalized,
        spelling,
        partOfSpeech: entry.pos_title ?? entry.pos ?? '',
        lemma: '',
        definitions: own,
      });
      if (!existing) direct++;
      return;
    }

    if (existing) return;

    const form = formSense(entry);
    if (!form) return;

    const target = lemmaDefs.get(form.lemma);
    if (target) {
      rows.set(key, {
        normalized,
        spelling,
        partOfSpeech: target.partOfSpeech,
        lemma: form.lemma,
        definitions: target.definitions,
      });
      viaLemma++;
    } else if (form.gloss) {
      rows.set(key, {
        normalized,
        spelling,
        partOfSpeech: entry.pos_title ?? entry.pos ?? '',
        lemma: '',
        definitions: [cleanDefinition(form.gloss)],
      });
      unresolved++;
    }
  });

  log(`${rows.size} graphies : ${direct} définies en propre, ${viaLemma} via lemme, ${unresolved} renvois seuls`);

  // -- classement des graphies ----------------------------------------------
  //
  // Le Wiktionnaire décrit aussi les sigles et les noms propres : sans
  // classement, ETE renvoie « Excédent de trésorerie d'exploitation » avant
  // « été ». On écarte d'abord ces entrées, puis on ordonne le reste par
  // fréquence d'usage mesurée, ce qui met « côté » devant « coté ».
  const penalty = (row) => {
    let score = 0;
    if (row.spelling !== row.spelling.toLowerCase()) score += 4; // Ane, ANE, Añe
    if (/propre/i.test(row.partOfSpeech)) score += 4;
    if (/^(Abréviation|Sigle|Initiales|Variante|Symbole)\b/i.test(row.definitions[0] ?? '')) score += 3;
    return score;
  };
  const frequency = (row) => frequencies.get(row.spelling) ?? frequencies.get(row.spelling.toLowerCase()) ?? 0;

  const byWord = new Map();
  for (const row of rows.values()) {
    const list = byWord.get(row.normalized);
    if (list) list.push(row);
    else byWord.set(row.normalized, [row]);
  }

  const ordered = [];
  let ranked = 0;
  for (const [, list] of [...byWord.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (list.length > 1) ranked++;
    list.sort(
      (a, b) =>
        penalty(a) - penalty(b) ||
        frequency(b) - frequency(a) ||
        (a.lemma ? 1 : 0) - (b.lemma ? 1 : 0) ||
        a.spelling.localeCompare(b.spelling),
    );
    ordered.push(...list.slice(0, MAX_SPELLINGS));
  }
  log(`${ranked} formes à plusieurs graphies, classées par fréquence d’usage`);

  // -- écriture --------------------------------------------------------------
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const gzip = createGzip({ level: 9 });
  const written = gzip.pipe(createWriteStream(OUT_FILE));
  let raw = 0;
  let senses = 0;
  for (const row of ordered) {
    for (const definition of row.definitions) {
      const line = `${row.normalized}\t${row.partOfSpeech}\t${row.spelling}\t${row.lemma}\t${definition}\n`;
      raw += Buffer.byteLength(line);
      senses++;
      gzip.write(line);
    }
  }
  gzip.end();
  await new Promise((done) => written.on('finish', done));

  const words = new Set(ordered.map((row) => row.normalized));
  const size = statSync(OUT_FILE).size;
  log(`écrit : ${OUT_FILE}`);
  log(`  ${words.size} mots sur ${dictionary.size} (${((words.size / dictionary.size) * 100).toFixed(1)} %)`);
  log(`  ${ordered.length} graphies, ${senses} sens (${(senses / ordered.length).toFixed(2)} par graphie)`);
  log(`  ${(raw / 1e6).toFixed(1)} Mo bruts, ${(size / 1e6).toFixed(1)} Mo compressés`);

  if (words.size < dictionary.size * 0.5) {
    throw new Error(`couverture anormalement basse (${words.size}), extraction suspecte`);
  }
}

main().catch((error) => {
  console.error('[définitions] échec :', error.message);
  process.exitCode = 1;
});
