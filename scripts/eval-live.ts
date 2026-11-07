/**
 * LIVE EVALUATION against the real Gemini API. Needs GEMINI_API_KEY in the environment.
 * Without a key it prints SKIPPED and exits 0 (it never pretends to have passed).
 *
 *   GEMINI_API_KEY=... npx tsx scripts/eval-live.ts
 *
 * For each of the five sample vendor files it runs the real extraction pipeline and compares the
 * normalised INR prices with the generator's expected values (tests/fixtures/ground-truth.json,
 * which the app itself never reads). Reports exact counts; does not hide failures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { INITIAL_LINE_ITEMS as ITEMS, INITIAL_VENDORS } from '../src/data/seedData';
import { extractVendorDocument } from '../server/extract';
import { createGeminiClient, isModelConfigured } from '../server/model';
import { deriveVendorData } from '../src/extraction/derive';

const ROOT = path.resolve(import.meta.dirname, '..');
if (!isModelConfigured()) {
  console.log('SKIPPED: GEMINI_API_KEY is not set. No live evaluation was run and no accuracy claim can be made.');
  process.exit(0);
}

const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'ground-truth.json'), 'utf8')).vendors as Record<string, {
  file: string; items: Record<string, { status: string; expectedNormalisedInr?: number | null }>;
}>;
const model = createGeminiClient();
const rfx = ITEMS.map((i) => ({ id: i.id, code: i.code, description: i.description, standardUom: i.standardUom, quantity: i.quantity }));

(async () => {
  console.log(`Model: ${model.modelName}\n`);
  const summary: string[] = [];
  for (const v of INITIAL_VENDORS) {
    const t = truth[v.id];
    if (!t) continue;
    const bytes = fs.readFileSync(path.join(ROOT, 'public', 'sample-vendor-files', t.file));
    try {
      const { result } = await extractVendorDocument({ fileName: t.file, mimeType: '', bytes, lineItems: rfx }, model);
      const d = deriveVendorData(v, result, ITEMS);
      let priceOk = 0, priceWrong = 0, priceMissing = 0, notComparableOk = 0, falsePrice = 0;
      const wrong: string[] = [];
      for (const [itemId, exp] of Object.entries(t.items)) {
        const cell = d.cells.find((c) => c.itemId === itemId)!;
        if (exp.expectedNormalisedInr != null) {
          if (cell.normalisedUnitPriceInr == null) { priceMissing++; wrong.push(`${itemId}: expected ${exp.expectedNormalisedInr}, got none (${(cell.blockReasons ?? []).join(',')})`); }
          else if (Math.abs(cell.normalisedUnitPriceInr - exp.expectedNormalisedInr) <= 0.015) priceOk++;
          else { priceWrong++; wrong.push(`${itemId}: expected ${exp.expectedNormalisedInr}, got ${cell.normalisedUnitPriceInr}`); }
        } else {
          if (cell.normalisedUnitPriceInr == null) notComparableOk++;
          else { falsePrice++; wrong.push(`${itemId}: expected NO usable price (${exp.status}), got ${cell.normalisedUnitPriceInr}`); }
        }
      }
      const line = `${v.shortName.padEnd(10)} correct prices ${priceOk}, wrong ${priceWrong}, missing ${priceMissing}; correctly withheld ${notComparableOk}, wrongly priced ${falsePrice}; exceptions raised ${d.exceptions.length}`;
      summary.push(line);
      console.log(line);
      wrong.slice(0, 12).forEach((w) => console.log('   -', w));
    } catch (e) {
      const line = `${v.shortName.padEnd(10)} FAILED: ${(e as Error).message}`;
      summary.push(line);
      console.log(line);
    }
  }
  console.log('\nSUMMARY\n' + summary.join('\n'));
})();
