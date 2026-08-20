#!/usr/bin/env node
/**
 * What the bundled definitions must answer, and at what price in memory.
 *
 *   npm run build -w @boggle/server && node scripts/test-definitions.mjs
 *
 * The server searches `definitions.tsv.gz` where it lies rather than parsing it
 * into a Map, because the Map cost 383 MB of heap and the server it runs on has
 * 682 MB of memory. A binary search over bytes is easy to get subtly wrong, and
 * wrong here means a player is shown another word's definition, so this file
 * checks the real module against an independent reading of the same lines.
 *
 * The three ways this search can fail, all covered below: landing on a word
 * that merely starts with the one asked for (ABACA and ABACAS), stopping short
 * of a word's later senses, and answering for a word the file does not hold.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const built = resolve(root, 'server/dist/definitions-local.js');
let definitions;
try {
  definitions = await import(built);
} catch {
  console.log('Build the server first: npm run build -w @boggle/server');
  process.exit(1);
}
const { hasLocalDefinitions, localDefinitionCount, lookupLocal } = definitions;

const problems = [];
const file = resolve(root, 'server/data/definitions.tsv.gz');
let raw;
try {
  raw = readFileSync(file);
} catch {
  console.log(`No ${file}: it is a release asset, fetched by scripts/deploy.sh. Nothing to check.`);
  process.exit(0);
}

// The independent reading: the same lines, grouped the plain way, in memory
// only for the words this test asks about.
const buffer = gunzipSync(raw);
const lines = buffer.toString('utf8').split('\n');
const order = [];
const byWord = new Map();
for (const line of lines) {
  if (line.length === 0) continue;
  const [word, partOfSpeech, spelling, lemma, definition] = line.split('\t');
  if (!word || !definition) continue;
  let entries = byWord.get(word);
  if (!entries) {
    entries = [];
    byWord.set(word, entries);
    order.push(word);
  }
  const last = entries[entries.length - 1];
  if (last && last.spelling === spelling && last.partOfSpeech === partOfSpeech) {
    last.definitions.push(definition);
    continue;
  }
  const entry = { spelling: spelling || word.toLowerCase(), partOfSpeech: partOfSpeech || '', definitions: [definition] };
  if (lemma) entry.lemma = lemma;
  entries.push(entry);
}

console.log(`Definitions: ${order.length} words, ${Math.round(buffer.length / 1e6)} MB of TSV\n`);

function same(word) {
  const wanted = byWord.get(word) ?? null;
  const got = lookupLocal(word) ?? null;
  if (JSON.stringify(got) !== JSON.stringify(wanted)) {
    problems.push(`${word}: ${JSON.stringify(got)?.slice(0, 120)} instead of ${JSON.stringify(wanted)?.slice(0, 120)}`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
console.log('── The file is there and counted ──');
{
  if (!hasLocalDefinitions()) problems.push('hasLocalDefinitions() is false though the file was read');
  const counted = localDefinitionCount();
  console.log(`  ${counted} words reported`);
  if (counted !== order.length) problems.push(`localDefinitionCount() says ${counted}, the file holds ${order.length}`);
}

// ---------------------------------------------------------------------------
console.log('── Every hundredth word, and both ends ──');
{
  const sample = [order[0], order[order.length - 1]];
  for (let i = 0; i < order.length; i += 100) sample.push(order[i]);
  const wrong = sample.filter((word) => !same(word)).length;
  console.log(`  ${sample.length - wrong}/${sample.length} identical to the plain reading`);
}

// ---------------------------------------------------------------------------
console.log('── Words that begin another word ──');
{
  // Where a binary search stops one line early or one line late.
  const prefixes = [];
  for (let i = 1; i < order.length && prefixes.length < 400; i++) {
    if (order[i].startsWith(order[i - 1])) prefixes.push(order[i - 1], order[i]);
  }
  const wrong = prefixes.filter((word) => !same(word)).length;
  console.log(`  ${prefixes.length - wrong}/${prefixes.length} kept apart, e.g. ${prefixes[0]} and ${prefixes[1]}`);
}

// ---------------------------------------------------------------------------
console.log('── Words with several spellings or several senses ──');
{
  // The builder keeps at most four spellings and three senses of each, so
  // these are the fullest entries the file has.
  const many = order.filter((word) => (byWord.get(word)?.length ?? 0) >= 4).slice(0, 200);
  const senses = order.filter((word) => (byWord.get(word)?.[0]?.definitions.length ?? 0) >= 3).slice(0, 200);
  const wrong = [...many, ...senses].filter((word) => !same(word)).length;
  console.log(`  ${many.length} homographs and ${senses.length} polysemous words, ${wrong} wrong`);
  const cote = lookupLocal('COTE');
  console.log(`  COTE: ${cote?.map((entry) => entry.spelling).join(', ')}`);
  if (!cote || cote.length < 2) problems.push('COTE should carry several spellings');
}

// ---------------------------------------------------------------------------
console.log('── Words the file does not hold ──');
{
  const absent = ['', 'ZZZZZZZZ', 'AAAAAAAA', 'cote', 'CÔTE', 'XYZZY', `${order[0]}Z`, order[0].slice(0, -1)];
  for (const word of absent) {
    if (byWord.has(word)) continue;
    if (lookupLocal(word) !== null) problems.push(`${word || '(empty)'}: answered though the file does not hold it`);
  }
  console.log(`  ${absent.length} absent words, all silent`);
}

// ---------------------------------------------------------------------------
console.log('── What it costs ──');
{
  const started = Date.now();
  const rounds = 20_000;
  for (let i = 0; i < rounds; i++) lookupLocal(order[(i * 7919) % order.length]);
  const each = ((Date.now() - started) * 1000) / rounds;
  console.log(`  ${each.toFixed(1)} µs per lookup`);
  if (each > 200) problems.push(`a lookup takes ${each.toFixed(0)} µs, the file is meant to be searched, not scanned`);

  // The point of the exercise, measured in a fresh process: this one has just
  // read the whole file into strings itself, which is exactly what the server
  // must not do. The Map this replaced held 383 MB of heap, more than V8 will
  // allow itself on a 682 MB machine, and the server died on the first lookup.
  const probe = `
    const { lookupLocal } = await import(${JSON.stringify(built)});
    lookupLocal('COTE');
    const used = process.memoryUsage();
    console.log(JSON.stringify({ heap: used.heapUsed, external: used.external, rss: used.rss }));
  `;
  const printed = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
  const { heap, external, rss } = JSON.parse(printed.trim().split('\n').pop());
  console.log(
    `  serving it costs ${Math.round(heap / 1e6)} MB of heap, ${Math.round(external / 1e6)} MB of bytes, ${Math.round(rss / 1e6)} MB resident`,
  );
  if (heap > 150e6) problems.push(`the words are back on the heap: ${Math.round(heap / 1e6)} MB`);
  if (external < buffer.length * 0.9) problems.push('the file is not held as bytes');
}

console.log('');
if (problems.length === 0) console.log('OK: the search answers exactly what the file says, and nothing when it says nothing');
else for (const problem of problems) console.log(`✗ ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;
