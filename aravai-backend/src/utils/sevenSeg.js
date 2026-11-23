// 7-segment digit decoder (pure JS, no OCR engine). Input: binary mask of the LIT segments of ONE display, 1 = lit.
//   decode(mask, w, h) -> { ok, text, value, reason }      e.g. text '112.2'
// Steps: tight box -> take out the decimal point -> remove the italic slant -> split into digits by empty columns ->
//        look at the 7 segment positions of every digit -> table lookup. Anything unclear -> ok:false (never guesses).
const TABLE = { // bits = a b c d e f g  (a top, b upper right, c lower right, d bottom, e lower left, f upper left, g middle)
  '1111110': '0', '0110000': '1', '1101101': '2', '1111001': '3', '0110011': '4', '1011011': '5',
  '1011111': '6', '1110000': '7', '1111111': '8', '1111011': '9',
  '0011111': '6', '1110011': '9', // 6 without its top bar and 9 without its bottom bar (some displays draw them so)
};
//        a b c d e f g
const SEG = [ // [x0, x1, y0, y1] as fractions of the digit cell: a thin strip along the CENTRE LINE of each segment.
  // Sampling the centre line (not the whole segment area) keeps a thin / over-exposed / blurred lit core readable and keeps the glow of a
  // neighbouring segment out of the strip, so a lit bar never makes an unlit bar look lit.
  [0.22, 0.78, 0.01, 0.11], [0.84, 0.99, 0.12, 0.44], [0.84, 0.99, 0.56, 0.88], [0.22, 0.78, 0.89, 0.99],
  [0.01, 0.16, 0.56, 0.88], [0.01, 0.16, 0.12, 0.44], [0.22, 0.78, 0.45, 0.55],
];
const SEG_ON = 0.45; // share of the strip that must be lit

function components(m, w, h) {
  const lab = new Int32Array(w * h), out = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s]) continue;
    const id = out.length + 1, st = [s]; lab[s] = id;
    const c = { id, x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    while (st.length) {
      const p = st.pop(), x = p % w, y = (p - x) / w;
      c.area++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx; if (m[n] && !lab[n]) { lab[n] = id; st.push(n); }
      }
    }
    out.push(c);
  }
  return { lab, comps: out };
}

function dilate(m, w, h) {
  const o = new Uint8Array(m);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h) o[ny * w + nx] = 1;
    }
  }
  return o;
}

function decode(mask, w, h) {
  const fail = (reason) => ({ ok: false, text: null, value: null, reason });
  let m = dilate(mask, w, h);
  let { lab, comps } = components(m, w, h);
  if (!comps.length) return fail('no lit segments');
  // drop specks
  const tot = Math.max(...comps.map((c) => c.area));
  const keep = new Set(comps.filter((c) => c.area >= tot * 0.02).map((c) => c.id));
  for (let i = 0; i < m.length; i++) if (m[i] && !keep.has(lab[i])) m[i] = 0;
  comps = comps.filter((c) => keep.has(c.id));
  // vertical extent of the digits = tallest group of components (a digit's vertical bars are the tall ones)
  const barH = Math.max(...comps.map((c) => c.y1 - c.y0 + 1));
  let y0 = Math.min(...comps.filter((c) => c.y1 - c.y0 + 1 >= barH * 0.5).map((c) => c.y0));
  let y1 = Math.max(...comps.filter((c) => c.y1 - c.y0 + 1 >= barH * 0.5).map((c) => c.y1));
  let Hd = y1 - y0 + 1;
  if (Hd < 36) return fail('digits too small to read safely'); // below this the segments merge and a wrong number could come out
  // decimal point: small square blob near the bottom
  const dots = comps.filter((c) => (c.y1 - c.y0 + 1) < Hd * 0.22 && (c.x1 - c.x0 + 1) < Hd * 0.22 && (c.y0 + c.y1) / 2 > y0 + Hd * 0.72 && Math.abs((c.x1 - c.x0) - (c.y1 - c.y0)) < Hd * 0.12);
  for (const d of dots) for (let y = d.y0; y <= d.y1; y++) for (let x = d.x0; x <= d.x1; x++) if (lab[y * w + x] === d.id) m[y * w + x] = 0;
  if (dots.length > 1) return fail('more than one decimal point');
  const dot = dots[0] || null;
  // The real top / bottom of the digits = every lit part except the dot. The vertical bars alone stop short of the top (a) and bottom (d) bars,
  // which pushed those two segments outside the digit cell and made good digits read as 'unclear'.
  const dotIds = new Set(dots.map((d) => d.id));
  const body = comps.filter((c) => !dotIds.has(c.id));
  if (!body.length) return fail('no digits');
  y0 = Math.min(...body.map((c) => c.y0));
  y1 = Math.max(...body.map((c) => c.y1));
  Hd = y1 - y0 + 1;
  if (Hd < 36) return fail('digits too small to read safely');

  // remove the slant: shear so that the vertical bars become vertical (best = most peaked column histogram)
  const shearOf = (s) => (x, y) => Math.round(x + s * (y - y0));
  // step > 1 samples every step-th row only (used for the slant SEARCH, which needs just the shape of the histogram; the final pass uses every row)
  const hist = (s, step = 1) => {
    const f = shearOf(s), c = new Int32Array(w + Math.ceil(Math.abs(s) * h) + 2);
    for (let y = y0; y <= y1; y += step) for (let x = 0; x < w; x++) if (m[y * w + x]) { const k = f(x, y) + Math.ceil(Math.abs(s) * h); if (k >= 0 && k < c.length) c[k]++; }
    return c;
  };
  let bestS = 0, bestScore = -1;
  for (let s = -0.45; s <= 0.45001; s += 0.025) { const c = hist(s, 3); let sc = 0; for (const v of c) sc += v * v; if (sc > bestScore) { bestScore = sc; bestS = s; } }
  const off = Math.ceil(Math.abs(bestS) * h), cols = hist(bestS);

  // digits = runs of occupied columns; runs closer than 7% of the digit height are one digit
  const thr = Math.max(1, Hd * 0.04);
  const runs = [];
  for (let x = 0; x < cols.length; x++) {
    if (cols[x] >= thr) { if (runs.length && x - runs[runs.length - 1][1] <= Math.max(2, Hd * 0.07)) runs[runs.length - 1][1] = x; else runs.push([x, x]); }
  }
  const digits = runs.filter((r) => r[1] - r[0] + 1 >= Hd * 0.05);
  if (!digits.length) return fail('no digits');
  if (digits.length > 8) return fail('too many digit shapes');

  // sheared mask lookup
  const lit = (sx, sy) => { // sx in sheared columns, sy in image rows
    const x = Math.round(sx - off - bestS * (sy - y0)); return x >= 0 && x < w && sy >= 0 && sy < h ? m[sy * w + x] : 0;
  };
  const widest = Math.max(...digits.map((r) => r[1] - r[0] + 1));
  let text = '';
  const dotSx = dot ? Math.round((dot.x0 + dot.x1) / 2 + bestS * ((dot.y0 + dot.y1) / 2 - y0)) + off : null;
  let dotPlaced = false;
  for (let i = 0; i < digits.length; i++) {
    const [xa, xb] = digits[i];
    const wd = xb - xa + 1;
    let ch;
    if (wd < Hd * 0.3) ch = '1'; // only the two right-hand bars
    else {
      const bits = SEG.map(([fx0, fx1, fy0, fy1]) => {
        let on = 0, n = 0;
        const ax0 = xa + Math.floor(fx0 * wd), ax1 = xa + Math.ceil(fx1 * wd), ay0 = y0 + Math.floor(fy0 * Hd), ay1 = y0 + Math.ceil(fy1 * Hd);
        for (let yy = ay0; yy <= ay1; yy++) for (let xx = ax0; xx <= ax1; xx++) { n++; on += lit(xx, yy); }
        return n && on / n > SEG_ON ? '1' : '0';
      }).join('');
      ch = TABLE[bits];
      if (!ch) return fail(`unclear digit (segments ${bits})`);
    }
    text += ch;
    // Place the real decimal point after the digit immediately to its left.
    // The old find/indexOf expression could look up the wrong next digit.
    const next = digits[i + 1];
    if (dotSx !== null && !dotPlaced && dotSx > xb && (!next || dotSx < next[0])) {
      text += '.';
      dotPlaced = true;
    }
  }
  if (dot && !dotPlaced) return fail('decimal point position unclear');
  const value = Number(text);
  if (!Number.isFinite(value)) return fail('not a number');
  return { ok: true, text, value, reason: null, digits: digits.length, widest };
}

module.exports = { decode };