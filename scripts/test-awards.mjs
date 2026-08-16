#!/usr/bin/env node
/**
 * Checks the dice as they fall, and the awards handed out at the end.
 *
 *   node scripts/test-awards.mjs [url]
 *
 * Two things are being watched here. The dice have to fall the same way on
 * every screen, since the throw is derived from the letters rather than sent
 * over the wire, and that only holds if both players really do land on the
 * same numbers: two browser contexts, compared tile by tile.
 *
 * The awards then have to describe two players who played very differently,
 * and to leave neither of them empty-handed.
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

/** Opens a room and applies each setting by the label on its button. */
async function host(context, settings) {
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.fill('#nickname', 'Hote');
  await page.getByRole('button', { name: 'Créer une partie' }).click();
  await page.locator('details > summary').first().click();
  await page.waitForTimeout(200);
  for (const setting of settings) {
    await page.getByRole('button', { name: setting, exact: true }).first().click();
    await page.waitForTimeout(200);
  }
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

/** The letters on the grid, and how each die is turned, in tile order. */
async function readGrid(page) {
  return page.$$eval('[data-cell]', (cells) =>
    cells.map((cell) => ({
      letter: cell.textContent.trim(),
      turn: cell.querySelector('span')?.style.transform ?? '',
      underlined: cell.querySelector('[data-floor]') !== null,
    })),
  );
}

async function sendWords(page, words) {
  const input = page.locator('input[aria-label="Mot trouvé"]');
  for (const word of words) {
    await input.fill(word);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(130);
  }
}

// ---------------------------------------------------------------------------
console.log('\n── The dice fall in all directions, the same way for everyone ──');
{
  const hostContext = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const guestContext = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const { page, code } = await host(hostContext, ['sans limite']);
  const guest = await join(guestContext, code, 'Invite');

  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForTimeout(3200);

  const mine = await readGrid(page);
  const theirs = await readGrid(guest);
  const turned = mine.filter((tile) => tile.turn !== '').length;

  console.log(`  dice not upright: ${turned} of ${mine.length}`);
  console.log(`  first tiles: ${mine.slice(0, 4).map((t) => `${t.letter}${t.turn || ' (droit)'}`).join(', ')}`);
  check(turned > 0, 'every die landed upright, which is not a throw');
  check(
    turned < mine.length,
    'no die landed upright at all, which is one throw in four billion and more likely a bug',
  );
  check(
    JSON.stringify(mine) === JSON.stringify(theirs),
    'the two players are looking at different throws of the same grid',
  );
  console.log(`  both players see the same throw: ${JSON.stringify(mine) === JSON.stringify(theirs)}`);

  // Every quarter-turn is a real one.
  const angles = new Set(mine.map((tile) => tile.turn));
  const known = [...angles].every((angle) => ['', 'rotate(90deg)', 'rotate(180deg)', 'rotate(270deg)'].includes(angle));
  console.log(`  angles seen: ${[...angles].map((a) => a || 'droit').join(', ')}`);
  check(known, `a die landed at an angle no die can land at: ${[...angles].join(', ')}`);

  // A letter that reads as another one upside down carries its underline.
  const reversible = mine.filter((tile) => ['M', 'W', 'N', 'Z'].includes(tile.letter));
  if (reversible.length > 0) {
    console.log(`  reversible letters on this grid: ${reversible.map((t) => t.letter).join(', ')}`);
    check(
      reversible.every((tile) => tile.underlined),
      'a letter that reads as another one upside down was left unmarked',
    );
  } else {
    console.log('  no M, W, N or Z on this grid, nothing to underline');
  }

  // The throw belongs to the grid, so playing on it must not reshuffle it.
  await sendWords(page, ['ZZZZA']);
  const again = await readGrid(page);
  console.log(`  the throw survives a submission: ${JSON.stringify(mine) === JSON.stringify(again)}`);
  check(JSON.stringify(mine) === JSON.stringify(again), 'the dice turned again while the round was running');

  await hostContext.close();
  await guestContext.close();
}

// ---------------------------------------------------------------------------
console.log('\n── Dice set upright, for whoever wants them that way ──');
{
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const { page } = await host(context, ['sans limite', 'toutes droites']);
  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForTimeout(3200);

  const grid = await readGrid(page);
  const turned = grid.filter((tile) => tile.turn !== '').length;
  const marked = grid.filter((tile) => tile.underlined).length;
  console.log(`  dice not upright: ${turned} (0 expected), underlined: ${marked} (0 expected)`);
  check(turned === 0, 'a die was turned although the grid was set upright');
  check(marked === 0, 'letters were underlined although no die can be upside down');

  await context.close();
}

// ---------------------------------------------------------------------------
console.log('\n── Awards: two ways of playing, told apart ──');
{
  const hostContext = await browser.newContext({ viewport: { width: 1000, height: 1200 } });
  const guestContext = await browser.newContext({ viewport: { width: 1000, height: 1200 } });
  const { page, code } = await host(hostContext, ['sans limite', '1 manche', 'comptés pour tous']);
  const guest = await join(guestContext, code, 'Invite');

  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForTimeout(3200);

  const cells = (await page.locator('[data-cell]').allTextContents()).map((cell) => cell.trim());
  const solved = solveBoard({ size: Math.sqrt(cells.length), cells }, dictionary, {
    minWordLength: 3,
    qEqualsQu: false,
  });
  const byLength = [...solved.words.keys()].sort((a, b) => b.length - a.length);
  const longest = byLength[0];

  // The host goes for the long words, and only sends what will pass.
  await sendWords(page, byLength.slice(0, 4));
  // The guest hammers away at words that do not exist.
  await sendWords(guest, ['ZZZZA', 'ZZZZB', 'ZZZZC', 'ZZZZD', 'ZZZZE', 'ZZZZF', 'ZZZZG', 'ZZZZH']);
  await sendWords(guest, byLength.slice(-2));

  await page.getByRole('button', { name: 'Voir les solutions' }).click();
  await page.waitForTimeout(900);
  await guest.getByRole('button', { name: 'Voir les solutions' }).click();
  await page.waitForTimeout(600);

  const palmares = page.locator('section', { has: page.getByRole('heading', { name: /Palmarès/ }) });
  const shown = await palmares.count();
  console.log(`  the awards are shown at the end of the game: ${shown > 0}`);
  check(shown > 0, 'no awards at the end of the game');

  if (shown > 0) {
    const cards = await palmares.first().locator('ul').count();
    const text = await palmares.first().innerText();
    console.log(`  cards: ${cards} (one per player)`);
    console.log(`  ${text.replace(/\n+/g, ' | ')}`);
    check(cards === 2, `${cards} award cards for 2 players`);
    check(text.includes('Hote') && text.includes('Invite'), 'a player was left out of the awards');
    check(
      text.includes(longest),
      `the longest word of the game (${longest}) is not what earned the Gros Cerveau`,
    );
    check(text.includes('Force Brute'), 'sending eight words that do not exist earned no Force Brute');

    // Nobody leaves empty-handed: every card carries at least one line.
    const perCard = await palmares.first().locator('ul').evaluateAll((lists) => lists.map((list) => list.children.length));
    console.log(`  awards per player: ${perCard.join(', ')}`);
    check(perCard.every((count) => count >= 1), 'a player left the game with no award at all');
    check(perCard.every((count) => count <= 3), 'a player walked off with more than three awards');

    /*
     * The awards have to tell the two players apart. An award held by everyone
     * in the room describes nobody: if both players are the hare, "hare" has
     * stopped meaning anything.
     */
    const names = await palmares.first().locator('li > span:nth-child(2) > span:first-child').allTextContents();
    const held = new Map();
    for (const name of names) held.set(name.trim(), (held.get(name.trim()) ?? 0) + 1);
    const shared = [...held.entries()].filter(([, count]) => count === 2).map(([name]) => name);
    console.log(`  awards handed out: ${[...held.keys()].join(', ')}`);
    console.log(`  held by both players: ${shared.length === 0 ? 'none' : shared.join(', ')}`);
    check(shared.length === 0, `both players received: ${shared.join(', ')}`);
  }

  // The guest sees the same awards, from their own side.
  const guestText = await guest
    .locator('section', { has: guest.getByRole('heading', { name: /Palmarès/ }) })
    .first()
    .innerText()
    .catch(() => '');
  console.log(`  the guest sees the awards too: ${guestText.includes('Force Brute')}`);
  check(guestText.includes('Force Brute'), 'the guest was not shown the awards');

  await hostContext.close();
  await guestContext.close();
}

// ---------------------------------------------------------------------------
console.log('\n── No awards before the last round ──');
{
  const context = await browser.newContext({ viewport: { width: 1000, height: 1200 } });
  const { page } = await host(context, ['sans limite', '3 manches']);
  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForTimeout(3200);
  await page.getByRole('button', { name: 'Voir les solutions' }).click();
  await page.waitForTimeout(900);

  const early = await page.getByRole('heading', { name: /Palmarès/ }).count();
  console.log(`  awards after round 1 of 3: ${early} (0 expected)`);
  check(early === 0, 'the awards were handed out before the game was over');

  await context.close();
}

await browser.close();

console.log('');
if (problems.length === 0) console.log('OK: the dice fall as they should, and the awards describe the players');
else for (const problem of problems) console.log(`✗ ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;
