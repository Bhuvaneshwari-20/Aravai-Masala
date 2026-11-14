import React, { useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';
// pure-JS QR encoder (no canvas / fs), safe for Expo web + iOS + Android
import QRCodeCore from 'qrcode/lib/core/qrcode';

export const QUIET = 4; // quiet-zone modules around the code (QR spec minimum)

function matrix(text) {
  const t = String(text ?? '');
  if (!t) throw new Error('Nothing to encode');
  const { modules } = QRCodeCore.create(t, { errorCorrectionLevel: 'M' });
  return { size: modules.size, get: (r, c) => !!modules.get(r, c) };
}

// merge horizontal runs of dark modules -> fewer <rect>s
function rects(text) {
  const { size, get } = matrix(text);
  const out = [];
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!get(r, c)) { c++; continue; }
      let n = 1;
      while (c + n < size && get(r, c + n)) n++;
      out.push([c + QUIET, r + QUIET, n]);
      c += n;
    }
  }
  return { rects: out, total: size + QUIET * 2 };
}

// Modules per side INCLUDING the 4-module quiet zone (e.g. 45). Square symbol size / this = size of one module.
export const qrModuleCount = (text) => rects(text).total;

// SVG markup string (used in the print / PDF page). `size` is a number (px) or a CSS length such as '30mm'.
// Always square: width = height = size, so the code is never stretched. Black modules on white.
export function qrSvg(text, size = 360) {
  const { rects: rs, total } = rects(text);
  const w = typeof size === 'number' ? `${size}` : String(size);
  const body = rs.map(([x, y, n]) => `<rect x="${x}" y="${y}" width="${n}" height="1" fill="#000"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 ${total} ${total}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" style="display:block"><rect width="${total}" height="${total}" fill="#fff"/>${body}</svg>`;
}

// On-screen component. size = width/height in px (includes the quiet zone).
export default function QrCode({ value, size = 280 }) {
  const { rects: rs, total } = useMemo(() => rects(value), [value]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges">
      <Rect x={0} y={0} width={total} height={total} fill="#fff" />
      {rs.map(([x, y, n]) => <Rect key={`${x}-${y}`} x={x} y={y} width={n} height={1} fill="#000" />)}
    </Svg>
  );
}
