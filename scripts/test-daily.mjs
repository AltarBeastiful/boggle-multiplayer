#!/usr/bin/env node
/**
 * The grille du jour, from the home page to the leaderboard.
 *
 *   node scripts/test-daily.mjs [url]
 *
 * Two browser profiles play the same grid, so the two things that make the day
 * a day can be observed rather than assumed: the grid is the same for both, and
 * the leaderboard puts them in order.
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, devices } from 'playwright';

import { DAILY_RULES, buildDictionary, solveBoard } from '@boggle/shared';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'server/package.json'));
const dictionary = buildDictionary(require('an-array-of-french-words'));

const URL = process.argv[2] ?? 'http://localhost:5173/';
const problems = [];
const check = (condition, failure) => {
  if (!condition) problems.push(failure);
};

const browser = await chromium.launch();

/** Opens the daily grid as a brand new player, and plays `wordCount` words. */
async function play(nickname, wordCount, options = devices['Pixel 7']) {
  const context = await browser.newContext({ ...options });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`${nickname}: page error ${error.message}`));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.fill('#nickname', nickname);

  const entry = page.getByRole('button', { name: /Grille du jour/ });
  await entry.waitFor({ timeout: 10_000 });
  await entry.click();
  await page.waitForSelector('[data-cell]', { timeout: 10_000 });

  const cells = (await page.locator('[data-cell]').allTextContents()).map((cell) => cell.trim());
  const solved = solveBoard({ size: Math.sqrt(cells.length), cells }, dictionary, {
    minWordLength: DAILY_RULES.minWordLength,
    qEqualsQu: DAILY_RULES.qEqualsQu,
  });
  const words = [...solved.words.keys()].sort((a, b) => b.length - a.length).slice(0, wordCount);

  const input = page.locator('input[aria-label="Mot trouvé"]');
  for (const word of words) {
    await input.fill(word);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(300);

  const accepted = await page.locator('.flex-wrap button').count();
  console.log(`  ${nickname}: grid ${cells.join('')}, ${words.length} words sent`);
  return { context, page, cells: cells.join(''), accepted, words };
}

/*
 * The day's leaderboard is meant to persist, so a second run of this test
 * meets the players of the first. Unique names keep the assertions about these
 * two players rather than about which row they land on.
 */
const run = Date.now().toString(36).slice(-4);
const WEAK = `Robin-${run}`;
const STRONG = `Batman-${run}`;

console.log('\n── Two players, one grid ──');
const first = await play(WEAK, 3);
const second = await play(STRONG, 8);

console.log(`  same grid for both: ${first.cells === second.cells}`);
check(first.cells === second.cells, 'the two players did not get the same grid');

// Nothing is revealed before finishing.
const earlySolutions = await second.page.getByRole('heading', { name: /^Solutions/ }).count();
const earlyRanking = await second.page.getByRole('heading', { name: /Classement/ }).count();
console.log(`  solutions before finishing: ${earlySolutions > 0} (false expected)`);
console.log(`  leaderboard before finishing: ${earlyRanking > 0} (false expected)`);
check(earlySolutions === 0, 'the solutions showed before the grid was finished');
check(earlyRanking === 0, 'the leaderboard showed before the grid was finished');

console.log('\n── Finishing, in the wrong order on purpose ──');
for (const player of [first, second]) {
  await player.page.getByRole('button', { name: 'Voir les solutions' }).click();
  await player.page.waitForTimeout(700);
}

const ranking = (await second.page.locator('table tbody tr').allTextContents()).map((row) => row.trim());
const strongRow = ranking.findIndex((row) => row.includes(STRONG));
const weakRow = ranking.findIndex((row) => row.includes(WEAK));
console.log(`  leaderboard holds ${ranking.length} players; ${STRONG} at ${strongRow + 1}, ${WEAK} at ${weakRow + 1}`);
check(strongRow >= 0 && weakRow >= 0, 'a player of this run is missing from the leaderboard');
check(strongRow < weakRow, 'the better score is not ranked above the weaker one');
check(
  (ranking[strongRow] ?? '').includes('(vous)'),
  `${STRONG} is not marked as the one reading the board`,
);
check(
  !(ranking[weakRow] ?? '').includes('(vous)'),
  'another player is marked as the one reading the board',
);

const solutions = await second.page.getByRole('heading', { name: /^Solutions/ }).count();
const legend = await second.page.locator('text=trouvé par un autre joueur').count();
console.log(`  solutions after finishing: ${solutions > 0}`);
console.log(`  "trouvé par un autre joueur" legend: ${legend > 0} (false expected, played alone)`);
check(solutions > 0, 'the solutions did not open after finishing');
check(legend === 0, 'the legend still credits other players on a solo grid');

// Coming back must show the result again, not a fresh grid.
await second.page.goto(URL, { waitUntil: 'networkidle' });
const teaser = await second.page.getByRole('button', { name: /Grille du jour/ }).textContent();
console.log(`  home page afterwards: ${JSON.stringify(teaser.trim())}`);
check(/termin/i.test(teaser), 'the home page does not say the grid is done');

await second.page.getByRole('button', { name: /Grille du jour/ }).click();
await second.page.waitForTimeout(800);
const backToResult = await second.page.getByRole('heading', { name: /Classement/ }).count();
const canPlayOn = await second.page.locator('input[aria-label="Mot trouvé"]').count();
console.log(`  reopening shows the result: ${backToResult > 0}, and no input: ${canPlayOn === 0}`);
check(backToResult > 0, 'reopening did not show the finished result');
check(canPlayOn === 0, 'the grid could be played again after finishing');

await first.context.close();
await second.context.close();

/*
 * The definition is the one thing on this page that lives in two places at
 * once: the solutions panel carries it for a narrow screen and hides it on a
 * wide one, where it belongs beside the grid and only the page around it can
 * put it there. Forgetting that half is silent: the word lights up and the card
 * opens where nothing is looking. So both widths are checked, and the
 * invariant is exactly one visible card, never none and never two.
 */
console.log('\n── The definition opens, whatever the width ──');
for (const [label, options] of [
  ['téléphone', devices['Pixel 7']],
  ['bureau', { viewport: { width: 1280, height: 900 } }],
]) {
  const player = await play(`Lecteur-${run}-${label}`, 2, options);
  await player.page.getByRole('button', { name: 'Voir les solutions' }).click();
  await player.page.waitForTimeout(700);

  // Solution chips are the only things on the page that expand.
  await player.page.locator('button[aria-expanded]').first().click();
  const card = player.page.locator('button[aria-label="Fermer la définition"]');
  await card.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);

  const rendered = await card.count();
  const visible = await player.page.locator('button[aria-label="Fermer la définition"]:visible').count();
  const word = await player.page.locator('[aria-live="polite"] h3:visible').first().textContent().catch(() => null);
  console.log(`  ${label}: cards rendered ${rendered}, visible ${visible}, showing ${JSON.stringify(word)}`);
  check(visible === 1, `${label}: ${visible} definition cards visible instead of exactly one`);
  check(Boolean(word), `${label}: the visible definition names no word`);

  await player.context.close();
}

await browser.close();

console.log('');
if (problems.length === 0) console.log('OK: the grille du jour behaves');
else for (const problem of problems) console.log(`✗ ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;
