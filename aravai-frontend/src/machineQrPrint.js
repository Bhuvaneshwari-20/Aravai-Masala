import { qrSvg, qrModuleCount } from './components/QrCode';

// Printed sticker: the QR symbol (its 4-module quiet zone included) is EXACTLY 30 x 30 mm.
export const STICKER_MM = 30;
export const GUIDE_MM = 36;          // dashed cut guide: 3 mm extra white margin on every side of the 30 mm symbol
export const MIN_MODULE_MM = 0.5;    // smaller than this and phone cameras start to miss modules on a matte label

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// size of one QR module on the sticker, in mm
export const moduleMm = (url) => STICKER_MM / qrModuleCount(url);

// HTML for Print.printAsync / printToFileAsync. All sizes are in mm and there is no scaling anywhere:
// print at 100% ("Actual size"), never "Fit to page".
export function machineQrHtml(machine, url) {
  const mm = moduleMm(url);
  if (mm < MIN_MODULE_MM) throw new Error(`The QR link is too long for a ${STICKER_MM} mm sticker (modules would be ${mm.toFixed(2)} mm). Use a shorter APP_URL.`);
  const svg = qrSvg(url, `${STICKER_MM}mm`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(machine.machine_code)} QR</title><style>
  @page{size:A4 portrait;margin:15mm}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .row{display:flex;align-items:center}
  .guide{width:${GUIDE_MM}mm;height:${GUIDE_MM}mm;border:0.2mm dashed #888;background:#fff;display:flex;align-items:center;justify-content:center;flex:none}
  .qr{width:${STICKER_MM}mm;height:${STICKER_MM}mm;background:#fff;flex:none}
  .qr svg{width:${STICKER_MM}mm;height:${STICKER_MM}mm;display:block}
  .info{margin-left:8mm}
  .code{font-size:22pt;font-weight:bold;margin:0}
  .name{font-size:13pt;margin:1mm 0 0}
  .type{font-size:10pt;color:#444;margin:1mm 0 0}
  .note{font-size:8pt;color:#666;margin-top:10mm;max-width:150mm;line-height:1.4}
  </style></head><body>
  <div class="row">
    <div class="guide"><div class="qr">${svg}</div></div>
    <div class="info">
      <p class="code">${esc(machine.machine_code)}</p>
      <p class="name">${esc(machine.machine_name)}</p>
      <p class="type">${esc(machine.machine_type)}</p>
    </div>
  </div>
  <p class="note">Aravai Masala machine QR. Print at 100% / Actual size on matte white sticker paper (do not use "Fit to page"). The QR is ${STICKER_MM} x ${STICKER_MM} mm; cut along the dashed line and stick it flat on the machine. Scan with the phone camera or the app: Machines, Scan Machine.</p>
  </body></html>`;
}
