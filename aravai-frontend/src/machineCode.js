// What a scanned machine label contains -> what to look up.
//
//  NEW labels  : QR code holding the backend `qr_url`, i.e.  <APP_URL>/m/<qr_token>
//  OLD labels  : Code 128 holding the plain machine code (e.g. MCH005), or a link ending /m/<code> or /machine/<code>
//
// parseMachineScan() returns { kind: 'qr' | 'code', id } or null when the text cannot be a machine label
// (a product barcode, a random URL, an empty read ...), so no API call is wasted on it.
// `id` is what GET /machines/by-token/:id is called with (the permanent qr_token, or - old labels - the machine code).
const ID_RE = /^[A-Za-z0-9_.~-]{3,128}$/;
const LINK_RE = /\/(?:m|machine)\/([A-Za-z0-9_.~-]{3,128})\/?(?:[?#].*)?$/;

export function parseMachineScan(raw) {
  const text = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim(); // scanners sometimes add CR / LF
  if (!text || text.length > 400) return null;
  const link = LINK_RE.exec(text);
  if (link) return { kind: 'qr', id: link[1] };
  if (/^https?:\/\//i.test(text)) return null;      // some other website's QR: not ours
  return ID_RE.test(text) ? { kind: 'code', id: text } : null;
}

// Kept for the existing imports: just the id.
export const extractMachineCode = (raw) => (parseMachineScan(raw) || {}).id || null;
