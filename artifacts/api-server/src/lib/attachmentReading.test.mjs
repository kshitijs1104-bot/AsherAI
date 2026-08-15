import test from 'node:test';
import assert from 'node:assert/strict';

// Run with:  npx tsx --test src/lib/attachmentReading.test.mjs   (from artifacts/api-server)
//
// attachmentContext.ts and groq.ts both import the shared db client, which
// throws at module load without DATABASE_URL. Drizzle's pool is lazy, so a
// placeholder is enough to import them and exercise their PURE functions —
// same arrangement as promptIntegrity.test.mjs. Nothing here touches the
// database or the network.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';

const { hasThinContext, parseAttachmentMarkers } = await import('./attachmentContext.ts');
const { pickVisionModel, isLikelyVisionModel } = await import('./visionExtract.ts');
const { isJsonValidateFailedError, extractFailedGeneration, callGroqJSON } = await import('./groq.ts');

//
// Covers the parts of "Vera can read your attachments" that are pure logic:
// which model gets picked for images, when a file arrives with no stated
// task, and the Groq error-shape handling whose silent failure is what turned
// an honest one-sentence answer into a 400 in production.

/* ---- vision model resolution ---------------------------------------- */

test('picks Groq\'s actual vision model, whose name says nothing about vision', () => {
  // THE REGRESSION THIS LOCKS DOWN. The first version matched model names
  // against /vision|llama-4|vl|omni/. Groq's current vision model is
  // "qwen/qwen3.6-27b" — no vision-ish token anywhere in it — so every image
  // resolved to "no vision model available" and came back unreadable, which
  // is indistinguishable from the feature never having been built.
  const realGroqCatalog = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'whisper-large-v3',
    'qwen/qwen3.6-27b',
  ];
  assert.equal(pickVisionModel(realGroqCatalog), 'qwen/qwen3.6-27b');
  // And it must win over the deprecated llama-4 models if both are present.
  assert.equal(
    pickVisionModel(['meta-llama/llama-4-maverick-17b-128e-instruct', 'qwen/qwen3.6-27b']),
    'qwen/qwen3.6-27b',
  );
});

test('prefers a known-good vision model when the account has one', () => {
  const available = [
    'openai/gpt-oss-120b',
    'whisper-large-v3',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
  ];
  assert.equal(pickVisionModel(available), 'meta-llama/llama-4-maverick-17b-128e-instruct');
});

test('falls back to any vision-capable id when no preferred model is present', () => {
  assert.equal(pickVisionModel(['openai/gpt-oss-20b', 'some-new-11b-vision-model']), 'some-new-11b-vision-model');
});

test('never picks a speech, safety or embedding model as the image reader', () => {
  // "whisper-large-v3" and "llama-guard-4-12b" both match loose name patterns
  // if the exclusion list is missing — picking either means every image read
  // fails with a provider 400 instead of degrading honestly.
  assert.equal(pickVisionModel(['whisper-large-v3', 'meta-llama/llama-guard-4-12b', 'openai/gpt-oss-120b']), null);
  assert.equal(isLikelyVisionModel('whisper-large-v3'), false);
  assert.equal(isLikelyVisionModel('meta-llama/llama-guard-4-12b'), false);
});

test('returns null rather than guessing when the account has no vision model', () => {
  assert.equal(pickVisionModel(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']), null);
});

/* ---- "they sent a file and said nothing" ----------------------------- */

test('detects an attachment sent with no stated task', () => {
  assert.equal(hasThinContext('[Attached file: q3-pnl.pdf]'), true);
  assert.equal(hasThinContext('thoughts?\n\n[Attached file: q3-pnl.pdf]'), true);
  assert.equal(hasThinContext('have a look [Attached file: deck.pdf]'), true);
});

test('does not treat a real question as missing context', () => {
  assert.equal(
    hasThinContext('why did our gross margin drop between Q1 and Q2?\n\n[Attached file: q3-pnl.pdf]'),
    false,
  );
  // Short but genuinely specific — the length threshold alone must not swallow it.
  assert.equal(hasThinContext('is this term sheet standard?\n[Attached file: ts.pdf]'), false);
});

test('reads every attachment marker off the raw message', () => {
  assert.deepEqual(
    parseAttachmentMarkers('here\n[Attached file: a.csv]\n[Attached file: b.png]'),
    ['a.csv', 'b.png'],
  );
});

/* ---- Groq error shape ------------------------------------------------ */

// The exact shape groq-sdk builds: APIError.error holds the RESPONSE BODY,
// which is itself { error: { ... } }. Reading err.code or err.error.code —
// as this file did — finds nothing on a real error.
function groqJsonValidateFailed(failedGeneration) {
  const err = new Error(`400 {"error":{"message":"Failed to generate JSON."}}`);
  err.status = 400;
  err.error = {
    error: {
      message: 'Failed to generate JSON. Please adjust your prompt.',
      type: 'invalid_request_error',
      code: 'json_validate_failed',
      failed_generation: failedGeneration,
    },
  };
  return err;
}

test('recognises a real json_validate_failed error through the nested body', () => {
  assert.equal(isJsonValidateFailedError(groqJsonValidateFailed('nope')), true);
  assert.equal(extractFailedGeneration(groqJsonValidateFailed('the model said this')), 'the model said this');
});

test('still recognises a flattened error shape', () => {
  assert.equal(isJsonValidateFailedError({ status: 400, code: 'json_validate_failed' }), true);
});

test('does not mistake other 400s for a JSON validation failure', () => {
  assert.equal(isJsonValidateFailedError({ status: 400, error: { error: { code: 'invalid_api_key' } } }), false);
  assert.equal(isJsonValidateFailedError({ status: 429, error: { error: { code: 'json_validate_failed' } } }), false);
});

/* ---- prose salvage --------------------------------------------------- */

function fakeGroq(behaviour) {
  let calls = 0;
  return {
    calls: () => calls,
    chat: {
      completions: {
        create: async () => {
          calls++;
          return behaviour(calls);
        },
      },
    },
  };
}

test('salvages a plain-prose answer instead of failing the whole request', async () => {
  // The production case: the model answers "I can't read that PDF, paste the
  // figures" — a correct answer — and JSON mode rejects it three times.
  const prose = "I can't extract text from the PDF directly. Paste the key numbers and I'll work through them.";
  const groq = fakeGroq(() => {
    throw groqJsonValidateFailed(prose);
  });

  const { parsed } = await callGroqJSON(
    groq,
    { model: 'openai/gpt-oss-120b', messages: [{ role: 'system', content: 'answer in json' }], temperature: 0, max_tokens: 1200 },
    'test/salvage',
    { salvageProseAs: 'summary' },
  );

  assert.equal(parsed.summary, prose);
});

test('does not salvage when the caller named no field', async () => {
  const groq = fakeGroq(() => {
    throw groqJsonValidateFailed('some prose');
  });

  await assert.rejects(() =>
    callGroqJSON(
      groq,
      { model: 'openai/gpt-oss-120b', messages: [{ role: 'system', content: 'answer in json' }], temperature: 0, max_tokens: 1200 },
      'test/no-salvage',
    ),
  );
});

test('a repairable JSON generation is repaired, not salvaged as prose', async () => {
  // Brace repair must still win: salvaging valid-once-repaired JSON into a
  // text field would throw away real cards.
  const groq = fakeGroq(() => {
    throw groqJsonValidateFailed('{"summary":"real answer","cards":[]}}');
  });

  const { parsed } = await callGroqJSON(
    groq,
    { model: 'openai/gpt-oss-120b', messages: [{ role: 'system', content: 'answer in json' }], temperature: 0, max_tokens: 1200 },
    'test/repair-first',
    { salvageProseAs: 'summary' },
  );

  assert.equal(parsed.summary, 'real answer');
  assert.deepEqual(parsed.cards, []);
});
