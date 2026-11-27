// Print one sales invoice (web). Fetches the full invoice and prints a clean A4 page from a hidden frame.
// Usage: const ok = await printInvoice(invoiceId);  -> false when not running on web.
import api from '../../api';
import { printHtml } from '../../printDoc';
import { niceDate } from './salesUtils';
import { fmt } from '../../theme';

const esc = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inr = (v) => `₹ ${Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default async function printInvoice(id) {
  const x = (await api.get(`/sales/${id}`)).data.data;
  const items = x.items || [];
  const rows = items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.product_name)} · ${esc(it.packing_size_label)}</td><td>${esc(it.sku_code)}</td>`
    + `<td style="text-align:right">${fmt(it.quantity)}</td><td style="text-align:right">${inr(it.rate)}</td><td style="text-align:right">${inr(it.amount)}</td></tr>`).join('');
  const total = x.total_amount ?? items.reduce((a, it) => a + Number(it.amount || 0), 0);
  const body = `<div class="head"><div class="co">ARAVAI MASALA<small>Sales Invoice</small></div><div class="doc"><b>${esc(x.invoice_no)}</b><div>${esc(niceDate(x.sale_date))}</div></div></div>`
    + `<h3>Customer</h3><div>${esc(x.customer_name)}</div><h3>Items</h3>`
    + `<table><tr><th>#</th><th>Product</th><th>SKU</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr>${rows}</table>`
    + `<h3>Total</h3><div style="font-size:16px"><b>${inr(total)}</b></div>`;
  return printHtml(`Invoice-${x.invoice_no}`, body);
}