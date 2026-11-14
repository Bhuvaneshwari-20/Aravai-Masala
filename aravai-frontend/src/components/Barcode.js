import React from 'react';
import { PixelRatio } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

// Code 128 (set B) barcode, no extra library: works on web, iOS and Android.
const BARS = '11011001100 11001101100 11001100110 10010011000 10010001100 10001001100 10011001000 10011000100 10001100100 11001001000 11001000100 11000100100 10110011100 10011011100 10011001110 10111001100 10011101100 10011100110 11001110010 11001011100 11001001110 11011100100 11001110100 11101101110 11101001100 11100101100 11100100110 11101100100 11100110100 11100110010 11011011000 11011000110 11000110110 10100011000 10001011000 10001000110 10110001000 10001101000 10001100010 11010001000 11000101000 11000100010 10110111000 10110001110 10001101110 10111011000 10111000110 10001110110 11101110110 11010001110 11000101110 11011101000 11011100010 11011101110 11101011000 11101000110 11100010110 11101101000 11101100010 11100011010 11101111010 11001000010 11110001010 10100110000 10100001100 10010110000 10010000110 10000101100 10000100110 10110010000 10110000100 10011010000 10011000010 10000110100 10000110010 11000010010 11001010000 11110111010 11000010100 10001111010 10100111100 10010111100 10010011110 10111100100 10011110100 10011110010 11110100100 11110010100 11110010010 11011011110 11011110110 11110110110 10101111000 10100011110 10001011110 10111101000 10111100010 11110101000 11110100010 10111011110 10111101110 11101011110 11110101110 11010000100 11010010000 11010011100 1100011101011'.split(' ');
const START_B = 104; const STOP = 106;

// text -> string of 0/1 modules (1 = black)
export function code128Modules(text) {
  const t = String(text ?? '');
  if (!t) throw new Error('Nothing to encode');
  const codes = [START_B];
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charCodeAt(i);
    if (c < 32 || c > 126) throw new Error('Barcode supports plain letters, numbers and symbols only');
    codes.push(c - 32);
  }
  let sum = START_B;
  for (let i = 1; i < codes.length; i += 1) sum += codes[i] * i;
  codes.push(sum % 103, STOP);
  return codes.map((c) => BARS[c]).join('');
}

// [x, width] runs of black modules
function runs(mods) {
  const out = []; let i = 0;
  while (i < mods.length) {
    if (mods[i] === '1') { let j = i; while (mods[j] === '1') j += 1; out.push([i, j - i]); i = j; } else i += 1;
  }
  return out;
}

// Quiet zone (empty white modules) on each side. The Code 128 spec minimum is 10; 12 leaves a safety margin.
export const QUIET = 12;

// Total modules incl. quiet zones (barcode width in px = this * module)
export const barcodeModuleCount = (text) => code128Modules(text).length + QUIET * 2;

// Biggest whole-pixel module (narrow-bar width) that still fits maxWidth px. Bigger bars = easier for a camera to read.
export function fitModule(text, maxWidth, { min = 2, max = 6 } = {}) {
  const per = Math.floor(maxWidth / barcodeModuleCount(text));
  return Math.max(min, Math.min(max, per));
}

// SVG markup string for the print / PDF page. module = px per narrow bar, always a whole number so every bar is exact.
export function barcodeSvg(text, { module = 5, height = 180 } = {}) {
  const m = Math.max(1, Math.round(module));
  const mods = code128Modules(text);
  const w = (mods.length + QUIET * 2) * m;
  const bars = runs(mods).map(([x, n]) => `<rect x="${(x + QUIET) * m}" y="0" width="${n * m}" height="${height}" fill="#000"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" shape-rendering="crispEdges" style="display:block;margin:0 auto"><rect width="${w}" height="${height}" fill="#fff"/>${bars}</svg>`;
}

// On-screen component. module = px per narrow bar (default 3). `width` (total px) is still accepted: module is derived from it.
// The bar width is snapped to whole PHYSICAL pixels, so no bar is blurry or uneven on any phone screen.
export default function Barcode({ value, module, width, height = 110 }) {
  const mods = code128Modules(value);
  const total = mods.length + QUIET * 2;
  const dpr = PixelRatio.get() || 1;
  const wanted = module || (width ? width / total : 3);
  const m = Math.max(1, Math.floor(wanted * dpr)) / dpr;
  const w = total * m;
  return (
    <Svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} shapeRendering="crispEdges">
      <Rect x={0} y={0} width={w} height={height} fill="#fff" />
      {runs(mods).map(([x, n]) => <Rect key={x} x={(x + QUIET) * m} y={0} width={n * m} height={height} fill="#000" />)}
    </Svg>
  );
}
