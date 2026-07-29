import test from 'node:test';
import assert from 'node:assert/strict';

// Run with:  npx tsx --test src/lib/promptIntegrity.test.mjs   (from artifacts/api-server)
//
// companyMemory.ts and groq.ts both import the shared db client, which throws
// at module load without DATABASE_URL. Drizzle's pg pool is lazy — it doesn't
// open a socket until a query runs — so a placeholder URL is enough to import
// these modules and exercise their PURE functions. Nothing here touches the
// database.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';

const { mergeContextBlob } = await import('./companyMemory.ts');
const { sliceAtSafeBoundary } = await import('./groq.ts');
const { parseAttachmentMarkers } = await import('./attachmentContext.ts');

test('context blob keeps the newest segment and stays bounded', () => {
  // The blob is injected into EVERY prompt, and used to grow by naive string
  // concatenation with no cap — on a long-lived account it eventually
  // crowded out the grounding material on a budget that is already tight.
  let blob = '';
  for (let i = 0; i < 200; i++) {
    blob = mergeContextBlob(blob, `we hit milestone number ${i} this quarter`);
  }
  assert.ok(blob.length <= 1600, `blob should stay bounded, was ${blob.length}`);
  assert.ok(blob.includes('milestone number 199'), 'the newest segment must always survive');
  assert.ok(!blob.includes('milestone number 0 '), 'the oldest segments should have been dropped');
});

test('context blob drops exact duplicates but keeps genuine updates', () => {
  const once = mergeContextBlob('', 'we are a B2B SaaS for clinics');
  const twice = mergeContextBlob(once, 'we are a B2B SaaS for clinics');
  assert.equal(twice, once, 're-stating the same context must not duplicate it');

  const updated = mergeContextBlob(once, 'we are at $35,000 MRR');
  assert.ok(updated.includes('B2B SaaS for clinics'));
  assert.ok(updated.includes('$35,000 MRR'), 'a genuinely new detail must be kept');
});

test('shrink never cuts a figure in half', () => {
  // The failure this prevents: a raw slice landing inside "$4.2M" hands the
  // model "$4" and it reasons from the mutilated number as though whole.
  const text = 'Revenue last year was $4.2M across 1,200 accounts.\n\nBurn is $310K per month and runway is 14 months.';
  const cut = sliceAtSafeBoundary(text, 60);
  const beforeNotice = cut.split('[Context truncated')[0];
  assert.ok(!/\$4\.?\d?$/.test(beforeNotice.trim()), 'must not end mid-figure');
  assert.ok(cut.includes('[Context truncated'), 'the model must be told content was removed');
  assert.ok(!beforeNotice.includes('Burn is $310K'), 'content past the cut point must be gone');
});

test('shrink is a no-op when the text already fits', () => {
  const text = 'short enough';
  assert.equal(sliceAtSafeBoundary(text, 100), text);
  assert.ok(!sliceAtSafeBoundary(text, 100).includes('[Context truncated'));
});

test('attachment markers are parsed out of the composer message', () => {
  assert.deepEqual(
    parseAttachmentMarkers('whats wrong with these numbers\n\n[Attached file: q3-pnl.csv]'),
    ['q3-pnl.csv'],
  );
  assert.deepEqual(
    parseAttachmentMarkers('[Attached file: a.png]\n[Attached file: b.pdf]\n[Attached file: a.png]'),
    ['a.png', 'b.pdf'],
    'duplicates collapse, order preserved',
  );
  assert.deepEqual(parseAttachmentMarkers('no attachments here'), []);
});
