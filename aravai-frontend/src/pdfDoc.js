// Tiny dependency-free PDF writer (A4, Helvetica) for the "Download" button on the web.
// No library to install. Used by PackingDetailModal -> downloadPackingPdf(d).

const W = 595; const H = 842; const M = 40; const VAL_X = 305;
const INK = [0.11, 0.08, 0.06]; const GREY = [0.42, 0.36, 0.33]; const MAROON = [0.48, 0.07, 0.07];
const GREEN = [0.18, 0.49, 0.2]; const ORANGE = [0.9, 0.32, 0]; const AMBER_BG = [1, 0.953, 0.878]; const GREEN_BG = [0.91, 0.96, 0.91];

// text -> PDF string in WinAnsi (Helvetica has no rupee sign, so it is written as "Rs.")
const enc = (s) => String(s ?? '').replace(/₹/g, 'Rs. ').split('').map((ch) => {
  const c = ch.charCodeAt(0);
  const m = { 0xb7: 0xb7, 0xd7: 0xd7, 0x2014: 0x97, 0x2013: 0x96, 0xb0: 0xb0 }[c];
  const o = m !== undefined ? m : (c < 127 ? c : 63);
  const t = String.fromCharCode(o);
  return t === '(' || t === ')' || t === '\\' ? `\\${t}` : t;
}).join('');
const f = (n) => Number(n).toFixed(2);

class Pdf {
  constructor() { this.pages = [[]]; this.y = H - M; }
  get page() { return this.pages[this.pages.length - 1]; }
  ensure(h) { if (this.y - h < 40) { this.pages.push([]); this.y = H - M; } }
  text(x, y, s, { size = 10, bold = false, color = INK } = {}) {
    this.page.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color.join(' ')} rg ${f(x)} ${f(y)} Td (${enc(s)}) Tj ET`);
  }
  rect(x, y, w, h, color) { this.page.push(`${color.join(' ')} rg ${f(x)} ${f(y)} ${f(w)} ${f(h)} re f`); }
  line(x1, y1, x2, y2, color, width = 0.6) { this.page.push(`${color.join(' ')} RG ${width} w ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S`); }
  tick(cx, cy, r, color) { // filled circle with a white tick
    const k = 0.5523 * r;
    this.page.push(`${color.join(' ')} rg ${f(cx + r)} ${f(cy)} m ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c `
      + `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c ${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c `
      + `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c f`);
    this.page.push(`1 1 1 RG ${f(r * 0.28)} w 1 J 1 j ${f(cx - r * 0.45)} ${f(cy)} m ${f(cx - r * 0.1)} ${f(cy - r * 0.4)} l ${f(cx + r * 0.5)} ${f(cy + r * 0.38)} l S`);
  }
  build() {
    const n = this.pages.length; const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`;
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    this.pages.forEach((p, i) => {
      const body = p.concat([`BT /F1 8 Tf 0.55 0.5 0.47 rg ${M} 24 Td (Computer generated record) Tj ET`,
        `BT /F1 8 Tf 0.55 0.5 0.47 rg ${W - M - 48} 24 Td (Page ${i + 1} of ${n}) Tj ET`]).join('\n');
      objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
      objs[6 + i * 2] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
    });
    let out = '%PDF-1.4\n'; const offs = [];
    for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
}

const num = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const kg = (v) => (v === null || v === undefined || v === '' ? '—' : `${num(v)} kg`);
const rs = (v) => (v === null || v === undefined || v === '' ? '—' : `₹${num(v)}`);
const cap = (s) => { const t = String(s || '').replace('_', ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

export function packingPdfBytes(d) {
  const p = new Pdf();
  // header
  p.text(M, p.y - 14, 'ARAVAI MASALA', { size: 18, bold: true, color: MAROON });
  p.text(M, p.y - 28, 'Manufacturing', { size: 9, color: GREY });
  p.text(360, p.y - 12, 'PACKING RECORD', { size: 14, bold: true });
  p.text(360, p.y - 26, `Batch ${d.batch_no}`, { size: 9, color: GREY });
  p.text(360, p.y - 38, `Printed ${new Date().toLocaleString('en-IN')}`, { size: 9, color: GREY });
  p.line(M, p.y - 46, W - M, p.y - 46, MAROON, 2.5);
  p.y -= 58;

  const section = (title, rows) => {
    p.ensure(22 + 16 * 2);
    p.text(M, p.y - 10, title.toUpperCase(), { size: 8.5, bold: true, color: GREY });
    p.y -= 16;
    rows.forEach(([label, value, o = {}]) => {
      p.ensure(16);
      const top = p.y; const rowH = 16;
      if (o.hl) { p.rect(M, top - rowH, W - 2 * M, rowH, o.hl); p.rect(M, top - rowH, 3.5, rowH, o.bar || MAROON); }
      p.line(M, top - rowH, W - M, top - rowH, [0.85, 0.8, 0.75], 0.4);
      p.text(M + 10, top - 11.5, label, { size: 9.5, bold: !!o.hl, color: o.hl ? INK : GREY });
      let vx = VAL_X;
      if (o.tick) { p.tick(VAL_X + 6, top - 8, 5.5, GREEN); vx += 18; }
      p.text(vx, top - 11.5, value, { size: o.hl ? 11 : 10, bold: true, color: o.color || INK });
      p.y -= rowH;
    });
    p.y -= 6;
  };

  const left = Math.max(Number(d.batch_output_kg) - Number(d.batch_packed_kg), 0);
  const nothingLeft = left <= 0.001;
  const batchDone = d.batch_status === 'COMPLETED';
  section('Packing run', [
    ['Batch', d.batch_no], ['Product', d.product_name, { hl: AMBER_BG, bar: MAROON, color: MAROON }],
    ['Pack size', `${d.sku_code} · ${d.packing_size_label}`], ['Date', d.packing_date],
    ['Machine', `${d.machine_code} · ${d.machine_name}`], ['Operator', d.operator_name], ['Status', cap(d.status)],
  ]);
  section('Packets', [
    ['Total packets', num(d.total_bag_count)], ['Accepted packets', num(d.accepted_bag_count), { color: GREEN }],
    ['Rejected packets', num(d.rejected_bag_count), { color: Number(d.rejected_bag_count) ? ORANGE : INK }],
  ]);
  section('Weight', [
    ['Pack size (per packet)', d.bag_size_grams ? `${num(d.bag_size_grams)} g` : '—'], ['Packed (packets × pack size)', kg(d.total_packing_weight)],
    ['Overall packet weight (entered)', kg(d.overall_weight_kg)], ['Average per packet', d.actual_weight ? `${num(d.actual_weight)} g` : '—'],
    ['Accepted weight', kg(d.accepted_weight)], ['Rejected weight', kg(d.rejected_weight)],
  ]);
  section('Price and cost (at the time of packing)', [
    ['MRP per packet', rs(d.mrp_snapshot)], ['Packet rate', rs(d.bag_rate_snapshot)],
    ['Pouch material cost per packet', rs(d.bag_material_cost_snapshot)], ['Production rate per packet', rs(d.production_rate_snapshot)],
    ['Total pouch material cost', rs(d.total_bag_material_cost)], ['Production cost', rs(d.production_cost), { hl: AMBER_BG, bar: ORANGE, color: MAROON }],
  ]);
  section('Machine counters', [['Auger count', num(d.auger_count)], ['Puller count', num(d.puller_count)], ['Production count', num(d.production_count)]]);
  section('Batch weight', [
    ['Initial weight (at batching)', Number(d.batching_kg) > 0 ? kg(d.batching_kg) : '—'], ['Output after blending', kg(d.batch_output_kg)],
    [`Packed so far (${num(d.batch_runs)} ${Number(d.batch_runs) === 1 ? 'entry' : 'entries'})`, kg(d.batch_packed_kg)],
    ['Left to pack', kg(left), nothingLeft ? { hl: GREEN_BG, bar: GREEN, color: GREEN, tick: true } : { hl: AMBER_BG, bar: ORANGE, color: ORANGE }],
    ['Batch stage', batchDone ? 'Completed' : `${cap(d.batch_stage)} · ${cap(d.batch_status)}`, batchDone ? { color: GREEN, tick: true } : { color: ORANGE }],
  ]);
  if (d.remarks) section('Remarks', [['Note', String(d.remarks)]]);

  // signatures
  p.ensure(54);
  p.y -= 26;
  [['Packed by', d.operator_name], ['Checked by', ''], ['Production in-charge', '']].forEach(([role, who], i) => {
    const x = M + i * 175;
    p.line(x, p.y, x + 150, p.y, INK, 0.6);
    p.text(x, p.y + 4, who || '', { size: 9.5, bold: true });
    p.text(x, p.y - 12, role, { size: 8.5, color: GREY });
  });
  return p.build();
}

// Saves the PDF from the browser (web only). Returns false elsewhere.
export function downloadPackingPdf(d) {
  if (typeof document === 'undefined') return false;
  const blob = new Blob([packingPdfBytes(d)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `Packing-${d.batch_no}-${d.sku_code}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
const whenT = (t) => (t ? String(t).slice(0, 16) : '—');

export function blendingPdfBytes(d) {
  const p = new Pdf();
  p.text(M, p.y - 14, 'ARAVAI MASALA', { size: 18, bold: true, color: MAROON });
  p.text(M, p.y - 28, 'Manufacturing', { size: 9, color: GREY });
  p.text(360, p.y - 12, 'BLENDING RECORD', { size: 14, bold: true });
  p.text(360, p.y - 26, `Batch ${d.batch_no}`, { size: 9, color: GREY });
  p.text(360, p.y - 38, `Printed ${new Date().toLocaleString('en-IN')}`, { size: 9, color: GREY });
  p.line(M, p.y - 46, W - M, p.y - 46, MAROON, 2.5);
  p.y -= 58;

  const section = (title, rows) => {
    p.ensure(22 + 16 * 2);
    p.text(M, p.y - 10, title.toUpperCase(), { size: 8.5, bold: true, color: GREY });
    p.y -= 16;
    rows.forEach(([label, value, o = {}]) => {
      p.ensure(16);
      const top = p.y; const rowH = 16;
      if (o.hl) { p.rect(M, top - rowH, W - 2 * M, rowH, o.hl); p.rect(M, top - rowH, 3.5, rowH, o.bar || MAROON); }
      p.line(M, top - rowH, W - M, top - rowH, [0.85, 0.8, 0.75], 0.4);
      p.text(M + 10, top - 11.5, label, { size: 9.5, bold: !!o.hl, color: o.hl ? INK : GREY });
      let vx = VAL_X;
      if (o.tick) { p.tick(VAL_X + 6, top - 8, 5.5, GREEN); vx += 18; }
      p.text(vx, top - 11.5, value, { size: o.hl ? 11 : 10, bold: true, color: o.color || INK });
      p.y -= rowH;
    });
    p.y -= 6;
  };

  const first = (d.ingredients || [])[0] || {};
  const batchDone = d.batch_stage === 'COMPLETED' || d.batch_status === 'COMPLETED';

  section('Blending run', [
    ['Batch', d.batch_no], ['Product', d.product_name, { hl: AMBER_BG, bar: MAROON, color: MAROON }],
    ['Recipe', `${d.recipe_no} (v${d.version_no})`], ['Machine', `${d.machine_code} · ${d.machine_name}`],
    ['Started', whenT(d.start_time)], ['Ended', whenT(d.end_time)],
    ['Mixing duration', d.mixing_duration_min ? `${num(d.mixing_duration_min)} min` : '—'],
    ['Operator', d.operator_name], ['Status', cap(d.status)],
  ]);
  section('Ingredients (mixing %)', [
    ...(d.ingredients || []).map((l, i) => [
      `${i + 1}.  ${l.material_code ? `${l.material_code} · ` : ''}${l.ingredient_name}`,
      `${kg(l.ingredient_weight)}   ${Number(l.percent).toFixed(2)}%`,
    ]),
    ['Total', `${kg(d.total_input_weight)}   100.00%`, { hl: AMBER_BG, bar: ORANGE, color: MAROON }],
  ]);
  section('Weight', [
    ['Input after previous stage', kg(d.total_input_weight)],
    ['Blended weight (output)', kg(d.output_weight), { color: GREEN }],
    ['Wastage', `${kg(d.wastage_weight || 0)} (${Number(d.loss_percent).toFixed(2)}%)`, { color: Number(d.wastage_weight) > 0 ? ORANGE : INK }],
  ]);
  section('Checked by', [['Done by', first.done_by_name || '—'], ['Checked by', first.checked_by_name || '—']]);
  section('Batch weight', [
    ['Initial weight (at batching)', Number(d.batching_kg) > 0 ? kg(d.batching_kg) : '—'],
    ['Current output', kg(d.batch_output_kg)],
    ['Batch stage', batchDone ? 'Completed' : `${cap(d.batch_stage)} · ${cap(d.batch_status)}`, batchDone ? { color: GREEN } : {}],
  ]);
  if (d.remarks) section('Remarks', [['Note', String(d.remarks)]]);

  p.ensure(54);
  p.y -= 26;
  [['Done by', first.done_by_name || d.operator_name], ['Checked by', first.checked_by_name || ''], ['Production in-charge', '']].forEach(([role, who], i) => {
    const x = M + i * 175;
    p.line(x, p.y, x + 150, p.y, INK, 0.6);
    p.text(x, p.y + 4, who || '', { size: 9.5, bold: true });
    p.text(x, p.y - 12, role, { size: 8.5, color: GREY });
  });
  return p.build();
}

export function downloadBlendingPdf(d) {
  if (typeof document === 'undefined') return false;
  const blob = new Blob([blendingPdfBytes(d)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `Blending-${d.batch_no}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}