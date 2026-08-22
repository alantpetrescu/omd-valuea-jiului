/**
 * Compares the two captures.
 *
 * Two independent checks per state, because either alone lies. The pixel diff
 * catches spacing and colour drift that a text comparison calls equal; the text
 * comparison catches wrong numbers, wrong ordering and missing rows that a
 * pixel diff shows only as a blur. A state passes when both agree.
 *
 * MODE=static|interactive; ALLOW_ADMIN_EXTRAS=1 tolerates the ADMIN-only
 * editor block, which by design has no counterpart in the prototype.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from '../../shared/deps.mjs';
import { pixelmatch } from '../../shared/deps.mjs';

import { SHOTS } from '../../shared/config.mjs';

const mode = process.env.MODE ?? 'static';
const allowAdminExtras = process.env.ALLOW_ADMIN_EXTRAS === '1';

const diffDir = resolve(SHOTS, `diff-${mode}`);
mkdirSync(diffDir, { recursive: true });

function loadCapture(side) {
  const path = resolve(SHOTS, `${side}-${mode}-dom.json`);
  if (!existsSync(path)) {
    console.error(`No ${side} capture for mode "${mode}". The capture step failed — fix that first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

const protoDom = loadCapture('proto');
const reactDom = loadCapture('react');

/** The ADMIN-only affordance; absent from the prototype on purpose. */
const ADMIN_MARKERS = ['Administrare reper', 'Editează reperul'];

const SEP = '\u0000';

/**
 * Visible text, one token per text node, whitespace-normalised.
 *
 * Tag boundaries become separators rather than being deleted, so "6" and
 * "utilizate" cannot silently fuse into one token and hide a missing element.
 * Comparing the token *sequence* also catches reordering, which a bag of words
 * would not.
 */
function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, SEP)
    .replace(/<[^>]+>/g, SEP)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .split(SEP)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const results = [];

for (const name of Object.keys(protoDom)) {
  const row = { state: name };

  const a = textOf(protoDom[name]);
  const b = textOf(reactDom[name] ?? '');

  const counts = new Map();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const token of b) counts.set(token, (counts.get(token) ?? 0) - 1);

  row.missing = [];
  row.extra = [];
  for (const [token, n] of counts) {
    if (n > 0) row.missing.push(n > 1 ? `${token} ×${n}` : token);
    if (n < 0) row.extra.push(n < -1 ? `${token} ×${-n}` : token);
  }

  row.adminOnly =
    allowAdminExtras &&
    row.missing.length === 0 &&
    row.extra.length > 0 &&
    ADMIN_MARKERS.every((marker) => row.extra.some((token) => token.includes(marker)));

  row.textEqual = a.length === b.length && a.every((token, i) => token === b[i]);

  const pa = resolve(SHOTS, `proto-${mode}`, `${name}.png`);
  const pb = resolve(SHOTS, `react-${mode}`, `${name}.png`);
  if (existsSync(pa) && existsSync(pb)) {
    const ia = PNG.sync.read(readFileSync(pa));
    const ib = PNG.sync.read(readFileSync(pb));
    row.protoSize = `${ia.width}x${ia.height}`;
    row.reactSize = `${ib.width}x${ib.height}`;
    if (ia.width === ib.width && ia.height === ib.height) {
      const out = new PNG({ width: ia.width, height: ia.height });
      row.diffPixels = pixelmatch(ia.data, ib.data, out.data, ia.width, ia.height, { threshold: 0.1 });
      row.diffPct = +((row.diffPixels / (ia.width * ia.height)) * 100).toFixed(4);
      if (row.diffPixels > 0) writeFileSync(resolve(diffDir, `${name}.png`), PNG.sync.write(out));
    } else {
      row.diffPixels = null;
      row.sizeMismatch = true;
    }
  }

  row.pass = row.adminOnly
    ? row.missing.length === 0
    : row.missing.length === 0 && row.extra.length === 0 && row.textEqual && row.diffPixels === 0;

  results.push(row);
}

writeFileSync(resolve(SHOTS, `report-${mode}.json`), JSON.stringify(results, null, 2));

const pad = (value, width) => String(value).padEnd(width);
console.log(pad('STATE', 30), pad('PROTO', 12), pad('REACT', 12), pad('DIFF px', 9), pad('DIFF %', 9), pad('TEXT', 9), 'RESULT');
for (const row of results) {
  const text = row.adminOnly ? 'admin+' : row.textEqual ? 'ok' : `-${row.missing.length}/+${row.extra.length}`;
  console.log(
    pad(row.state, 30),
    pad(row.protoSize ?? '-', 12),
    pad(row.reactSize ?? '-', 12),
    pad(row.diffPixels ?? 'n/a', 9),
    pad(row.diffPct ?? 'n/a', 9),
    pad(text, 9),
    row.pass ? 'PASS' : 'FAIL',
  );
}

const failed = results.filter((row) => !row.pass);
console.log(`\n${results.length - failed.length}/${results.length} states match (mode: ${mode})`);
for (const row of failed) {
  if (row.missing.length) console.log(`  ${row.state} missing: ${row.missing.slice(0, 8).join(' | ')}`);
  if (row.extra.length) console.log(`  ${row.state} extra:   ${row.extra.slice(0, 8).join(' | ')}`);
  if (row.sizeMismatch) console.log(`  ${row.state}: different height, see ${diffDir}`);
}
process.exit(failed.length ? 1 : 0);
