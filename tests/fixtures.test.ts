/**
 * Checks that the synthetic vendor files are real files of the right type,
 * that the ground truth is internally consistent, and that application code
 * never reads the ground truth or seed quotes (so extraction cannot be faked).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'public', 'sample-vendor-files');
const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'ground-truth.json'), 'utf8'));
const head = (f: string, n = 8) => fs.readFileSync(path.join(DIR, f)).subarray(0, n);

describe('fixtures are real files of five different formats', () => {
  const v = truth.vendors;
  test('xlsx is a zip container', () => assert.equal(head(v['V-APEX'].file).subarray(0, 2).toString(), 'PK'));
  test('docx is a zip container', () => assert.equal(head(v['V-PRIMEPACK'].file).subarray(0, 2).toString(), 'PK'));
  test('pdf has the PDF header', () => assert.equal(head(v['V-GLOBAL'].file, 5).toString(), '%PDF-'));
  test('photo is a JPEG', () => {
    const h = head(v['V-SOUTHERN'].file, 3);
    assert.deepEqual([...h], [0xff, 0xd8, 0xff]);
  });
  test('email is RFC-822 text with headers', () => assert.match(fs.readFileSync(path.join(DIR, v['V-ECOWRAP'].file), 'utf8'), /^From: .+\r?\nTo: /));
  test('photo is large enough to be a camera image', () => assert.ok(fs.statSync(path.join(DIR, v['V-SOUTHERN'].file)).size > 200_000));
});

describe('ground truth is internally consistent', () => {
  test('every vendor covers all 30 items', () => {
    for (const [id, v] of Object.entries<any>(truth.vendors)) assert.equal(Object.keys(v.items).length, 30, id);
  });
  test('PrimePack: 27 priced (one conflicted), 3 not quoted', () => {
    const it = Object.values<any>(truth.vendors['V-PRIMEPACK'].items);
    assert.equal(it.filter((x) => x.status === 'quoted').length, 27);
    assert.equal(it.filter((x) => x.status === 'not_quoted').length, 3);
    assert.equal(it.filter((x) => x.note?.startsWith('CONFLICT')).length, 1);
  });
  test('EcoWrap reconciles: 18 firm + 1 unit-unresolved + 3 historical + 8 not quoted = 30', () => {
    const it = Object.values<any>(truth.vendors['V-ECOWRAP'].items);
    const firm = it.filter((x) => x.status === 'quoted' && x.expectedNormalisedInr != null).length;
    const unresolved = it.filter((x) => x.status === 'quoted' && x.expectedNormalisedInr == null).length;
    assert.equal(firm, 18);
    assert.equal(unresolved, 1);
    assert.equal(it.filter((x) => x.status === 'historical_reference').length, 3);
    assert.equal(it.filter((x) => x.status === 'not_quoted').length, 8);
  });
  test('historical rates appear in the email as a trap, with no usable price', () => {
    const eml = fs.readFileSync(path.join(DIR, truth.vendors['V-ECOWRAP'].file), 'utf8');
    for (const n of ['009', '010', '018']) {
      const t = truth.vendors['V-ECOWRAP'].items[`PKG-HYD-${n}`];
      assert.equal(t.expectedNormalisedInr, null);
      assert.ok(eml.includes(String(t.trapPriceInDocument.toFixed(2))), `trap price for ${n} should be present in the file`);
    }
  });
  test('Southern has three hand-corrected lines', () => {
    assert.equal(truth.vendors['V-SOUTHERN'].terms.handwrittenCorrections.length, 3);
  });
});

describe('integrity guard: extraction cannot read seed quotes or ground truth', () => {
  const walk = (d: string): string[] =>
    fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : [];
  const code = [...walk(path.join(ROOT, 'src', 'extraction')), ...walk(path.join(ROOT, 'server'))].filter((f) => /\.(ts|tsx)$/.test(f));

  test('there is extraction code to guard', () => assert.ok(code.length >= 3));
  test('extraction and server code never import seedData', () => {
    for (const f of code) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /from\s+['"][^'"]*seedData['"]/, f);
  });
  test('no application code references the ground truth or fixture generator', () => {
    for (const f of [...code, ...walk(path.join(ROOT, 'src'))].filter((x) => /\.(ts|tsx)$/.test(x))) {
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /ground-truth|generate-fixtures/, f);
    }
  });
});
