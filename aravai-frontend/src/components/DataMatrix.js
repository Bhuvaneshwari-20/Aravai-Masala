import React from 'react';
import Svg, { Rect } from 'react-native-svg';

// Data Matrix (ECC 200, square symbols) generator with no extra library. Works on web, iOS and Android.
// Phone cameras / Google Lens read it like a QR code; it is a small square, so it scans even from a screen.
// Text must be plain ASCII (letters, digits, symbols), up to about 140 characters.

// [symbol size, data codewords, error-correction codewords, regions per side, data-region size]
const SIZES = [
  [10, 3, 5, 1, 8], [12, 5, 7, 1, 10], [14, 8, 10, 1, 12], [16, 12, 12, 1, 14], [18, 18, 14, 1, 16],
  [20, 22, 18, 1, 18], [22, 30, 20, 1, 20], [24, 36, 24, 1, 22], [26, 44, 28, 1, 24],
  [32, 62, 36, 2, 14], [36, 86, 42, 2, 16], [40, 114, 48, 2, 18], [44, 144, 56, 2, 20],
];

// GF(256), polynomial 0x12D
const EXP = new Array(512); const LOG = new Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x12d; } for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function eccCodewords(data, n) {
  let gen = [1];
  for (let i = 1; i <= n; i += 1) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j += 1) { next[j] ^= gen[j]; next[j + 1] ^= mul(gen[j], EXP[i]); }
    gen = next;
  }
  const ecc = new Array(n).fill(0);
  data.forEach((d) => {
    const fb = d ^ ecc[0];
    for (let k = 0; k < n - 1; k += 1) ecc[k] = ecc[k + 1] ^ mul(gen[k + 1], fb);
    ecc[n - 1] = mul(gen[n], fb);
  });
  return ecc;
}

// ASCII encodation: character -> code + 1, two digits in a row -> one codeword
function asciiCodewords(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 32 || c > 126) throw new Error('Data Matrix supports plain letters, numbers and symbols only');
    const d = text.charCodeAt(i + 1);
    if (c >= 48 && c <= 57 && d >= 48 && d <= 57) { out.push(130 + (c - 48) * 10 + (d - 48)); i += 1; } else out.push(c + 1);
  }
  return out;
}

// places the codewords in the data area (ISO 16022 Annex F)
function place(codewords, nrow, ncol) {
  const bits = new Array(nrow * ncol).fill(-1);
  const setBit = (r, c, pos, bit) => {
    let row = r; let col = c;
    if (row < 0) { row += nrow; col += 4 - ((nrow + 4) % 8); }
    if (col < 0) { col += ncol; row += 4 - ((ncol + 4) % 8); }
    bits[row * ncol + col] = (codewords[pos] & (1 << (8 - bit))) !== 0 ? 1 : 0;
  };
  const utah = (r, c, p) => {
    setBit(r - 2, c - 2, p, 1); setBit(r - 2, c - 1, p, 2); setBit(r - 1, c - 2, p, 3); setBit(r - 1, c - 1, p, 4);
    setBit(r - 1, c, p, 5); setBit(r, c - 2, p, 6); setBit(r, c - 1, p, 7); setBit(r, c, p, 8);
  };
  const corner = (p, list) => list.forEach(([r, c], i) => setBit(r, c, p, i + 1));
  const has = (c, r) => bits[r * ncol + c] >= 0;
  let pos = 0; let row = 4; let col = 0;
  do {
    if (row === nrow && col === 0) { corner(pos, [[nrow - 1, 0], [nrow - 1, 1], [nrow - 1, 2], [0, ncol - 2], [0, ncol - 1], [1, ncol - 1], [2, ncol - 1], [3, ncol - 1]]); pos += 1; }
    if (row === nrow - 2 && col === 0 && ncol % 4 !== 0) { corner(pos, [[nrow - 3, 0], [nrow - 2, 0], [nrow - 1, 0], [0, ncol - 4], [0, ncol - 3], [0, ncol - 2], [0, ncol - 1], [1, ncol - 1]]); pos += 1; }
    if (row === nrow - 2 && col === 0 && ncol % 8 === 4) { corner(pos, [[nrow - 3, 0], [nrow - 2, 0], [nrow - 1, 0], [0, ncol - 2], [0, ncol - 1], [1, ncol - 1], [2, ncol - 1], [3, ncol - 1]]); pos += 1; }
    if (row === nrow + 4 && col === 2 && ncol % 8 === 0) { corner(pos, [[nrow - 1, 0], [nrow - 1, ncol - 1], [0, ncol - 3], [0, ncol - 2], [0, ncol - 1], [1, ncol - 3], [1, ncol - 2], [1, ncol - 1]]); pos += 1; }
    do { if (row < nrow && col >= 0 && !has(col, row)) { utah(row, col, pos); pos += 1; } row -= 2; col += 2; } while (row >= 0 && col < ncol);
    row += 1; col += 3;
    do { if (row >= 0 && col < ncol && !has(col, row)) { utah(row, col, pos); pos += 1; } row += 2; col -= 2; } while (row < nrow && col >= 0);
    row += 3; col += 1;
  } while (row < nrow || col < ncol);
  if (!has(ncol - 1, nrow - 1)) { bits[nrow * ncol - 1] = 1; bits[(nrow - 1) * ncol - 2] = 1; }
  return (c, r) => bits[r * ncol + c] === 1;
}

// text -> square matrix of 0/1 (1 = dark), including the finder pattern, without the quiet zone
export function dataMatrixModules(text) {
  const t = String(text ?? '');
  if (!t) throw new Error('Nothing to encode');
  const data = asciiCodewords(t);
  const sym = SIZES.find((s) => s[1] >= data.length);
  if (!sym) throw new Error('Text is too long for the Data Matrix label');
  const [size, dataCw, eccCw, regions, region] = sym;
  const cw = data.slice();
  if (cw.length < dataCw) cw.push(129); // first pad codeword
  while (cw.length < dataCw) { const r = ((149 * (cw.length + 1)) % 253) + 1; const v = 129 + r; cw.push(v > 254 ? v - 254 : v); }
  const all = cw.concat(eccCodewords(cw, eccCw));
  const dim = region * regions; // data area per side
  const bit = place(all, dim, dim);
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let y = 0; y < dim; y += 1) {
    const ry = Math.floor(y / region); const rowBase = ry * (region + 2);
    for (let x = 0; x < dim; x += 1) {
      const rx = Math.floor(x / region);
      m[rowBase + 1 + (y % region)][rx * (region + 2) + 1 + (x % region)] = bit(x, y) ? 1 : 0;
    }
  }
  for (let ry = 0; ry < regions; ry += 1) {
    for (let rx = 0; rx < regions; rx += 1) {
      const top = ry * (region + 2); const left = rx * (region + 2); const last = region + 1;
      for (let i = 0; i <= last; i += 1) {
        m[top + last][left + i] = 1; // bottom solid row
        m[top + i][left] = 1; // left solid column
        m[top][left + i] = i % 2 === 0 ? 1 : 0; // top: alternating, starts dark
        m[top + i][left + last] = i % 2 === 0 ? 0 : 1; // right: alternating, dark on the 2nd, 4th ... row from the top
      }
      m[top + last][left + last] = 1;
    }
  }
  return m;
}

const QUIET = 2; // light border (modules) around the code, needed for reliable scanning

// SVG markup string (used in the print / PDF page). size = side length in px.
export function dataMatrixSvg(text, size = 320) {
  const m = dataMatrixModules(text); const n = m.length + QUIET * 2;
  let d = '';
  m.forEach((row, y) => { let x = 0; while (x < row.length) { if (row[x]) { let e = x; while (e < row.length && row[e]) e += 1; d += `M${x + QUIET} ${y + QUIET}h${e - x}v1h-${e - x}z`; x = e; } else x += 1; } });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// On-screen component
export default function DataMatrix({ value, size = 260 }) {
  const m = dataMatrixModules(value); const n = m.length + QUIET * 2;
  const rects = [];
  m.forEach((row, y) => { let x = 0; while (x < row.length) { if (row[x]) { let e = x; while (e < row.length && row[e]) e += 1; rects.push(<Rect key={`${y}-${x}`} x={x + QUIET} y={y + QUIET} width={e - x} height={1} fill="#000" />); x = e; } else x += 1; } });
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
      <Rect x={0} y={0} width={n} height={n} fill="#fff" />
      {rects}
    </Svg>
  );
}