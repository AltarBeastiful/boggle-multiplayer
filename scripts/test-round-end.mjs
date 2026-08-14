#!/usr/bin/env node
/**
 * Checks the two ways a round can end.
 *
 *   node scripts/test-round-end.mjs [url]
 *
 * The buzzer must not take the grid away: the letters stay, and each player
 * leaves for the solutions when they choose. An untimed round has no buzzer at
 * all, and only the host can close it, for everyone at once.
 *
 * Two browser contexts, so "for everyone at once" is actually observed rather
 * than assumed from the host's own screen.
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { buildDictionary, solveBoard } from '@boggle/shared';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'server/package.json'));
const dictionary = buildDictionary(require('an-array-of-french-words'));

const URL = process.argv[2] ?? 'http://localhost:5173/';
const problems = [];
const check = (condition, failure) => {
  if (!condition) problems.push(failure);
};

const browser = await chromium.launch();

/** Opens a room, returns the host page and the code. */
async function host(context, settings) {
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.fill('#nickname', 'Hote');
  await page.getByRole('button', { name: 'Créer une partie' }).click();
  await page.locator('details > summary').first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: settings, exact: true }).first().click();
  await page.waitForTimeout(200);
  const code = (await page.locator('.font-mono.text-6xl').textContent()).trim();
  return { page, code };
}

async function join(context, code, nickname) {
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(`${URL.replace(/\/$/, '')}/r/${code}`, { waitUntil: 'networkidle' });
  await page.fill('#nickname', nickname);
  await page.getByRole('button', { name: /Rejoindre/ }).click();
  await page.waitForTimeout(400);
  return page;
}

// ---------------------------------------------------------------------------
console.log('\n── A timed round: the grid stays at the buzzer ──');
{
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const { page } = await host(context, '1:00');
  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForTimeout(3200);

  const beforeCells = await page.locator('[data-cell]').allTextContents();
  await page.getByRole('button', { name: 'Voir les solutions' }).waitFor({ timeout: 70_000 });

  const stillOnGrid = await page.locator('[data-cell]').count();
  const afterCells = await page.locator('[data-cell]').allTextContents();
  const solutionsShown = await page.getByRole('heading', { name: /^Solutions/ }).count();
  const input = await page.locator('input[aria-label="Mot trouvé"]').count();
  console.log(`  grid still shown: ${stillOnGrid > 0}, same letters: ${
    beforeCells.join('') === afterCells.join('')}`);
  console.log(`  solutions page shown on its own: ${solutionsShown > 0} (false expected)`);
  console.log(`  input field left: ${input} (0 expected)`);
  check(stillOnGrid > 0, 'timed: the grid disappeared at the buzzer');
  check(beforeCells.join('') === afterCells.join(''), 'timed: the letters changed at the buzzer');
  check(solutionsShown === 0, 'timed: the solutions opened without being asked for');
  check(input === 0, 'timed: the input field outlived the round');

  await page.getByRole('button', { name: 'Voir les solutions' }).click();
  await page.waitForTimeout(500);
  const opened = await page.getByRole('heading', { name: /^Solutions/ }).count();
  console.log(`  solutions after clicking: ${opened > 0}`);
  check(opened > 0, 'timed: the button did not open the solutions');
  await context.close();
}

// ---------------------------------------------------------------------------
console.log('\n── An untimed round: only the host closes it ──');
{
  const hostContext = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const guestContext = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const { page, code } = await host(hostContext, 'sans limite');
  const guest = await join(guestContext, code, 'Invite');

  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForTimeout(3200);

  const clock = await page.locator('text=Sans limite').count();
  const guestButton = await guest.getByRole('button', { name: 'Voir les solutions' }).count();
  const hostButton = await page.getByRole('button', { name: 'Voir les solutions' }).count();
  console.log(`  clock reads "sans limite": ${clock > 0}`);
  console.log(`  host can close: ${hostButton > 0}, guest can close: ${guestButton > 0} (false expected)`);
  check(clock > 0, 'untimed: the clock still counts down');
  check(hostButton > 0, 'untimed: the host has no way to close the round');
  check(guestButton === 0, 'untimed: a guest can close the round');

  // The round must outlive a buzzer that does not exist.
  await page.waitForTimeout(4000);
  const stillPlaying = await page.locator('input[aria-label="Mot trouvé"]').count();
  console.log(`  still playing after 7s: ${stillPlaying > 0}`);
  check(stillPlaying > 0, 'untimed: the round ended on its own');

  // A word still counts, well past any ordinary buzzer.
  await guest.fill('input[aria-label="Mot trouvé"]', 'ZZZZZ');
  await guest.keyboard.press('Enter');
  await guest.waitForTimeout(300);
  const refusal = await guest.locator('[role="status"]').textContent();
  console.log(`  a word sent late is judged on its merits: ${JSON.stringify(refusal.trim())}`);
  check(
    !refusal.includes('manche terminée'),
    'untimed: a word was refused because the round was over',
  );

  await page.getByRole('button', { name: 'Voir les solutions' }).click();
  await page.waitForTimeout(900);

  const hostSees = await page.getByRole('heading', { name: /^Solutions/ }).count();
  const guestOnGrid = await guest.locator('[data-cell]').count();
  const guestButtonNow = await guest.getByRole('button', { name: 'Voir les solutions' }).count();
  const guestSolutions = await guest.getByRole('heading', { name: /^Solutions/ }).count();
  console.log(`  host lands on the solutions: ${hostSees > 0}`);
  console.log(`  guest keeps the grid: ${guestOnGrid > 0}, and is offered the solutions: ${
    guestButtonNow > 0}`);
  console.log(`  guest dragged to the solutions: ${guestSolutions > 0} (false expected)`);
  check(hostSees > 0, 'untimed: the host did not land on the solutions');
  check(guestOnGrid > 0, 'untimed: the guest lost the grid');
  check(guestButtonNow > 0, 'untimed: the guest was not offered the solutions');
  check(guestSolutions === 0, 'untimed: the guest was dragged to the solutions');

  await hostContext.close();
  await guestContext.close();
}

// ---------------------------------------------------------------------------
console.log('\n── Carrying on with the grid, off the clock ──');
{
  const context = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  const { page } = await host(context, '1:00');
  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForTimeout(3200);

  const cells = (await page.locator('[data-cell]').allTextContents()).map((cell) => cell.trim());
  const solved = solveBoard({ size: Math.sqrt(cells.length), cells }, dictionary, {
    minWordLength: 3,
    qEqualsQu: false,
  });
  const words = [...solved.words.keys()].sort((a, b) => b.length - a.length);
  const input = page.locator('input[aria-label="Mot trouvé"]');

  // Two words during the round, so there is a score to protect.
  for (const word of words.slice(0, 2)) {
    await input.fill(word);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
  }

  await page.getByRole('button', { name: 'Continuer à chercher' }).waitFor({ timeout: 70_000 });
  const scoredBefore = await page.locator('h2:text-matches("Mes mots")').textContent();

  await page.getByRole('button', { name: 'Continuer à chercher' }).click();
  await page.waitForTimeout(400);

  const backToPlaying = await page.locator('input[aria-label="Mot trouvé"]').count();
  const clock = await page.locator('text=Hors chrono').first().count();
  console.log(`  the field is back: ${backToPlaying > 0}, the clock reads "hors chrono": ${clock > 0}`);
  check(backToPlaying > 0, 'practice did not give the field back');
  check(clock > 0, 'the clock does not say the round is over');

  // A real word of the grid, one already found, and a word that is not one.
  await input.fill(words[2]);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await input.fill(words[0]);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const repeated = (await page.locator('[role="status"]').textContent()).trim();
  await input.fill('ZZZZW');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const rubbish = (await page.locator('[role="status"]').textContent()).trim();

  const scoredAfter = await page.locator('h2:text-matches("Mes mots")').textContent();
  const practiceHeading = await page.locator('h2:text-matches("Hors chrono")').textContent();
  console.log(`  a word already scored is refused: ${JSON.stringify(repeated)}`);
  console.log(`  a non-word is still told apart: ${JSON.stringify(rubbish)}`);
  console.log(`  scored words: ${JSON.stringify(scoredBefore.trim())} -> ${JSON.stringify(scoredAfter.trim())}`);
  console.log(`  practice list: ${JSON.stringify(practiceHeading.trim())}`);
  check(repeated.includes('déjà trouvé'), 'a word already scored was accepted again for practice');
  check(rubbish.includes('dictionnaire'), 'a non-word was not told apart from an untraceable one');
  check(scoredBefore === scoredAfter, 'a practice word changed the scored count');
  check(practiceHeading.includes('(1)'), `the practice list reads ${practiceHeading} instead of holding one word`);

  // And the way out is still there.
  await page.getByRole('button', { name: 'Voir les solutions' }).click();
  await page.waitForTimeout(500);
  const solutions = await page.getByRole('heading', { name: /^Solutions/ }).count();
  console.log(`  the solutions still open from practice: ${solutions > 0}`);
  check(solutions > 0, 'practice could not be left for the solutions');

  // The next round starts clean: practice belonged to the grid before.
  await page.getByRole('button', { name: 'Manche suivante' }).click();
  await page.waitForTimeout(3400);
  const leftovers = await page.locator('h2:text-matches("Hors chrono")').count();
  const playingAgain = await page.locator('input[aria-label="Mot trouvé"]').count();
  const freshCount = await page.locator('h2:text-matches("Mes mots")').textContent();
  console.log(`  next round: practice cleared: ${leftovers === 0}, playing: ${playingAgain > 0}, ${
    freshCount.trim()}`);
  check(leftovers === 0, 'the practice list survived into the next round');
  check(playingAgain > 0, 'the next round did not give the field back');
  check(freshCount.includes('(0)'), `the next round started with ${freshCount} instead of no words`);

  await context.close();
}

await browser.close();

console.log('');
if (problems.length === 0) console.log('OK: both ways of ending a round behave');
else for (const problem of problems) console.log(`✗ ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;
