#!/usr/bin/env node
/**
 * Renders the application icon to the PNGs an install needs.
 *
 *   node scripts/build-icons.mjs
 *
 * A web app manifest may point at an SVG, and this one does, but installing is
 * gated on raster icons: Chrome wants a 192 and a 512 before it will offer the
 * app at all, Windows and macOS want a bitmap to put in the taskbar and the
 * dock, and iOS reads `apple-touch-icon` and nothing else. So the SVG stays the
 * source and the PNGs are built from it.
 *
 * Chromium does the rendering, because Playwright is already here for the
 * end-to-end scripts and no other rasteriser is. The letter is drawn with
 * whatever the machine resolves `system-ui` to, so the output is not
 * byte-identical from one machine to the next; the PNGs are committed and
 * rebuilt on purpose, not on every build.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'client', 'public');
const source = readFileSync(join(publicDir, 'icon.svg'), 'utf8');

/** 180 for iOS, 192 and 512 for the manifest, which asks for both by name. */
const SIZES = [180, 192, 512];

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    // The SVG scales to the viewport; the margin would otherwise inset it.
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
    );
    const png = await page.locator('svg').screenshot({ omitBackground: true });
    const file = join(publicDir, `icon-${size}.png`);
    writeFileSync(file, png);
    console.log(`[icons] icon-${size}.png  ${(png.length / 1024).toFixed(1)} kB`);
    await page.close();
  }
} finally {
  await browser.close();
}
