/**
 * Rasterises assets/icon.svg into the PNG variants Expo requires.
 *
 * Expo cannot consume SVG for `icon` / `adaptiveIcon` / `favicon`, so the SVG
 * is the source of truth and these PNGs are generated artefacts. Run after any
 * change to the mark:  npm run build:icons
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');

// Shared geometry, kept in sync with assets/icon.svg.
const MONOGRAM = `
  <g fill="none" stroke="#FFFFFF" stroke-width="34" stroke-linecap="round">
    <path d="M255.6 147.3A74 74 0 1 0 255.6 260.7"/>
    <path d="M308 130V286"/>
    <path d="M308 130h26a40 40 0 0 1 0 80h-26"/>
  </g>
  <path d="M112 352h52l28-38 30 76 28-56 28 18h122"
        fill="none" stroke="#FFFFFF" stroke-width="22"
        stroke-linecap="round" stroke-linejoin="round"/>`;

const CLOUD = `
  <g fill="#FFFFFF" opacity="0.14">
    <path d="M150 300a56 56 0 0 1 10-111 82 82 0 0 1 152-22 66 66 0 0 1 50 133z"/>
  </g>`;

const svg = (body, { bg = '' } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0E7490"/>
      <stop offset="0.55" stop-color="#1D4ED8"/>
      <stop offset="1" stop-color="#6D28D9"/>
    </linearGradient>
  </defs>
  ${bg}
  ${body}
</svg>`;

/**
 * Android adaptive icons crop to a circle and mask ~33% of the edges, so the
 * foreground art is scaled to 60% and re-centred inside the safe zone.
 */
const inSafeZone = (body) =>
  `<g transform="translate(102.4 102.4) scale(0.6)">${body}</g>`;

const targets = [
  // Full tile - iOS / store listing / Expo `icon`.
  { file: 'icon.png', size: 1024, svg: svg(CLOUD + MONOGRAM, { bg: '<rect width="512" height="512" rx="116" fill="url(#tile)"/>' }) },
  // Splash: mark on transparency, Expo tints the surround.
  { file: 'splash-icon.png', size: 512, svg: svg(inSafeZone(MONOGRAM)) },
  // Android adaptive: foreground art, flat background, monochrome for themed icons.
  { file: 'android-icon-foreground.png', size: 1024, svg: svg(inSafeZone(CLOUD + MONOGRAM)) },
  { file: 'android-icon-background.png', size: 1024, svg: svg('', { bg: '<rect width="512" height="512" fill="url(#tile)"/>' }) },
  { file: 'android-icon-monochrome.png', size: 1024, svg: svg(inSafeZone(MONOGRAM)) },
  // Web.
  { file: 'favicon.png', size: 96, svg: svg(CLOUD + MONOGRAM, { bg: '<rect width="512" height="512" rx="116" fill="url(#tile)"/>' }) },
];

const source = await readFile(join(assets, 'icon.svg'), 'utf8');
if (!source.includes('M255.6 147.3')) {
  throw new Error('icon.svg no longer matches the geometry in this script - re-sync MONOGRAM.');
}

for (const { file, size, svg: markup } of targets) {
  const png = await sharp(Buffer.from(markup), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(assets, file), png);
  console.log(`  ${file.padEnd(32)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log('\nIcons regenerated from assets/icon.svg');
