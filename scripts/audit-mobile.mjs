#!/usr/bin/env node
/**
 * Walks a whole game at phone size and measures what a thumb actually meets:
 * tap target sizes, text sizes, horizontal overflow, and what is readable
 * without scrolling. Screenshots go with it, since numbers do not show a title
 * running under a button.
 *
 *   node scripts/audit-mobile.mjs [url] [output directory]
 *
 * The round is set to one minute so the results page is reached in a minute
 * rather than three.
 */

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, devices } from 'playwright';

import { buildDictionary, solveBoard } from '@boggle/shared';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'server/package.json'));
const dictionary = buildDictionary(require('an-array-of-french-words'));

const URL = process.argv[2] ?? 'http://localhost:5173/';
const OUT = process.argv[3] ?? resolve(root, 'audit-mobile');
mkdirSync(OUT, { recursive: true });

const note = (line) => console.log(line);

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'] });
const page = await context.newPage();
page.on('pageerror', (error) => note(`  PAGE ERROR ${error.message}`));

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

/** Anything below the 44x44 CSS px of WCAG 2.5.5. */
const smallTargets = () =>
  page.evaluate(() => {
    const found = [];
    for (const element of document.querySelectorAll('button, a, input, summary, [role="button"]')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.height < 44 || box.width < 44) {
        found.push({
          text: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 24),
          size: `${Math.round(box.width)}x${Math.round(box.height)}`,
        });
      }
    }
    return found;
  });

const metrics = () =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    /** Text under 12px is hard to read at arm's length. */
    tiny: [...document.querySelectorAll('*')]
      .filter((el) => el.textContent?.trim() && el.children.length === 0)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12).length,
  }));

const report = async (label) => {
  const m = await metrics();
  note(`\n## ${label}`);
  note(
    `  viewport ${m.clientWidth}x${m.clientHeight}, page ${m.scrollWidth}x${m.scrollHeight}` +
      (m.scrollWidth > m.clientWidth ? '   HORIZONTAL OVERFLOW' : ''),
  );
  const small = await smallTargets();
  const kinds = new Map();
  for (const target of small) kinds.set(target.size, (kinds.get(target.size) ?? 0) + 1);
  note(
    small.length === 0
      ? '  every target at least 44x44'
      : `  ${small.length} targets under 44px: ${[...kinds].map(([s, n]) => `${s} x${n}`).join(', ')}`,
  );
  if (m.tiny > 0) note(`  ${m.tiny} elements with text under 12px`);
};

await page.goto(URL, { waitUntil: 'networkidle' });
await report('Home');
await shot('01-home');

await page.fill('#nickname', 'Testeur');
await page.getByRole('button', { name: 'Créer une partie' }).click();
await page.waitForTimeout(600);
await report('Lobby');
await shot('02-lobby');

const start = page.getByRole('button', { name: 'Lancer la partie' });
const startBox = await start.boundingBox();
const viewport = page.viewportSize();
note(
  `  "Lancer la partie" at y=${Math.round(startBox.y)}: ` +
    (startBox.y + startBox.height <= viewport.height ? 'reachable without scrolling' : 'BELOW THE FOLD'),
);

// The settings live in a collapsed <details>, hence the click.
await page.locator('details > summary').first().click();
await page.waitForTimeout(300);
await report('Lobby, settings open');
await shot('03-lobby-settings');
await page.getByRole('button', { name: '1:00', exact: true }).first().click();

await start.click();
await page.waitForTimeout(3000);
await report('Playing');
await shot('04-playing');

const die = await page.locator('[data-cell="0"]').boundingBox();
note(`  a die measures ${Math.round(die.width)}x${Math.round(die.height)} px`);

/*
 * The keyboard question: on a phone it eats 35 to 45% of the height, and the
 * browser scrolls the focused field just above it. What matters is not the
 * page height but the distance from the top of the grid to the bottom of the
 * field, since that is what has to fit in what the keyboard leaves.
 */
const gridTop = die.y;
const fieldBox = await page.locator('input[aria-label="Mot trouvé"]').boundingBox();
const needed = Math.round(fieldBox.y + fieldBox.height - gridTop);
note(`  grid and field together need ${needed}px, so a keyboard may take ${viewport.height - needed}px`);

const cells = (await page.locator('[data-cell]').allTextContents()).map((cell) => cell.trim());
const solved = solveBoard({ size: Math.sqrt(cells.length), cells }, dictionary, {
  minWordLength: 3,
  qEqualsQu: false,
});
const input = page.locator('input[aria-label="Mot trouvé"]');
for (const word of [...solved.words.keys()].sort((a, b) => b.length - a.length).slice(0, 14)) {
  await input.fill(word);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
}

note('\n  waiting for the round to end…');
/*
 * The clock stopping is not the results page. The grid stays up when the
 * whistle goes and the solutions are asked for, not served, so the audit asks
 * like a player would. Waiting for the results heading alone used to leave it
 * sitting on the lingering grid until it timed out.
 */
const seeSolutions = page.getByRole('button', { name: 'Voir les solutions' }).first();
await seeSolutions.waitFor({ state: 'visible', timeout: 120_000 });
await report('Round over, the grid still up');
await shot('05-round-over');

await seeSolutions.click();
await page.getByRole('heading', { name: /terminée$/ }).waitFor({ timeout: 15_000 });
await page.waitForTimeout(500);
await report('Results');
await shot('06-results');

const heading = page.getByRole('heading', { name: /^Solutions/ });
note(`  "Solutions" heading at y=${Math.round((await heading.boundingBox()).y)} of the document`);
await heading.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot('07-solutions');

// Tapping a word: is its definition then readable without hunting for it?
const words = page.locator('section:has(h2:text-matches("^Solutions")) button[aria-expanded]');
const chip = words.nth(Math.min(12, (await words.count()) - 1));
await chip.scrollIntoViewIfNeeded();
await chip.click();
await page.waitForTimeout(900);
await shot('08-word-selected');

const card = page.locator('[aria-live="polite"]:visible').filter({ hasText: 'Source' }).first();
const cardBox = await card.boundingBox();
note(`\n## A word selected (${(await chip.textContent()).trim()})`);
note(
  cardBox && cardBox.y >= 0 && cardBox.y < viewport.height
    ? '  the definition is visible without scrolling'
    : '  the definition is OFF SCREEN',
);
const tint = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('button[aria-expanded]')];
  const background = (el) => (el ? getComputedStyle(el).backgroundColor : null);
  return {
    open: background(chips.find((c) => c.getAttribute('aria-expanded') === 'true')),
    shut: background(chips.find((c) => c.getAttribute('aria-expanded') === 'false')),
  };
});
note(`  selected chip ${tint.open}, unselected ${tint.shut}`);

// A small phone, where anything cramped shows up first.
await page.setViewportSize({ width: 360, height: 640 });
await page.waitForTimeout(400);
await report('Results on a 360x640 phone');
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
await shot('09-small-phone');

await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.setViewportSize({ width: 412, height: 915 });
await page.waitForTimeout(300);
await page.locator('button[aria-expanded="true"]').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await shot('10-dark');

await browser.close();
note(`\nScreenshots in ${OUT}`);
