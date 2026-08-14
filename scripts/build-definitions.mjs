#!/usr/bin/env node
/**
 * Construit le fichier de définitions embarquées (option C).
 *
 *   node scripts/build-definitions.mjs
 *
 * Source : l'extraction du Wiktionnaire francophone par wiktextract
 * (kaikki.org), déjà analysée, on n'a donc pas à interpréter du wikitexte.
 * Le champ `form_of` donne le lemme explicitement, là où la recherche en direct
 * devait le deviner en prenant le dernier mot d'une phrase.
 *
 * Le fichier source (682 Mo) n'est jamais décompressé sur disque : il est lu en
 * flux, deux fois. Pic disque = le téléchargement seul.
 *
 * Sortie : server/data/definitions.tsv.gz
 *   FORME_NORMALISEE \t nature \t graphie \t lemme \t définition
 *
 * Contenu sous licence CC BY-SA 4.0 (Wiktionnaire), voir server/data/LICENCE-DEFINITIONS.md
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

const SOURCE_URL = 'https://kaikki.org/dictionary/downloads/fr/fr-extract.jsonl.gz';
const USER_AGENT = 'boggle-multiplayer/1.0 (https://github.com/AltarBeastiful/boggle-multiplayer)';
const WORK_DIR = process.env.BOGGLE_WORK_DIR ?? resolve(root, '.work');
const SOURCE_FILE = resolve(WORK_DIR, 'fr-extract.jsonl.gz');
const OUT_FILE = resolve(root, 'server/data/definitions.tsv.gz');

/** Une définition plus longue relève de l'encyclopédie, pas du jeu. */
const MAX_DEFINITION = 400;

const log = (message) => console.log(`[définitions] ${message}`);

// ---------------------------------------------------------------------------

async function download() {
  mkdirSync(WORK_DIR, { recursive: true });
  if (existsSync(SOURCE_FILE) && statSync(SOURCE_FILE).size > 600_000_000) {
    log(`source déjà présente (${(statSync(SOURCE_FILE).size / 1e6).toFixed(0)} Mo)`);
    return;
  }

  log(`téléchargement de ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok || !response.body) throw new Error(`téléchargement impossible : ${response.status}`);

  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let lastLogged = 0;

  const progress = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length;
      if (received - lastLogged > 50_000_000) {
        lastLogged = received;
        const pct = total ? ` (${((received / total) * 100).toFixed(0)} %)` : '';
        log(`  ${(received / 1e6).toFixed(0)} Mo${pct}`);
      }
      controller.enqueue(chunk);
    },
  });

  await pipeline(response.body.pipeThrough(progress), createWriteStream(SOURCE_FILE));
  log(`téléchargé : ${(statSync(SOURCE_FILE).size / 1e6).toFixed(0)} Mo`);
}

/** Parcourt les entrées françaises du fichier, une par une. */
async function forEachFrenchEntry(onEntry) {
  const lines = createInterface({
    input: createReadStream(SOURCE_FILE).pipe(createGunzip()),
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
  // On coupe à la phrase, jamais au milieu d'un mot.
  const cut = cleaned.slice(0, MAX_DEFINITION);
  const stop = cut.lastIndexOf('. ');
  return (stop > MAX_DEFINITION / 2 ? cut.slice(0, stop + 1) : cut).trim() + '…';
}

/** Premier sens portant une définition propre (hors renvoi vers un lemme). */
function ownSense(entry) {
  for (const sense of entry.senses ?? []) {
    if (sense.form_of || sense.alt_of) continue;
    const gloss = sense.glosses?.[0];
    if (gloss) return gloss;
  }
  return null;
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
  await download();

  log('chargement du dictionnaire du jeu');
  const dictionary = buildDictionary(require('an-array-of-french-words'));
  log(`${dictionary.size} mots jouables`);

  // -- passe 1 : les définitions propres, indexées par graphie --------------
  log('passe 1/2 : définitions des lemmes');
  const lemmaDefs = new Map();
  const totalRead = await forEachFrenchEntry((entry) => {
    const gloss = ownSense(entry);
    if (!gloss) return;
    const word = String(entry.word ?? '');
    if (!word || lemmaDefs.has(word)) return;
    lemmaDefs.set(word, {
      partOfSpeech: entry.pos_title ?? entry.pos ?? '',
      definition: cleanDefinition(gloss),
    });
  });
  log(`${totalRead} entrées lues, ${lemmaDefs.size} définitions retenues`);

  // -- passe 2 : ne garder que les mots jouables, formes résolues -----------
  log('passe 2/2 : rattachement des formes fléchies');
  /** clé « FORME\tgraphie » -> ligne, pour ne garder qu'une entrée par graphie. */
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
    // Seuls les mots traçables sur une grille nous intéressent.
    if (normalized.length < 3 || !dictionary.has(normalized)) return;

    const key = `${normalized}\t${spelling}`;
    const existing = rows.get(key);
    if (existing && existing.lemma === '') return; // déjà une définition propre

    const own = ownSense(entry);
    if (own) {
      rows.set(key, {
        normalized,
        spelling,
        partOfSpeech: entry.pos_title ?? entry.pos ?? '',
        lemma: '',
        definition: cleanDefinition(own),
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
        definition: target.definition,
      });
      viaLemma++;
    } else if (form.gloss) {
      // Le lemme est introuvable : on garde au moins le renvoi, c'est informatif.
      rows.set(key, {
        normalized,
        spelling,
        partOfSpeech: entry.pos_title ?? entry.pos ?? '',
        lemma: '',
        definition: cleanDefinition(form.gloss),
      });
      unresolved++;
    }
  });

  log(`${rows.size} graphies : ${direct} définitions propres, ${viaLemma} via lemme, ${unresolved} renvois seuls`);

  // -- classement puis écriture ---------------------------------------------
  //
  // Plusieurs graphies tombent sur la même forme normalisée, et le Wiktionnaire
  // décrit aussi les sigles et les noms propres : sans classement, ETE renvoie
  // « Excédent de trésorerie d'exploitation » avant « été », et ANE un hameau
  // néerlandais avant « âne ». On fait donc passer le mot courant devant.
  const penalty = (row) => {
    let score = 0;
    if (row.spelling !== row.spelling.toLowerCase()) score += 4; // Ane, ANE, Añe
    if (/propre/i.test(row.partOfSpeech)) score += 4;
    if (/^(Abréviation|Sigle|Initiales|Variante|Symbole)\b/i.test(row.definition)) score += 3;
    if (row.lemma) score += 1; // à mérite égal, une définition propre passe devant
    return score;
  };

  const byWord = new Map();
  for (const row of rows.values()) {
    const list = byWord.get(row.normalized);
    if (list) list.push(row);
    else byWord.set(row.normalized, [row]);
  }

  const sorted = [];
  for (const [, list] of [...byWord.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => penalty(a) - penalty(b) || a.spelling.localeCompare(b.spelling));
    // Au-delà de quatre graphies, on n'apporte plus rien au joueur.
    sorted.push(...list.slice(0, 4));
  }
  const words = new Set(sorted.map((row) => row.normalized));

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const gzip = createGzip({ level: 9 });
  const written = gzip.pipe(createWriteStream(OUT_FILE));
  let raw = 0;
  for (const row of sorted) {
    const line = `${row.normalized}\t${row.partOfSpeech}\t${row.spelling}\t${row.lemma}\t${row.definition}\n`;
    raw += Buffer.byteLength(line);
    gzip.write(line);
  }
  gzip.end();
  await new Promise((done) => written.on('finish', done));

  const size = statSync(OUT_FILE).size;
  log(`écrit : ${OUT_FILE}`);
  log(`  ${words.size} mots jouables couverts sur ${dictionary.size} (${((words.size / dictionary.size) * 100).toFixed(1)} %)`);
  log(`  ${(raw / 1e6).toFixed(1)} Mo bruts, ${(size / 1e6).toFixed(1)} Mo compressés`);

  // Garde-fou : une chute de couverture doit se voir tout de suite.
  if (words.size < dictionary.size * 0.5) {
    throw new Error(`couverture anormalement basse (${words.size}), extraction suspecte`);
  }
}

main().catch((error) => {
  console.error('[définitions] échec :', error.message);
  process.exitCode = 1;
});
