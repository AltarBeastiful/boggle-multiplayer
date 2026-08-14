#!/usr/bin/env node
/**
 * Vérifie le tracé des mots, au doigt et à la souris.
 *
 *   node scripts/test-trace.mjs [url]
 *
 * Le tactile passe par le navigateur lui-même (CDP Input.dispatchTouchEvent) et
 * non par un `dispatchEvent` de page : la capture du pointeur, `touch-action` et
 * le défilement se comportent donc comme sous un vrai doigt.
 *
 * Le mot tracé est choisi en résolvant la grille : tracer trois lettres au
 * hasard ne prouve rien, un mot inexistant étant refusé, ce qui ressemble à une
 * panne du tracé alors que c'est le comportement attendu.
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

async function scenario({ nom, contexte, tactile }) {
  console.log(`\n── ${nom} ──`);
  const browser = await chromium.launch();
  const context = await browser.newContext(contexte);
  const page = await context.newPage();
  const cdp = tactile ? await context.newCDPSession(page) : null;
  page.on('pageerror', (error) => problems.push(`${nom} : erreur de page ${error.message}`));

  const centre = async (index) => {
    const box = await page.locator(`[data-cell="${index}"]`).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  try {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.fill('#nickname', 'Testeur');
    await page.getByRole('button', { name: 'Créer une partie' }).click();
    await page.getByRole('button', { name: 'Lancer la partie' }).click();
    await page.waitForTimeout(3200); // décompte d'avant-manche

    const cells = (await page.locator('[data-cell]').allTextContents()).map((c) => c.trim());
    const board = { size: Math.sqrt(cells.length), cells };
    const solution = solveBoard(board, dictionary, { minWordLength: 3, qEqualsQu: false });
    const word = [...solution.words.keys()].sort((a, b) => b.length - a.length)[0];
    const path = findPath(board, word);
    console.log(`  grille ${cells.join('')}, mot ${word} par ${path.join(',')}`);

    const toggle = page.locator('button[aria-pressed]');
    const parDefaut = await toggle.getAttribute('aria-pressed');
    console.log(`  tracé actif par défaut : ${parDefaut}`);
    if (parDefaut !== 'true') await toggle.click();
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') problems.push(`${nom} : activation impossible`);

    // -- le geste ------------------------------------------------------------
    const points = [];
    for (const index of path) points.push(await centre(index));

    if (tactile) {
      const touch = (type, point) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x: point.x, y: point.y, id: 1 }],
        });
      await touch('touchStart', points[0]);
      await page.waitForTimeout(70);
      for (const point of points.slice(1)) {
        await touch('touchMove', point);
        await page.waitForTimeout(60);
      }
      await touch('touchEnd', points[points.length - 1]);
    } else {
      await page.mouse.move(points[0].x, points[0].y);
      await page.mouse.down();
      for (const point of points.slice(1)) {
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(60);
      }
      await page.mouse.up();
    }
    await page.waitForTimeout(400);

    const input = page.locator('input[aria-label="Mot trouvé"]');
    const apresGeste = await input.inputValue();
    const motsAvantEnvoi = await page.locator('.flex-1 button').count();
    console.log(`  champ après le geste : ${JSON.stringify(apresGeste)}`);
    console.log(`  mots soumis avant l'envoi : ${motsAvantEnvoi} (0 attendu)`);

    // -- l'envoi explicite ---------------------------------------------------
    await page.getByRole('button', { name: 'Envoyer le mot' }).click();
    await page.waitForTimeout(500);
    const mots = (await page.locator('.flex-1 button').allTextContents()).map((m) => m.trim());
    const champApresEnvoi = await input.inputValue();
    const defilement = await page.evaluate(() => window.scrollY);
    console.log(`  mots soumis : ${JSON.stringify(mots)}`);
    console.log(`  champ vidé après envoi : ${champApresEnvoi === ''}`);
    console.log(`  page défilée : ${defilement}px`);

    if (apresGeste !== word) problems.push(`${nom} : champ ${apresGeste} au lieu de ${word}`);
    if (motsAvantEnvoi !== 0) problems.push(`${nom} : le mot est parti sans qu'on l'envoie`);
    if (!mots.some((m) => m.startsWith(word))) problems.push(`${nom} : ${word} non soumis`);
    if (champApresEnvoi !== '') problems.push(`${nom} : champ non vidé après envoi`);
    if (defilement !== 0) problems.push(`${nom} : la page a défilé pendant le geste`);
  } finally {
    await browser.close();
  }
}

await scenario({ nom: 'Tactile (Pixel 7)', contexte: { ...devices['Pixel 7'] }, tactile: true });
await scenario({
  nom: 'Souris (bureau 1440x900)',
  contexte: { viewport: { width: 1440, height: 900 }, hasTouch: false },
  tactile: false,
});

console.log('');
if (problems.length === 0) console.log('✓ tracé au doigt et à la souris : conforme');
else for (const p of problems) console.log(`✗ ${p}`);
process.exitCode = problems.length === 0 ? 0 : 1;
