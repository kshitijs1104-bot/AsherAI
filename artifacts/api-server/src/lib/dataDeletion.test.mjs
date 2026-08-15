import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run with:  npx tsx --test src/lib/dataDeletion.test.mjs   (from artifacts/api-server)

/* ---------------------------------------------------------------------------
   These are coverage tests, not behaviour tests.

   deleteAllUserData talks to Postgres and the filesystem, so exercising it for
   real needs a database this suite does not have. What can be checked without
   one — and what actually protects the promise — is whether the enumeration is
   COMPLETE. Section 7 of the privacy policy tells founders that closing their
   account deletes everything we hold about them. That statement is true only
   for as long as every user-scoped table appears in dataDeletion.ts.

   The way that promise breaks is not a bug in this function. It is someone
   adding a table six months from now, scoping it to userId, and never touching
   this file — at which point the policy becomes a written misstatement and
   nothing anywhere fails. So the schema directory is the source of truth here:
   these tests read it, work out which tables hold user data, and fail if the
   deletion module does not mention one.
--------------------------------------------------------------------------- */

const SCHEMA_DIR = path.resolve('../../lib/db/src/schema');
const DELETION_SRC = fs.readFileSync(path.resolve('src/lib/dataDeletion.ts'), 'utf8');

// Tables that deliberately hold no user data. If a name lands here it is a
// claim that the table is global, and the reason has to be written down.
const NOT_USER_SCOPED = {
  precedentsTable: 'Shared corpus of outcomes from other companies — nothing of any one user in it.',
  companiesTable: 'Legacy Nexus market data, not founder data.',
  eventsTable: 'Legacy Nexus market data, not founder data.',
  reportsTable: 'Legacy Nexus market data, not founder data.',
  signalsTable: 'Legacy Nexus market data, not founder data.',
  thoughtsTable: 'Legacy Nexus surface, archived — no userId column.',
  reactionsTable: 'Legacy Nexus surface, archived — no userId column.',
};

/** Every exported drizzle table, with whether it carries a per-user column. */
function readSchemaTables() {
  const tables = [];

  for (const file of fs.readdirSync(SCHEMA_DIR)) {
    if (!file.endsWith('.ts') || file === 'index.ts') continue;
    const src = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');

    for (const match of src.matchAll(/export const (\w+Table) = pgTable\(/g)) {
      const name = match[1];
      // Slice from this declaration to the next one so a multi-table file
      // (thoughts.ts declares two) attributes columns to the right table.
      const start = match.index;
      const nextDecl = src.slice(start + 1).search(/export const \w+Table = pgTable\(/);
      const body = nextDecl === -1 ? src.slice(start) : src.slice(start, start + 1 + nextDecl);

      // Only column DEFINITIONS count. `userId: text("user_id")` is a column;
      // the word "userId" inside a comment is not, and several of these files
      // discuss userId at length in prose.
      const hasUserId = /^\s*userId: /m.test(body);
      const hasSessionId = /^\s*sessionId: /m.test(body);

      tables.push({ name, file, userScoped: hasUserId || hasSessionId });
    }
  }

  return tables;
}

test('the schema is readable and has the tables we expect', () => {
  const tables = readSchemaTables();
  assert.ok(tables.length > 15, `expected a real schema, found ${tables.length} tables`);
  // Spot-check both scoping conventions are detected, since the whole suite
  // rests on this parse being right.
  assert.equal(tables.find((t) => t.name === 'messagesTable')?.userScoped, true);
  assert.equal(tables.find((t) => t.name === 'settingsTable')?.userScoped, true, 'settings scopes on sessionId');
  assert.equal(tables.find((t) => t.name === 'venusDecisionsTable')?.userScoped, true, 'venus_decisions scopes on sessionId');
  assert.equal(tables.find((t) => t.name === 'precedentsTable')?.userScoped, false);
});

/**
 * Whether the module actually issues a DELETE against this table.
 *
 * Checking `DELETION_SRC.includes(name)` was the first version and it was
 * useless: every one of these tables is also named in the import block at the
 * top of the file, so the assertion passed for a table that was imported and
 * never deleted. Verified by breaking it on purpose — swapping the body of the
 * workflows delete for a duplicate of another table left the name in the
 * imports, and the test stayed green.
 *
 * A delete statement is the only thing that counts.
 */
function isDeletedFrom(source, tableName) {
  return new RegExp(`\\.delete\\(\\s*${tableName}\\s*\\)`).test(source);
}

test('every user-scoped table is deleted by deleteAllUserData', () => {
  const missing = readSchemaTables()
    .filter((t) => t.userScoped && !NOT_USER_SCOPED[t.name])
    .filter((t) => !isDeletedFrom(DELETION_SRC, t.name))
    .map((t) => `${t.name} (${t.file})`);

  assert.deepEqual(
    missing,
    [],
    `These tables hold user data but dataDeletion.ts never deletes from them, so "closing your ` +
      `account deletes everything" in section 7 of the privacy policy is false. Add them to ` +
      `deleteAllUserData, or add them to NOT_USER_SCOPED with a reason:\n  ${missing.join('\n  ')}`,
  );
});

test('no table is excluded without a stated reason', () => {
  const names = new Set(readSchemaTables().map((t) => t.name));
  const stale = Object.keys(NOT_USER_SCOPED).filter((n) => !names.has(n));
  assert.deepEqual(stale, [], `NOT_USER_SCOPED names tables that no longer exist: ${stale.join(', ')}`);

  for (const [name, reason] of Object.entries(NOT_USER_SCOPED)) {
    assert.ok(reason.length > 20, `${name} needs a real reason for being excluded, not "${reason}"`);
  }
});

test('chat deletion covers every table that references a chat', () => {
  // The other half of section 7: deleting a chat has to remove the transcript,
  // the files and what Vera derived from that conversation. Any table with a
  // chatId is part of that, and is expected to appear in deleteChatData
  // specifically — not merely somewhere in the file.
  const chatScoped = [];

  for (const file of fs.readdirSync(SCHEMA_DIR)) {
    if (!file.endsWith('.ts') || file === 'index.ts') continue;
    const src = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
    if (!/^\s*chatId: /m.test(src)) continue;
    for (const match of src.matchAll(/export const (\w+Table) = pgTable\(/g)) chatScoped.push(match[1]);
  }

  assert.ok(chatScoped.length >= 5, `expected several chat-scoped tables, found ${chatScoped.join(', ')}`);

  const chatFn = DELETION_SRC.slice(
    DELETION_SRC.indexOf('export async function deleteChatData'),
    DELETION_SRC.indexOf('export async function deleteAllUserData'),
  );
  assert.ok(chatFn.length > 500, 'could not isolate deleteChatData — did it get renamed?');

  // chatsTable itself is deleted by the route after the cascade runs, not
  // inside deleteChatData, so it is not expected here. attachmentsTable is
  // deleted via inArray on collected ids rather than a direct .delete(table)
  // — the files have to come off disk first — so it is matched by name here.
  const missing = chatScoped
    .filter((n) => n !== 'chatsTable')
    .filter((n) => !isDeletedFrom(chatFn, n) && !chatFn.includes(n));

  assert.deepEqual(
    missing,
    [],
    `These tables are attached to a chat but deleteChatData leaves them behind, so "delete a chat ` +
      `and its data is gone" is false for them: ${missing.join(', ')}`,
  );
});

test('attachment sidecars are deleted alongside the file itself', () => {
  // The sidecar holds the FULL extracted text of an upload, and for an image the
  // vision model's description of it. Deleting the original and keeping the
  // sidecar would leave the readable contents of a deleted P&L on disk.
  assert.match(
    DELETION_SRC,
    /\.vera\.json/,
    'dataDeletion.ts must remove the .vera.json sidecar, not just the uploaded file',
  );
});

test('deletion is scoped by user, never by id alone', () => {
  // Every delete in this module must constrain on the owner as well as the row
  // id. A statement keyed only on chatId would let a wrong or hostile id delete
  // somebody else's data.
  const deleteCalls = DELETION_SRC.match(/db\s*\n?\s*\.delete\([\s\S]{0,400}?\)\)/g) ?? [];
  assert.ok(deleteCalls.length >= 10, `expected the full set of deletes, found ${deleteCalls.length}`);

  for (const call of deleteCalls) {
    const scoped = /userId\)|sessionId, userId\)|inArray\(/.test(call);
    assert.ok(scoped, `a delete is not scoped to the owning user:\n${call}`);
  }
});
