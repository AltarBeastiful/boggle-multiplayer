#!/usr/bin/env node
/**
 * Checks the feedback given to the player: refusal message, halo around the
 * grid, and above all that an accepted word is retraced on *their* tiles.
 *
 *   node scripts/test-feedback.mjs [url]
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, devices } from 'playwright';

import { buildDictionary, getNeighbours, solveBoard } from '@boggle/shared';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'server/package.json'));
const URL = process.argv[2] ?? 'http://localhost:3001/';
const dictionary = buildDictionary(require('an-array-of-french-words'));
const problems = [];

/** Every path spelling a word, which is what lets us pick a different one. */
function allPaths(board, word) {
  const adjacency = getNeighbours(board.size);
  const found = [];
  const walk = (index, at, used, path) => {
    if (board.cells[index] !== word[at]) return;
    const next = at + 1;
    const here = [...path, index];
    if (next === word.length) {
      found.push(here);
      return;
    }
    for (const n of adjacency[index] ?? []) {
      if (!used.has(n)) walk(n, next, new Set([...used, index]), here);
    }
  };
  for (let i = 0; i < board.cells.length; i++) walk(i, 0, new Set(), []);
  return found;
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
const input = page.locator('input[aria-label="Mot trouvé"]');
const centre = async (index) => {
  const box = await page.locator(`[data-cell="${index}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
/**
 * Lit tiles, under either mark: `bg-tile-active` for a path being built or
 * held, `bg-tile-trace` for the lighter flick after a word is accepted.
 */
const litTiles = () =>
  page.$$eval('[data-cell]', (els) =>
    els
      .filter((e) => /bg-tile-(active|trace)\b/.test(e.className))
      .map((e) => Number(e.dataset.cell)),
  );

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.fill('#nickname', 'Retours');
  await page.getByRole('button', { name: 'Créer une partie' }).click();
  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForTimeout(3200);

  // -- 1. Refusal message ----------------------------------------------------
  await input.fill('XQJKW');
  await page.getByRole('button', { name: 'Envoyer le mot' }).click();
  await page.waitForTimeout(350);
  const message = (await page.locator('[role=status]').last().textContent()) ?? '';
  const halo = await page.locator('.animate-reject').count();
  const overTiles = await page.evaluate(() => {
    const h = document.querySelector('.animate-reject');
    const d = document.querySelector('[data-cell="5"]');
    if (!h || !d) return null;
    const a = h.getBoundingClientRect();
    const b = d.getBoundingClientRect();
    // The halo must not cover a tile; it frames it.
    return a.top <= b.top && a.bottom >= b.bottom && getComputedStyle(h).backgroundColor;
  });
  console.log(`  message shown: ${JSON.stringify(message.trim())}`);
  console.log(`  halo present : ${halo === 1}`);
  console.log(`  halo background: ${overTiles} (transparent expected, it hides nothing)`);
  if (!message.includes('XQJKW')) problems.push('no refusal message');
  if (halo !== 1) problems.push('no refusal halo');

  await page.waitForTimeout(1600); // the message clears itself
  const after = (await page.locator('[role=status]').last().textContent()) ?? '';
  console.log(`  message after 1.6s: ${JSON.stringify(after.trim())} (empty expected)`);
  if (after.trim() !== '') problems.push('the message does not disappear');

  // -- 2. An accepted word is retraced on the player's tiles ----------------
  const cells = (await page.locator('[data-cell]').allTextContents()).map((c) => c.trim());
  const board = { size: Math.sqrt(cells.length), cells };
  const solution = solveBoard(board, dictionary, { minWordLength: 3, qEqualsQu: false });

  let target = null;
  for (const word of solution.words.keys()) {
    const paths = allPaths(board, word);
    if (paths.length >= 2) {
      target = { word, paths };
      break;
    }
  }

  if (!target) {
    console.log('  (no word traceable two ways on this grid, check skipped)');
  } else {
    // Deliberately build it along the *second* path.
    const chosen = target.paths[1];
    console.log(`  ${target.word}: ${target.paths.length} paths, building via ${chosen.join(',')}`);
    for (const index of chosen) {
      const point = await centre(index);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(90);
    }
    console.log(`  field built: ${JSON.stringify(await input.inputValue())}`);
    await page.getByRole('button', { name: 'Envoyer le mot' }).click();
    // Poll rather than sleep: the trace only appears once the server answers,
    // which takes milliseconds locally but a full round trip in production.
    let trace = [];
    for (let i = 0; i < 40 && trace.length === 0; i++) {
      trace = await litTiles();
      if (trace.length === 0) await page.waitForTimeout(25);
    }
    console.log(`  tiles retraced : ${trace.join(',')}`);
    console.log(`  player's tiles : ${chosen.join(',')}`);
    console.log(`  solver's first path: ${target.paths[0].join(',')}`);
    if (
      trace.join(',') !== [...chosen].sort((a, b) => a - b).join(',') &&
      trace.join(',') !== chosen.join(',')
    ) {
      problems.push(`retraced on ${trace.join(',')} instead of the player's tiles ${chosen.join(',')}`);
    }
  }

  console.log('');
  if (problems.length === 0) console.log('OK: player feedback behaves');
  else for (const p of problems) console.log(`✗ ${p}`);
  process.exitCode = problems.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}
