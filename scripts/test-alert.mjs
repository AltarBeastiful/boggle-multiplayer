#!/usr/bin/env node
/**
 * Checks that a round starting behind the player's back is announced, on the
 * application icon and on the tab, and that both go quiet on their own
 * afterwards.
 *
 *   node scripts/test-alert.mjs [url]
 *
 * Headless Chromium keeps every page visible, whichever one is in front, so
 * the hiding is emulated: `document.visibilityState` is overridden before the
 * page loads and the event is dispatched by hand. What is under test is the
 * app's reaction to a hidden tab, not the browser's own bookkeeping.
 *
 * The badge and the notification are stubbed for the same reason: one only
 * marks an installed application and the other opens a real permission prompt,
 * neither of which a test browser has. What is under test is that the game
 * asks, and unasks, at the right moments and no others.
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
  let permission = 'default';
  window.__notified = [];
  window.__asked = 0;
  window.__setPermission = (value) => {
    permission = value;
  };
  window.Notification = class {
    static get permission() {
      return permission;
    }
    static requestPermission() {
      window.__asked += 1;
      permission = 'granted';
      return Promise.resolve(permission);
    }
    constructor(title, options) {
      this.index = window.__notified.push({ title, options, closed: false }) - 1;
    }
    close() {
      window.__notified[this.index].closed = true;
    }
  };
  window.__badge = [];
  navigator.setAppBadge = (count) => {
    window.__badge.push(count === undefined ? 'dot' : String(count));
    return Promise.resolve();
  };
  navigator.clearAppBadge = () => {
    window.__badge.push('clear');
    return Promise.resolve();
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

/** Everything the page asked of the application icon, in order. */
const badges = (page) => page.evaluate(() => window.__badge);

/** Every notification the page raised, and whether it has been taken back. */
const notified = (page) => page.evaluate(() => window.__notified);

const bell = (page) => page.getByRole('button', { name: /Prévenir au début de la manche/ });

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
console.log('\n── The game can be installed, which is what the badge needs ──');
{
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  const linked = await page.getAttribute('link[rel="manifest"]', 'href');
  check(linked === '/manifest.webmanifest', `manifeste non déclaré : ${linked}`);

  const response = await page.request.get(`${BASE}/manifest.webmanifest`);
  check(response.ok(), `le manifeste répond ${response.status()}`);
  const manifest = response.ok() ? await response.json() : {};
  check(Boolean(manifest.name), 'le manifeste est sans nom');
  check(manifest.start_url === '/', `start_url inattendu : ${manifest.start_url}`);
  check(
    ['standalone', 'minimal-ui', 'fullscreen'].includes(manifest.display),
    `display «\u00a0${manifest.display}\u00a0» : Chrome ne proposera pas l'installation`,
  );
  check(
    (manifest.icons ?? []).some((icon) => icon.purpose?.includes('maskable')),
    'aucune icône maskable : le dock rognera ce qu\'il veut',
  );

  // Chrome asks for both of these by size before it offers to install at all.
  for (const wanted of [192, 512]) {
    const icon = (manifest.icons ?? []).find((entry) => entry.sizes === `${wanted}x${wanted}`);
    if (!icon) {
      problems.push(`le manifeste ne déclare pas d'icône ${wanted}x${wanted}`);
      continue;
    }
    const png = await page.request.get(`${BASE}${icon.src}`);
    if (!png.ok()) {
      problems.push(`${icon.src} répond ${png.status()}`);
      continue;
    }
    // The declared size is a promise; read the PNG header and hold it to it.
    const bytes = await png.body();
    const header = bytes.subarray(0, 8).toString('hex');
    check(header === '89504e470d0a1a0a', `${icon.src} n'est pas un PNG`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    check(
      width === wanted && height === wanted,
      `${icon.src} annonce ${wanted}x${wanted} et mesure ${width}x${height}`,
    );
    console.log(`  ${icon.src} : ${width}x${height}, ${(bytes.length / 1024).toFixed(1)} ko`);
  }

  await page.close();
}

// ---------------------------------------------------------------------------
console.log('\n── The permission is asked for by the player, never by the game ──');
{
  const { page: host } = await openRoom();

  check(
    (await host.evaluate(() => window.__asked)) === 0,
    'le jeu a ouvert la demande de permission tout seul',
  );
  check(await bell(host).isVisible(), "la cloche n'est pas dans l'en-tête du salon");
  check(
    (await bell(host).getAttribute('aria-pressed')) === 'false',
    'la cloche se dit allumée sans que personne ne l\'ait demandée',
  );

  await bell(host).click();
  await host.waitForTimeout(200);
  check((await host.evaluate(() => window.__asked)) === 1, "le clic n'a pas ouvert la demande");
  check(
    (await bell(host).getAttribute('aria-pressed')) === 'true',
    'la cloche reste éteinte après une permission accordée',
  );

  // And off again without spending the permission, which is not ours to undo.
  await bell(host).click();
  await host.waitForTimeout(200);
  check(
    (await bell(host).getAttribute('aria-pressed')) === 'false',
    'la cloche ne se laisse pas éteindre',
  );
  check(
    (await host.evaluate(() => window.__asked)) === 1,
    'éteindre la cloche a redemandé la permission au navigateur',
  );

  await host.close();
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

  check(
    (await notified(guest)).length === 0,
    "un joueur qui n'a rien demandé a reçu une notification",
  );

  const marks = await badges(guest);
  console.log('  icône appli :', marks.join(' | ') || '(rien)');
  check(marks.at(-1) === 'dot', `l'icône de l'appli n'est pas marquée : ${marks.join(' | ')}`);

  // The host watched the countdown on screen; nothing should have moved there.
  const hostTab = await tab(host);
  check(
    hostTab.title === RESTING.title,
    `l'onglet de l'hôte, sous ses yeux, a clignoté : ${hostTab.title}`,
  );
  check(
    (await badges(host)).length === 0,
    "l'icône de l'hôte a été marquée alors qu'il regardait la grille",
  );

  console.log('\n── Coming back is enough to stop it ──');
  await guest.evaluate(() => window.__hide(false));
  await guest.waitForTimeout(300);
  const back = await tab(guest);
  check(back.title === RESTING.title, `titre non rendu : ${back.title}`);
  check(back.icon === RESTING.icon, `icône non rendue : ${back.icon}`);
  check(
    (await badges(guest)).at(-1) === 'clear',
    "la pastille reste sur l'icône de l'appli après le retour du joueur",
  );

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
console.log('\n── A player who asked is told, wherever they are ──');
{
  const { page: host, code } = await openRoom();
  const guest = await joinRoom(code);

  await bell(guest).click();
  await guest.waitForTimeout(200);
  await guest.evaluate(() => window.__hide(true));
  await host.getByRole('button', { name: 'Lancer la partie' }).click();
  await guest.waitForTimeout(1200);

  const raised = await notified(guest);
  console.log('  notifications :', raised.map((n) => `${n.title} / ${n.options?.body}`).join(' | '));
  check(raised.length === 1, `${raised.length} notification(s) au lieu d'une`);

  const first = raised[0] ?? { options: {} };
  check(first.title?.includes('À vous'), `titre inattendu : ${first.title}`);
  check(
    first.options?.body?.includes('Manche 1') && first.options?.body?.includes(code),
    `corps sans la manche ni la salle : ${first.options?.body}`,
  );
  // Tagged, so a second round replaces the first instead of stacking on it.
  check(first.options?.tag === 'boggle-round', `étiquette inattendue : ${first.options?.tag}`);
  check(first.options?.icon === '/icon-192.png', `icône inattendue : ${first.options?.icon}`);

  // The host is looking at the countdown and asked for nothing.
  check((await notified(host)).length === 0, "l'hôte, devant sa grille, a été notifié");

  await guest.evaluate(() => window.__hide(false));
  await guest.waitForTimeout(300);
  check(
    (await notified(guest))[0]?.closed === true,
    'la notification reste affichée pour une manche déjà rejointe',
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
  check(
    (await badges(guest)).at(-1) === 'clear',
    "la pastille survit à la manche qu'elle annonçait",
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
