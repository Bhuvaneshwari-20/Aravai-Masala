// Print pages for the Blending and Packing records (web). Builds a clean A4 page and prints it from a hidden frame.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const kg = (v) => (v === null || v === undefined || v === '' ? '—' : `${n(v)} kg`);
const money = (v) => (v === null || v === undefined || v === '' ? '—' : `₹${n(v)}`);
const when = (t) => (t ? esc(String(t).slice(0, 16)) : '—');
const status = (s) => esc(String(s || '').replace('_', ' '));

const CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1410; font-size: 12px; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #7a1212; padding-bottom: 8px; margin-bottom: 14px; }
  .co { font-size: 20px; font-weight: 900; letter-spacing: 1px; color: #7a1212; }
  .co small { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0; color: #6b5d55; }
  .doc { text-align: right; } .doc b { font-size: 16px; letter-spacing: 1px; } .doc div { color: #6b5d55; margin-top: 2px; }
  h3 { font-size: 11px; letter-spacing: 1.4px; color: #6b5d55; margin: 14px 0 5px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #cfc3b8; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f5ece3; font-size: 11px; }
  td.l { background: #faf5ef; color: #6b5d55; font-weight: 600; width: 22%; }
  td.v { font-weight: 700; width: 28%; }
  .r { text-align: right; } .tot td { background: #fff3e0; font-weight: 800; }
  .ok { color: #1b7a3a; } .warn { color: #b45309; }
  .sign { display: flex; gap: 24px; margin-top: 46px; }
  .sign div { flex: 1; border-top: 1px solid #1c1410; padding-top: 5px; text-align: center; font-size: 11px; color: #6b5d55; }
  .sign b { display: block; color: #1c1410; font-size: 12px; min-height: 15px; }
  .foot { margin-top: 18px; font-size: 10px; color: #8a7d74; text-align: center; }
`;

const header = (title, ref) => `
  <div class="head">
    <div class="co">ARAVAI MASALA<small>Manufacturing</small></div>
    <div class="doc"><b>${esc(title)}</b><div>Batch ${esc(ref)}</div><div>Printed ${esc(new Date().toLocaleString('en-IN'))}</div></div>
  </div>`;
// label/value cells, two pairs per row
const grid = (pairs) => {
  let rows = '';
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i]; const b = pairs[i + 1];
    rows += `<tr><td class="l">${esc(a[0])}</td><td class="v">${a[1]}</td>${b ? `<td class="l">${esc(b[0])}</td><td class="v">${b[1]}</td>` : '<td class="l"></td><td class="v"></td>'}</tr>`;
  }
  return `<table>${rows}</table>`;
};
const sign = (names) => `<div class="sign">${names.map(([role, who]) => `<div><b>${esc(who || '')}</b>${esc(role)}</div>`).join('')}</div>`;
const remarks = (r) => (r ? `<h3>Remarks</h3><table><tr><td>${esc(r)}</td></tr></table>` : '');

export function blendingHtml(d) {
  const first = (d.ingredients || [])[0] || {};
  const lines = (d.ingredients || []).map((l, i) => `
    <tr><td>${i + 1}</td><td>${esc(l.material_code ? `${l.material_code} · ${l.ingredient_name}` : l.ingredient_name)}</td>
    <td class="r">${n(l.ingredient_weight)} kg</td><td class="r">${Number(l.percent).toFixed(2)}%</td></tr>`).join('');
  return `${header('BLENDING RECORD', d.batch_no)}
    <h3>Blending run</h3>
    ${grid([
      ['Batch', esc(d.batch_no)], ['Product', esc(d.product_name)],
      ['Recipe', esc(`${d.recipe_no} (v${d.version_no})`)], ['Machine', esc(`${d.machine_code} · ${d.machine_name}`)],
      ['Started', when(d.start_time)], ['Ended', when(d.end_time)],
      ['Mixing duration', d.mixing_duration_min ? `${n(d.mixing_duration_min)} min` : '—'], ['Status', status(d.status)],
    ])}
    <h3>Ingredients (mixing %)</h3>
    <table><tr><th style="width:30px">#</th><th>Material</th><th class="r" style="width:110px">Weight</th><th class="r" style="width:80px">Mix %</th></tr>
    ${lines}
    <tr class="tot"><td></td><td>Total</td><td class="r">${n(d.total_input_weight)} kg</td><td class="r">100.00%</td></tr></table>
    <h3>Weight</h3>
    ${grid([
      ['Total ingredients (input)', kg(d.total_input_weight)], ['Blended weight (output)', `<span class="ok">${kg(d.output_weight)}</span>`],
      ['Wastage', `<span class="warn">${kg(d.wastage_weight || 0)} (${Number(d.loss_percent).toFixed(2)}%)</span>`], ['Initial weight (at batching)', Number(d.batching_kg) > 0 ? kg(d.batching_kg) : '—'],
    ])}
    ${remarks(d.remarks)}
    ${sign([['Done by', first.done_by_name || d.operator_name], ['Checked by', first.checked_by_name], ['Production in-charge', '']])}
    <div class="foot">Computer generated record</div>`;
}

export function packingHtml(d) {
  return `${header('PACKING RECORD', d.batch_no)}
    <h3>Packing run</h3>
    ${grid([
      ['Batch', esc(d.batch_no)], ['Product', esc(d.product_name)],
      ['Pack size', esc(`${d.sku_code} · ${d.packing_size_label}`)], ['Date', esc(d.packing_date)],
      ['Machine', esc(`${d.machine_code} · ${d.machine_name}`)], ['Operator', esc(d.operator_name)],
      ['Status', status(d.status)], ['', ''],
    ])}
    <h3>Packets</h3>
    <table><tr><th>Total packets</th><th>Accepted packets</th><th>Rejected packets</th></tr>
    <tr><td><b>${n(d.total_bag_count)}</b></td><td class="ok"><b>${n(d.accepted_bag_count)}</b></td><td class="warn"><b>${n(d.rejected_bag_count)}</b></td></tr></table>
    <h3>Weight</h3>
    ${grid([
      ['Pack size (per packet)', d.bag_size_grams ? `${n(d.bag_size_grams)} g` : '—'], ['Packed (packets × pack size)', kg(d.total_packing_weight)],
      ['Overall packet weight (entered)', kg(d.overall_weight_kg)], ['Average per packet', d.actual_weight ? `${n(d.actual_weight)} g` : '—'],
      ['Accepted weight', kg(d.accepted_weight)], ['Rejected weight', kg(d.rejected_weight)],
    ])}
    <h3>Price and cost (at the time of packing)</h3>
    ${grid([
      ['MRP per packet', money(d.mrp_snapshot)], ['Packet rate', money(d.bag_rate_snapshot)],
      ['Pouch material cost per packet', money(d.bag_material_cost_snapshot)], ['Production rate per packet', money(d.production_rate_snapshot)],
      ['Total pouch material cost', money(d.total_bag_material_cost)], ['Production cost', money(d.production_cost)],
    ])}
    <h3>Machine counters</h3>
    ${grid([['Auger count', n(d.auger_count)], ['Puller count', n(d.puller_count)], ['Production count', n(d.production_count)], ['', '']])}
    <h3>Batch weight</h3>
    ${grid([
      ['Initial weight (at batching)', Number(d.batching_kg) > 0 ? kg(d.batching_kg) : '—'], ['Output after blending', kg(d.batch_output_kg)],
      [`Packed so far (${n(d.batch_runs)} ${Number(d.batch_runs) === 1 ? 'entry' : 'entries'})`, kg(d.batch_packed_kg)],
      ['Left to pack', kg(Math.max(Number(d.batch_output_kg) - Number(d.batch_packed_kg), 0))],
    ])}
    ${remarks(d.remarks)}
    ${sign([['Packed by', d.operator_name], ['Checked by', ''], ['Production in-charge', '']])}
    <div class="foot">Computer generated record</div>`;
}

// Prints from a hidden frame (no popup window, so browsers do not block it). Web only: returns false elsewhere.
export function printHtml(title, bodyHtml) {
  if (typeof document === 'undefined') return false;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${bodyHtml}</body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const w = frame.contentWindow;
  w.document.open(); w.document.write(html); w.document.close();
  const go = () => { try { w.focus(); w.print(); } finally { setTimeout(() => frame.remove(), 1500); } };
  if (w.document.readyState === 'complete') setTimeout(go, 150); else frame.onload = () => setTimeout(go, 150);
  return true;
}

export const printBlending = (d) => printHtml(`Blending-${d.batch_no}`, blendingHtml(d));
export const printPacking = (d) => printHtml(`Packing-${d.batch_no}-${d.sku_code}`, packingHtml(d));