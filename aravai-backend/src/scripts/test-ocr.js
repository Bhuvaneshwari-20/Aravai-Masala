// Try the weighing-display reader on a photo from disk, exactly as the batching screen does (same Python service, same compare()).
//   The Python service must be running first:  cd ocr_service  &&  python -m uvicorn app:app --host 127.0.0.1 --port 8002
//   node src/scripts/test-ocr.js <photo.jpg> [entered_weight_kg]
//   e.g. node src/scripts/test-ocr.js D:\photos\scale-112.jpg 112.2   ->  MATCH
// The photo is only read; nothing is saved, no database row is written, the file is never changed.
// Set WEIGHING_OCR_DEBUG_DIR=<folder> to also save the enlarged / enhanced crops that were read.
require('dotenv').config();
const fs = require('fs');
const sharp = require('sharp');
const ocr = require('../utils/ocr');
const { readQr } = require('../utils/qrReader');

(async () => {
  const file = process.argv[2];
  const entered = process.argv[3] === undefined ? null : Number(process.argv[3]);
  if (!file || !fs.existsSync(file)) { console.error('Usage: node src/scripts/test-ocr.js <photo.jpg> [entered_weight_kg]'); process.exit(1); }
  // same preparation as the upload: EXIF rotation, max 2400 px, colour JPEG (see utils/imageStore.js)
  const jpeg = await sharp(fs.readFileSync(file)).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  const res = await ocr.readWeight(jpeg);
  console.log('\nOCR result :', JSON.stringify(res));
  const qr = await readQr(jpeg).catch((e) => ({ found: false, value: null, error: e.message }));
  console.log('QR result  :', JSON.stringify(qr));
  if (entered !== null && Number.isFinite(entered)) {
    const svc = require('../services/batchWeightImageService'); // same compare() as the batching screen
    const d = svc.compare(entered, res, svc.config(), 0);
    console.log(`Entered    : ${entered} kg`);
    console.log(`Detected   : ${d.detected ?? '-'} kg`);
    console.log(`STATUS     : ${d.status}${d.reason ? `  (${d.reason})` : ''}`);
  } else console.log(res.value === null ? 'STATUS     : UNREADABLE' : `Detected   : ${res.value} kg  (give an entered weight as 2nd argument to get MATCH / MISMATCH)`);
  await ocr.terminate();
  process.exit(0);
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });