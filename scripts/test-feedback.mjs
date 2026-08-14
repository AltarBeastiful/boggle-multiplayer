#!/usr/bin/env node
/**
 * Vérifie les retours donnés au joueur : message de refus, halo autour de la
 * grille, et surtout que le mot accepté est retracé sur *ses* cases.
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

/** Tous les chemins traçant un mot : c'est ce qui permet d'en choisir un autre. */
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
const allumees = () =>
  page.$$eval('[data-cell]', (els) =>
    els.filter((e) => e.className.includes('bg-tile-active')).map((e) => Number(e.dataset.cell)),
  );

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.fill('#nickname', 'Retours');
  await page.getByRole('button', { name: 'Créer une partie' }).click();
  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForTimeout(3200);

  // -- 1. Message de refus ---------------------------------------------------
  await input.fill('XQJKW');
  await page.getByRole('button', { name: 'Envoyer le mot' }).click();
  await page.waitForTimeout(350);
  const message = (await page.locator('[role=status]').last().textContent()) ?? '';
  const halo = await page.locator('.animate-reject').count();
  const surLesDes = await page.evaluate(() => {
    const h = document.querySelector('.animate-reject');
    const d = document.querySelector('[data-cell="5"]');
    if (!h || !d) return null;
    const a = h.getBoundingClientRect();
    const b = d.getBoundingClientRect();
    // Le halo ne doit pas recouvrir une case : il l'entoure.
    return a.top <= b.top && a.bottom >= b.bottom && getComputedStyle(h).backgroundColor;
  });
  console.log(`  message affiché : ${JSON.stringify(message.trim())}`);
  console.log(`  halo présent    : ${halo === 1}`);
  console.log(`  fond du halo    : ${surLesDes} (transparent attendu : il n'occulte rien)`);
  if (!message.includes('XQJKW')) problems.push('aucun message de refus');
  if (halo !== 1) problems.push('pas de halo de refus');

  await page.waitForTimeout(1600); // le message s'efface tout seul
  const apres = (await page.locator('[role=status]').last().textContent()) ?? '';
  console.log(`  message après 1,6 s : ${JSON.stringify(apres.trim())} (vide attendu)`);
  if (apres.trim() !== '') problems.push('le message ne disparaît pas');

  // -- 2. Le mot accepté est retracé sur les cases du joueur -----------------
  const cells = (await page.locator('[data-cell]').allTextContents()).map((c) => c.trim());
  const board = { size: Math.sqrt(cells.length), cells };
  const solution = solveBoard(board, dictionary, { minWordLength: 3, qEqualsQu: false });

  let cible = null;
  for (const word of solution.words.keys()) {
    const paths = allPaths(board, word);
    if (paths.length >= 2) {
      cible = { word, paths };
      break;
    }
  }

  if (!cible) {
    console.log('  (aucun mot traçable de deux façons sur cette grille, contrôle sauté)');
  } else {
    // On compose volontairement par le *second* chemin.
    const choisi = cible.paths[1];
    console.log(`  ${cible.word} : ${cible.paths.length} chemins, on compose par ${choisi.join(',')}`);
    for (const index of choisi) {
      const point = await centre(index);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(90);
    }
    console.log(`  champ composé : ${JSON.stringify(await input.inputValue())}`);
    await page.getByRole('button', { name: 'Envoyer le mot' }).click();
    await page.waitForTimeout(150);
    const trace = await allumees();
    console.log(`  cases retracées : ${trace.join(',')}`);
    console.log(`  cases du joueur : ${choisi.join(',')}`);
    console.log(`  premier chemin du solveur : ${cible.paths[0].join(',')}`);
    if (trace.join(',') !== [...choisi].sort((a, b) => a - b).join(',') && trace.join(',') !== choisi.join(',')) {
      problems.push(`retracé sur ${trace.join(',')} au lieu des cases du joueur ${choisi.join(',')}`);
    }
  }

  console.log('');
  if (problems.length === 0) console.log('✓ retours au joueur : conformes');
  else for (const p of problems) console.log(`✗ ${p}`);
  process.exitCode = problems.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}
