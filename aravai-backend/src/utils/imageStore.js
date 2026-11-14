// Weighing photos live on disk OUTSIDE any public/static folder; MySQL keeps only the relative path.
// They are served only through the authenticated /weighing/transactions/:id/image route.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const AppError = require('./AppError');

const root = () => path.resolve(process.env.WEIGHING_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'weighing'));
const REL_RE = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/;

// Decode the upload with sharp (proves it is a real image, whatever the client claimed),
// apply EXIF rotation, strip metadata (GPS etc.), cap the size. Always stored as JPEG.
async function normalise(buffer) {
  let img;
  try {
    img = sharp(buffer, { limitInputPixels: 60e6 });
    const meta = await img.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('format');
    if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 200) throw new AppError('Image is too small. Take a clearer photo of the display');
    const out = await img.rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return out;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('Upload a valid JPEG, PNG or WebP photo');
  }
}

async function save(buffer) {
  const d = new Date();
  const rel = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.jpg`;
  const abs = path.join(root(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true, mode: 0o750 });
  await fs.writeFile(abs, buffer, { flag: 'wx', mode: 0o640 });
  return rel;
}

function absolute(rel) {
  if (!REL_RE.test(String(rel))) throw new AppError('Image reference is invalid', 500); // never trust a path read back from the DB blindly
  return path.join(root(), rel);
}

const read = (rel) => fs.readFile(absolute(rel));
const remove = (rel) => fs.unlink(absolute(rel)).catch(() => {});
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

module.exports = { normalise, save, read, remove, absolute, sha256 };
