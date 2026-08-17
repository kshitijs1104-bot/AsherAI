import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run with:  node node_modules/tsx/dist/cli.mjs src/lib/auditLog.test.mjs
//
/* ---------------------------------------------------------------------------
   The audit trail is read by one founder looking at ANOTHER founder's account.
   The only reason that is acceptable is that it contains no user content — just
   what happened, to whom, on which route. So "no content in audit_events" is a
   privacy property, not a style rule, and it needs a test rather than a comment.

   The metadata sanitiser is what enforces it: primitives pass, anything
   structured is dropped. That is deliberately blunt — it makes it awkward to
   pass a request body, a message or a dossier field into an audit row by
   accident, which is the realistic way this table would end up holding content.
--------------------------------------------------------------------------- */

const AUDIT_SRC = fs.readFileSync(path.resolve('src/lib/auditLog.ts'), 'utf8');
const SCHEMA_SRC = fs.readFileSync(path.resolve('../../lib/db/src/schema/audit_events.ts'), 'utf8');

// The sanitiser is module-private, so it is exercised through the source rather
// than imported. These assertions are about the RULES it encodes; the behaviour
// tests below drive it through the real function via a stubbed db.
test('metadata keeps primitives and drops structured values', async () => {
  // Stub the database so recordAuditEvent can be driven without one, and
  // capture what it would have written.
  const captured = [];
  const dbModule = await import('@workspace/db');
  const original = dbModule.db.insert;
  dbModule.db.insert = () => ({ values: async (row) => { captured.push(row); } });

  try {
    const { recordAuditEvent } = await import('./auditLog.ts');

    await recordAuditEvent({
      eventType: 'abuse.rate_limited',
      userId: 'user_abc',
      subject: 'u:user_abc',
      route: '/ai/analyze',
      severity: 'warn',
      metadata: {
        limiter: 'expensive',
        attempts: 41,
        blocked: true,
        // The things that must never survive: a whole message, a nested object,
        // an array of user text.
        message: { role: 'user', content: 'our Q3 revenue was 412000' },
        transcript: ['line one', 'line two'],
      },
    });

    assert.equal(captured.length, 1, 'expected exactly one row to be written');
    const row = captured[0];
    const metadata = JSON.parse(row.metadataJson);

    assert.equal(metadata.limiter, 'expensive');
    assert.equal(metadata.attempts, 41);
    assert.equal(metadata.blocked, true);

    assert.equal(metadata.message, undefined, 'a nested object must not be stored');
    assert.equal(metadata.transcript, undefined, 'an array must not be stored');
    assert.match(metadata._dropped, /message/, 'dropped keys must be recorded, not silently discarded');
    assert.match(metadata._dropped, /transcript/);

    // And nothing anywhere in the serialised row may contain the content.
    assert.doesNotMatch(JSON.stringify(row), /412000/, 'user content reached the audit row');
  } finally {
    dbModule.db.insert = original;
  }
});

test('a failing insert never propagates', async () => {
  const dbModule = await import('@workspace/db');
  const original = dbModule.db.insert;
  dbModule.db.insert = () => ({ values: async () => { throw new Error('relation "audit_events" does not exist'); } });

  try {
    const { recordAuditEvent } = await import('./auditLog.ts');
    // Every caller is a handler doing something else — refusing an upload,
    // blocking a write, deleting an account. If recording that failed and threw,
    // a missing table would turn the product off in the name of logging that the
    // product was working.
    await recordAuditEvent({ eventType: 'abuse.csrf_blocked', severity: 'critical' });
  } finally {
    dbModule.db.insert = original;
  }
});

test('long metadata is truncated rather than written unbounded', () => {
  assert.match(AUDIT_SRC, /MAX_METADATA_CHARS/, 'metadata length must be bounded');
  assert.match(AUDIT_SRC, /slice\(0, MAX_METADATA_CHARS\)/);
});

test('the schema states the no-content rule where a future editor will read it', () => {
  // The column comment is the thing that stops someone adding a `body` field to
  // this table in six months. It has to say so explicitly.
  assert.match(SCHEMA_SRC, /NEVER user content/i, 'audit_events schema must state the no-content rule');
  assert.match(SCHEMA_SRC, /never a raw IP|Never a bare IP/i, 'audit_events schema must state the no-IP rule');
});

test('audit events are never deleted by their own subject', () => {
  // A trail its subject can erase by closing their account is not a trail. The
  // deletion module anonymises instead; dataDeletion.test.mjs checks that the
  // anonymisation is real. This asserts the intent is recorded here too.
  const deletionSrc = fs.readFileSync(path.resolve('src/lib/dataDeletion.ts'), 'utf8');
  assert.doesNotMatch(
    deletionSrc,
    /\.delete\(\s*auditEventsTable\s*\)/,
    'audit_events must be anonymised on account deletion, not deleted',
  );
});
