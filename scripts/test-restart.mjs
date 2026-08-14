#!/usr/bin/env node
/**
 * A deploy in the middle of a round must not end it.
 *
 *   npm run build && node scripts/test-restart.mjs
 *
 * The test runs its own server on a spare port, with its own state directory,
 * so it can kill it the way a deploy does and start it again. The browser is
 * never told: it reconnects on its own, which is the point.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { buildDictionary, solveBoard } from '@boggle/shared';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'server/package.json'));
const dictionary = buildDictionary(require('an-array-of-french-words'));

const PORT = Number(process.env.PORT ?? 3099);
const URL = `http://localhost:${PORT}/`;
const stateDir = mkdtempSync(join(tmpdir(), 'boggle-restart-'));
const problems = [];
const check = (condition, failure) => {
  if (!condition) problems.push(failure);
};

let server = null;

function startServer() {
  return new Promise((done, fail) => {
    server = spawn('node', [resolve(root, 'server/dist/index.js')], {
      env: { ...process.env, PORT: String(PORT), BOGGLE_STATE_DIR: stateDir, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const timeout = setTimeout(() => fail(new Error('the server did not start')), 60_000);
    server.stdout.on('data', (chunk) => {
      const line = String(chunk);
      if (/room\(s\) picked up/.test(line)) console.log(`  ${line.trim()}`);
      if (line.includes('Boggle multiplayer on')) {
        clearTimeout(timeout);
        done();
      }
    });
  });
}

/** Stops it the way a deploy does, with a signal rather than a kill. */
function stopServer() {
  return new Promise((done) => {
    if (!server) return done();
    server.once('exit', () => done());
    server.kill('SIGTERM');
  });
}

const browser = await chromium.launch();
try {
  console.log('\n── A round is under way ──');
  await startServer();

  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.fill('#nickname', 'Alfred');
  await page.getByRole('button', { name: 'Créer une partie' }).click();
  await page.waitForTimeout(500);
  const code = (await page.locator('.font-mono.text-6xl').textContent()).trim();
  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForTimeout(3200);

  const cells = (await page.locator('[data-cell]').allTextContents()).map((cell) => cell.trim());
  const solved = solveBoard({ size: Math.sqrt(cells.length), cells }, dictionary, {
    minWordLength: 3,
    qEqualsQu: false,
  });
  const words = [...solved.words.keys()].sort((a, b) => b.length - a.length).slice(0, 5);
  const input = page.locator('input[aria-label="Mot trouvé"]');
  for (const word of words) {
    await input.fill(word);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);

  const before = (await page.locator('.flex-1 button').allTextContents()).map((text) => text.trim());
  console.log(`  room ${code}, grid ${cells.join('')}, ${before.length} words found`);
  check(before.length === words.length, `only ${before.length} of ${words.length} words were accepted`);

  console.log('\n── The server is restarted, as a deploy would ──');
  await stopServer();
  await page.waitForTimeout(1500);
  await startServer();

  // The browser reconnects by itself; give Socket.IO its backoff.
  await page.waitForTimeout(6000);

  const stillPlaying = await page.locator('input[aria-label="Mot trouvé"]').count();
  const after = (await page.locator('.flex-1 button').allTextContents()).map((text) => text.trim());
  const sameGrid = (await page.locator('[data-cell]').allTextContents())
    .map((cell) => cell.trim())
    .join('');
  console.log(`  still in the round: ${stillPlaying > 0}`);
  console.log(`  same grid: ${sameGrid === cells.join('')}`);
  console.log(`  words back: ${after.length} of ${before.length}`);
  check(stillPlaying > 0, 'the round did not survive the restart');
  check(sameGrid === cells.join(''), 'the grid changed across the restart');
  check(after.length === before.length, `${after.length} words came back instead of ${before.length}`);

  // And the round still ends by itself, on the clock it left with.
  const extra = [...solved.words.keys()].find((word) => !words.includes(word));
  await input.fill(extra);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const afterExtra = await page.locator('.flex-1 button').count();
  console.log(`  a word submitted after the restart is accepted: ${afterExtra === before.length + 1}`);
  check(afterExtra === before.length + 1, 'a word could not be submitted after the restart');

  console.log('\n── The buzzer went while the server was down ──');
  await stopServer();
  // Rather than wait out a whole round, the saved clock is moved into the past,
  // which is exactly the state a long deploy would leave behind.
  const record = join(stateDir, `room-${code}.json`);
  const saved = JSON.parse(readFileSync(record, 'utf8'));
  saved.round.endsAt = Date.now() - 5000;
  writeFileSync(record, JSON.stringify(saved));
  await startServer();
  await page.waitForTimeout(6000);

  const overBanner = await page.locator('text=Manche terminée').count();
  const solutionsOffered = await page.getByRole('button', { name: 'Voir les solutions' }).count();
  const inputGone = await page.locator('input[aria-label="Mot trouvé"]').count();
  console.log(`  the round is closed: ${overBanner > 0}, solutions offered: ${solutionsOffered > 0}`);
  console.log(`  the input is gone: ${inputGone === 0}`);
  check(overBanner > 0, 'the round resumed instead of ending on the clock it left with');
  check(solutionsOffered > 0, 'the solutions were not offered after the round closed');
  check(inputGone === 0, 'words could still be submitted after the round should have ended');

  console.log('\n── A room nobody came back to ──');
  await context.close();
  await stopServer();
  await startServer();
  const orphan = await fetch(`${URL}api/rooms/${code}`).then((response) => response.json());
  console.log(`  the room is still there for its players: ${orphan.exists}`);
  check(orphan.exists, 'the room was dropped although its half hour had not run out');
} finally {
  await browser.close();
  await stopServer();
  rmSync(stateDir, { recursive: true, force: true });
}

console.log('');
if (problems.length === 0) console.log('OK: a restart does not end a round');
else for (const problem of problems) console.log(`✗ ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;
