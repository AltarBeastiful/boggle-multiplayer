#!/usr/bin/env node
/**
 * Checks how a word is built on the grid: taps, drag, mouse clicks.
 *
 *   node scripts/test-trace.mjs [url]
 *
 * Touch goes through the browser itself (CDP Input.dispatchTouchEvent) rather
 * than a page-level `dispatchEvent`, so pointer capture, `touch-action` and
 * scrolling behave as they would under a real finger.
 *
 * The word is chosen by solving the grid: building three random letters proves
 * nothing, since a non-word is rightly refused, which reads like a broken
 * input.
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, devices } from 'playwright';

import { buildDictionary, findPath, solveBoard } from '@boggle/shared';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'server/package.json'));

const URL = process.argv[2] ?? 'http://localhost:3001/';
const dictionary = buildDictionary(require('an-array-of-french-words'));
const problems = [];

async function scenario({ name, contextOptions, gesture }) {
  console.log(`\n── ${name} ──`);
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.on('pageerror', (error) => problems.push(`${name}: page error ${error.message}`));

  const centre = async (index) => {
    const box = await page.locator(`[data-cell="${index}"]`).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const input = page.locator('input[aria-label="Mot trouvé"]');

  try {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.fill('#nickname', 'Testeur');
    await page.getByRole('button', { name: 'Créer une partie' }).click();
    await page.getByRole('button', { name: 'Lancer la partie' }).click();
    await page.waitForTimeout(3200); // pre-round countdown

    const cells = (await page.locator('[data-cell]').allTextContents()).map((c) => c.trim());
    const board = { size: Math.sqrt(cells.length), cells };
    const solution = solveBoard(board, dictionary, { minWordLength: 4, qEqualsQu: false });
    const word = [...solution.words.keys()].sort((a, b) => b.length - a.length)[0];
    const path = findPath(board, word);
    console.log(`  grid ${cells.join('')}, word ${word} via ${path.join(',')}`);

    await gesture({ page, cdp, centre, path });
    await page.waitForTimeout(300);

    const composed = await input.inputValue();
    const beforeSend = await page.locator('.flex-1 button').count();
    console.log(`  field after the gesture: ${JSON.stringify(composed)}`);
    console.log(`  words submitted before sending: ${beforeSend} (0 expected)`);

    await page.getByRole('button', { name: 'Envoyer le mot' }).click();
    await page.waitForTimeout(500);
    const words = (await page.locator('.flex-1 button').allTextContents()).map((m) => m.trim());
    const fieldCleared = (await input.inputValue()) === '';
    const scrolled = await page.evaluate(() => window.scrollY);
    console.log(`  words submitted: ${JSON.stringify(words)}`);
    console.log(`  field cleared: ${fieldCleared}, page scrolled: ${scrolled}px`);

    if (composed !== word) problems.push(`${name}: field "${composed}" instead of "${word}"`);
    if (beforeSend !== 0) problems.push(`${name}: word left without being sent`);
    if (!words.some((m) => m.startsWith(word))) problems.push(`${name}: ${word} not submitted`);
    if (!fieldCleared) problems.push(`${name}: field not cleared after sending`);
    if (scrolled !== 0) problems.push(`${name}: the page scrolled`);
  } finally {
    await browser.close();
  }
}

/** A firm tap on a tile, like a finger tapping. */
const tap = async (cdp, point) => {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const mobile = { ...devices['Pixel 7'] };
const desktop = { viewport: { width: 1440, height: 900 }, hasTouch: false };

// The reported case: the letter appeared then vanished at once.
await scenario({
  name: 'Successive taps (touch)',
  contextOptions: mobile,
  gesture: async ({ page, cdp, centre, path }) => {
    for (const [rank, index] of path.entries()) {
      await tap(cdp, await centre(index));
      await page.waitForTimeout(140);
      const value = await page.locator('input[aria-label="Mot trouvé"]').inputValue();
      if (rank === 0 && value.length === 0) {
        problems.push('Taps: the first letter disappears on release');
      }
    }
  },
});

await scenario({
  name: 'Finger drag (touch)',
  contextOptions: mobile,
  gesture: async ({ page, cdp, centre, path }) => {
    const points = [];
    for (const index of path) points.push(await centre(index));
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: points[0].x, y: points[0].y, id: 1 }],
    });
    await page.waitForTimeout(70);
    for (const point of points.slice(1)) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point.x, y: point.y, id: 1 }],
      });
      await page.waitForTimeout(60);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  },
});

await scenario({
  name: 'Mouse clicks (desktop)',
  contextOptions: desktop,
  gesture: async ({ page, centre, path }) => {
    for (const index of path) {
      const point = await centre(index);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(110);
    }
  },
});

console.log('');
if (problems.length === 0) console.log('OK: taps, drag and clicks all behave');
else for (const p of problems) console.log(`✗ ${p}`);
process.exitCode = problems.length === 0 ? 0 : 1;
