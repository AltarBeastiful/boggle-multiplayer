#!/usr/bin/env node
/**
 * Checks that a round starting behind the player's back is announced by the
 * tab itself, and that the tab shuts up on its own afterwards.
 *
 *   node scripts/test-alert.mjs [url]
 *
 * Headless Chromium keeps every page visible, whichever one is in front, so
 * the hiding is emulated: `document.visibilityState` is overridden before the
 * page loads and the event is dispatched by hand. What is under test is the
 * app's reaction to a hidden tab, not the browser's own bookkeeping.
 *
 * Two pages, because the point is what the *other* player's tab does while the
 * host presses the button.
 */

import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5173/';
const BASE = URL.replace(/\/$/, '');
const problems = [];
const check = (condition, failure) => {
  if (!condition) problems.push(failure);
};

/** Lets the test hide a page from the app without a real tab switch. */
const emulateVisibility = `
  let hidden = false;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  window.__hide = (value) => {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  };
`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
await context.addInitScript(emulateVisibility);

/** Opens a room, optionally setting the round duration, and returns its code. */
async function openRoom(duration) {
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error (hôte): ${error.message}`));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.fill('#nickname', 'Hote');
  await page.getByRole('button', { name: 'Créer une partie' }).click();
  if (duration) {
    await page.locator('details > summary').first().click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: duration, exact: true }).first().click();
    await page.waitForTimeout(200);
  }
  const code = (await page.locator('.font-mono.text-6xl').textContent()).trim();
  return { page, code };
}

async function joinRoom(code) {
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error (invité): ${error.message}`));
  await page.goto(`${BASE}/r/${code}`, { waitUntil: 'networkidle' });
  await page.fill('#nickname', 'Invite');
  await page.getByRole('button', { name: /Rejoindre/ }).click();
  await page.waitForTimeout(400);
  return page;
}

const tab = (page) =>
  page.evaluate(() => ({
    title: document.title,
    icon: document.querySelector('link[rel~="icon"]')?.getAttribute('href') ?? null,
  }));

/** Watches the tab for a while and reports every state it went through. */
async function watch(page, ms) {
  const titles = new Set();
  const icons = new Set();
  for (let waited = 0; waited < ms; waited += 150) {
    const state = await tab(page);
    titles.add(state.title);
    icons.add(state.icon);
    await page.waitForTimeout(150);
  }
  return { titles: [...titles], icons: [...icons] };
}

/** The tab as it is served, before anything calls out. */
const RESTING = { title: 'Boggle multijoueur', icon: '/favicon.svg' };

// ---------------------------------------------------------------------------
console.log('\n── Both icons are actually served ──');
{
  const page = await context.newPage();
  for (const path of ['/favicon.svg', '/favicon-alert.svg']) {
    const response = await page.request.get(`${BASE}${path}`);
    check(response.ok(), `${path} répond ${response.status()}`);
  }
  await page.close();
}

// ---------------------------------------------------------------------------
console.log('\n── The round starts while the guest is looking elsewhere ──');
{
  const { page: host, code } = await openRoom();
  const guest = await joinRoom(code);

  const resting = await tab(guest);
  check(
    resting.title === RESTING.title && resting.icon === RESTING.icon,
    `l'onglet au repos n'est pas celui attendu : ${resting.title} / ${resting.icon}`,
  );

  await guest.evaluate(() => window.__hide(true));
  await host.getByRole('button', { name: 'Lancer la partie' }).click();

  const seen = await watch(guest, 3000);
  console.log('  titres :', seen.titles.join(' | '));
  console.log('  icônes :', seen.icons.join(' | '));

  check(
    seen.titles.some((title) => title.includes('À vous')),
    `l'onglet n'a jamais appelé : ${seen.titles.join(' | ')}`,
  );
  check(
    seen.titles.includes(RESTING.title),
    'le titre ne revient pas au nom du jeu entre deux battements',
  );
  check(
    seen.icons.some((icon) => icon?.includes('favicon-alert')),
    `l'icône ne s'allume pas : ${seen.icons.join(' | ')}`,
  );
  check(seen.icons.length > 1, "l'icône ne bat pas, elle reste fixe");

  // The host watched the countdown on screen; nothing should have moved there.
  const hostTab = await tab(host);
  check(
    hostTab.title === RESTING.title,
    `l'onglet de l'hôte, sous ses yeux, a clignoté : ${hostTab.title}`,
  );

  console.log('\n── Coming back is enough to stop it ──');
  await guest.evaluate(() => window.__hide(false));
  await guest.waitForTimeout(300);
  const back = await tab(guest);
  check(back.title === RESTING.title, `titre non rendu : ${back.title}`);
  check(back.icon === RESTING.icon, `icône non rendue : ${back.icon}`);

  // And it stays quiet: the call was for the round the player has now joined.
  const after = await watch(guest, 1500);
  check(
    after.titles.length === 1 && after.titles[0] === RESTING.title,
    `l'onglet continue de clignoter : ${after.titles.join(' | ')}`,
  );

  await host.close();
  await guest.close();
}

// ---------------------------------------------------------------------------
console.log('\n── A round that ends without them takes the call back ──');
{
  const { page: host, code } = await openRoom('sans limite');
  const guest = await joinRoom(code);

  await guest.evaluate(() => window.__hide(true));
  await host.getByRole('button', { name: 'Lancer la partie' }).click();
  await guest.waitForTimeout(2500);
  check((await tab(guest)).icon !== null, "l'onglet de l'invité n'existe plus");

  // The host closes the round; the guest never came back to look.
  await host.getByRole('button', { name: 'Voir les solutions' }).first().click();
  await guest.waitForTimeout(600);

  const quiet = await watch(guest, 1500);
  check(
    quiet.titles.length === 1 && quiet.titles[0] === RESTING.title,
    `l'onglet appelle encore pour une manche terminée : ${quiet.titles.join(' | ')}`,
  );
  check(
    quiet.icons.length === 1 && quiet.icons[0] === RESTING.icon,
    `l'icône reste allumée après la manche : ${quiet.icons.join(' | ')}`,
  );

  await host.close();
  await guest.close();
}

await browser.close();

if (problems.length > 0) {
  console.log(`\n✗ ${problems.length} problème(s)`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log('\n✓ tout est conforme');
