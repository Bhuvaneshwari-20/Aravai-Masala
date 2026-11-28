#!/usr/bin/env node
// Applies patches.txt and copies the new files. ALL-OR-NOTHING: every "find" text must occur exactly once in its file,
// otherwise nothing is written. Originals are saved next to the file as <name>.bak-roastpair.
//
//   node apply.js <backend-folder> <frontend-folder> [--dry]       (--dry = check only, write nothing)
//   node apply.js <backend-folder> <frontend-folder> --new-only    (copy the new files only)
const fs = require('fs');
const path = require('path');

const [backendRoot, frontendRoot, ...flags] = process.argv.slice(2);
if (!backendRoot || !frontendRoot) { console.error('Usage: node apply.js <backend-folder> <frontend-folder> [--dry|--new-only]'); process.exit(2); }
const dry = flags.includes('--dry');
const newOnly = flags.includes('--new-only');
const root = (r) => (r === 'backend' ? backendRoot : frontendRoot);
const BAK = '.bak-roastpair';

function parse(text) {
  const edits = []; let cur = null; let mode = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('@@@ ')) { const p = line.split(' '); cur = { root: p[1], file: p.slice(2).join(' ').trim(), find: [], replace: [] }; edits.push(cur); mode = null; }
    else if (line === '--- find') mode = 'find';
    else if (line === '--- replace') mode = 'replace';
    else if (line === '--- end') mode = null;
    else if (mode && cur) cur[mode].push(line);
  }
  return edits.map((e) => ({ ...e, find: e.find.join('\n'), replace: e.replace.join('\n') }));
}

function copyNew(dir, target) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]));
  const base = path.join(__dirname, 'new-files', dir);
  walk(base).forEach((src) => {
    const dst = path.join(target, path.relative(base, src));
    if (dry) { console.log(`[dry] would write ${dst}`); return; }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(dst) && !fs.existsSync(dst + BAK)) fs.copyFileSync(dst, dst + BAK);
    fs.copyFileSync(src, dst);
    console.log(`wrote ${dst}`);
  });
}

if (!newOnly) {
  const edits = parse(fs.readFileSync(path.join(__dirname, 'patches.txt'), 'utf8'));
  const files = new Map(); const errors = [];
  edits.forEach((e, n) => {
    const fp = path.join(root(e.root), e.file);
    if (!files.has(fp)) {
      if (!fs.existsSync(fp)) { files.set(fp, null); errors.push(`MISSING FILE  ${fp}`); }
      else if (fs.existsSync(fp + BAK)) { files.set(fp, null); errors.push(`ALREADY PATCHED  ${fp} (found ${path.basename(fp)}${BAK}). Restore the backup first to run again`); }
      else { const raw = fs.readFileSync(fp, 'utf8'); files.set(fp, { eol: raw.includes('\r\n') ? '\r\n' : '\n', text: raw.replace(/\r\n/g, '\n') }); }
    }
    const f = files.get(fp);
    if (!f) return;
    const count = f.text.split(e.find).length - 1;
    if (count !== 1) { errors.push(`EDIT #${n + 1} in ${e.file}: text found ${count} times (need exactly 1):\n      ${e.find.split('\n')[0].slice(0, 110)}`); return; }
    f.text = f.text.replace(e.find, () => e.replace);
  });
  if (errors.length) { console.error(`\nNothing was changed. ${errors.length} problem(s):\n`); errors.forEach((m) => console.error(`  - ${m}`)); process.exit(1); }
  files.forEach((f, fp) => {
    if (dry) { console.log(`[dry] ok  ${fp}`); return; }
    fs.copyFileSync(fp, fp + BAK);
    fs.writeFileSync(fp, f.text.replace(/\n/g, f.eol));
    console.log(`patched ${fp}`);
  });
  console.log(`${edits.length} edits in ${files.size} files ${dry ? 'checked' : 'applied'}.`);
}
copyNew('backend', backendRoot);
copyNew('frontend', frontendRoot);