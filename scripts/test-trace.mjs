#!/usr/bin/env node
/**
 * Vérifie la composition d'un mot sur la grille : appuis, glissé, clics souris.
 *
 *   node scripts/test-trace.mjs [url]
 *
 * Le tactile passe par le navigateur lui-même (CDP Input.dispatchTouchEvent) et
 * non par un `dispatchEvent` de page : la capture du pointeur, `touch-action` et
 * le défilement se comportent donc comme sous un vrai doigt.
 *
 * Le mot est choisi en résolvant la grille : composer trois lettres au hasard ne
 * prouve rien, un mot inexistant étant refusé à juste titre, ce qui se lit
 * comme une panne de la saisie.
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

async function scenario({ nom, contexte, geste }) {
  console.log(`\n── ${nom} ──`);
  const browser = await chromium.launch();
  const context = await browser.newContext(contexte);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.on('pageerror', (error) => problems.push(`${nom} : erreur de page ${error.message}`));

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
    await page.waitForTimeout(3200); // décompte d'avant-manche

    const cells = (await page.locator('[data-cell]').allTextContents()).map((c) => c.trim());
    const board = { size: Math.sqrt(cells.length), cells };
    const solution = solveBoard(board, dictionary, { minWordLength: 4, qEqualsQu: false });
    const word = [...solution.words.keys()].sort((a, b) => b.length - a.length)[0];
    const path = findPath(board, word);
    console.log(`  grille ${cells.join('')}, mot ${word} par ${path.join(',')}`);

    await geste({ page, cdp, centre, path });
    await page.waitForTimeout(300);

    const compose = await input.inputValue();
    const avantEnvoi = await page.locator('.flex-1 button').count();
    console.log(`  champ après le geste : ${JSON.stringify(compose)}`);
    console.log(`  mots soumis avant l'envoi : ${avantEnvoi} (0 attendu)`);

    await page.getByRole('button', { name: 'Envoyer le mot' }).click();
    await page.waitForTimeout(500);
    const mots = (await page.locator('.flex-1 button').allTextContents()).map((m) => m.trim());
    const champVide = (await input.inputValue()) === '';
    const defilement = await page.evaluate(() => window.scrollY);
    console.log(`  mots soumis : ${JSON.stringify(mots)}`);
    console.log(`  champ vidé : ${champVide}, page défilée : ${defilement}px`);

    if (compose !== word) problems.push(`${nom} : champ « ${compose} » au lieu de « ${word} »`);
    if (avantEnvoi !== 0) problems.push(`${nom} : mot parti sans qu'on l'envoie`);
    if (!mots.some((m) => m.startsWith(word))) problems.push(`${nom} : ${word} non soumis`);
    if (!champVide) problems.push(`${nom} : champ non vidé après envoi`);
    if (defilement !== 0) problems.push(`${nom} : la page a défilé`);
  } finally {
    await browser.close();
  }
}

/** Un appui franc sur une case, comme un doigt qui tapote. */
const tap = async (cdp, point) => {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const mobile = { ...devices['Pixel 7'] };
const bureau = { viewport: { width: 1440, height: 900 }, hasTouch: false };

// Le cas signalé : la lettre apparaissait puis disparaissait aussitôt.
await scenario({
  nom: 'Appuis successifs (tactile)',
  contexte: mobile,
  geste: async ({ page, cdp, centre, path }) => {
    for (const [rang, index] of path.entries()) {
      await tap(cdp, await centre(index));
      await page.waitForTimeout(140);
      const valeur = await page.locator('input[aria-label="Mot trouvé"]').inputValue();
      if (rang === 0 && valeur.length === 0) {
        problems.push('Appuis : la première lettre disparaît après le relâchement');
      }
    }
  },
});

await scenario({
  nom: 'Glissé du doigt (tactile)',
  contexte: mobile,
  geste: async ({ page, cdp, centre, path }) => {
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
  nom: 'Clics souris (bureau)',
  contexte: bureau,
  geste: async ({ page, centre, path }) => {
    for (const index of path) {
      const point = await centre(index);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(110);
    }
  },
});

console.log('');
if (problems.length === 0) console.log('✓ appuis, glissé et clics : conformes');
else for (const p of problems) console.log(`✗ ${p}`);
process.exitCode = problems.length === 0 ? 0 : 1;
