/* Blocky letterforms, drawn rather than typeset.

   The reference design marks each subject card with a chunky pixel-grid
   initial. Hand-drawing a bitmap alphabet gives spindly one-cell strokes and
   twenty-six chances to draw a bad letter, so the mark is made the other way
   around: the app's own display face, at full weight, rendered onto a canvas a
   few cells tall and thresholded. The stems of a heavy grotesque quantise to
   two-cell strokes by themselves, every letter and digit works, and the mark
   is literally the brand font with the resolution taken away. */

const GRID_H = 12;      // canvas rows; the cap height lands on about 8 of them
const FONT = `800 ${GRID_H}px Archivo, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;

const cache = new Map();

function bitmapFor(char) {
  const canvas = document.createElement('canvas');
  canvas.width = GRID_H;
  canvas.height = GRID_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.font = FONT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(char, 0, GRID_H - 2);
  const data = ctx.getImageData(0, 0, GRID_H, GRID_H).data;

  const rows = [];
  for (let y = 0; y < GRID_H; y += 1) {
    let row = '';
    for (let x = 0; x < GRID_H; x += 1) {
      row += data[(y * GRID_H + x) * 4 + 3] > 120 ? '#' : '.';
    }
    rows.push(row);
  }
  // Crop to the inked cells so I is narrow and M is wide, like real type.
  const inked = (row) => row.includes('#');
  while (rows.length && !inked(rows[0])) rows.shift();
  while (rows.length && !inked(rows[rows.length - 1])) rows.pop();
  if (!rows.length) return null;
  let left = Math.min(...rows.map((r) => r.indexOf('#')).filter((i) => i >= 0));
  let right = Math.max(...rows.map((r) => r.lastIndexOf('#')));
  return rows.map((r) => r.slice(left, right + 1));
}

/** The pixel mark for one character, as an inline SVG, or '' if it has none. */
export function pixelGlyph(char, unit = 3) {
  const key = String(char || '').toUpperCase();
  if (!/^[A-Z0-9]$/.test(key)) return '';
  let rows = cache.get(key);
  if (rows === undefined) {
    try {
      rows = bitmapFor(key);
    } catch (err) {
      rows = null;
    }
    // Cache only once the display face is really in use, so the first paint's
    // fallback-font shape does not become permanent.
    const settled = !document.fonts || document.fonts.check(FONT);
    if (settled) cache.set(key, rows);
  }
  if (!rows) return '';

  const cells = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === '#') {
        cells.push(`<rect x="${x * unit}" y="${y * unit}" width="${unit}" height="${unit}"/>`);
      }
    }
  });
  const width = rows[0].length * unit;
  const height = rows.length * unit;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
    fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${cells.join('')}</svg>`;
}

/** The mark for a name: its first Latin letter or digit. */
export function pixelInitial(name, unit = 3) {
  const match = String(name || '').match(/[A-Za-z0-9]/);
  return match ? pixelGlyph(match[0], unit) : '';
}
