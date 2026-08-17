import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run with:  node node_modules/tsx/dist/cli.mjs src/lib/storage.test.mjs
//
/* ---------------------------------------------------------------------------
   Two invariants the storage layer is responsible for, both of which used to be
   somebody else's job and were therefore checked in one place and not another.

   1. A storage key can never escape the uploads directory. This was previously
      enforced by attachmentIngest.ts for reads and separately by
      dataDeletion.ts for deletes, each with its own path.resolve call — exactly
      the kind of duplicated guard that drifts. It now lives in storage.ts,
      which means every caller inherits it, which means it needs a test.

   2. Deletion must go through the storage layer rather than the filesystem.
      Enforced by a source assertion in dataDeletion.test.mjs; the reason is
      restated here because this is the file that would tempt someone to add an
      fs call back.
--------------------------------------------------------------------------- */

const STORAGE_SRC = fs.readFileSync(path.resolve('src/lib/storage.ts'), 'utf8');

test('the local driver refuses keys that climb out of the uploads directory', async () => {
  // storage.ts reads env at import time and warns; that is fine under test.
  const storage = await import('./storage.ts');

  const escapes = [
    '../secrets.env',
    '../../etc/passwd',
    'nested/../../outside.txt',
    // Absolute paths: path.join would keep the leading separator and resolve
    // outside the directory entirely.
    '/etc/passwd',
  ];

  for (const key of escapes) {
    await assert.rejects(
      () => storage.getObject(key, 'local'),
      // Either the containment guard fires, or the file genuinely is not there.
      // The guard is what we care about; assert on it specifically.
      (err) => {
        assert.match(
          String(err?.message ?? err),
          /outside the uploads directory|ENOENT|no such file/i,
          `expected containment or absence for "${key}", got: ${err?.message}`,
        );
        return true;
      },
      `"${key}" must not resolve to a readable path`,
    );
  }
});

test('an ordinary generated key resolves inside the uploads directory', async () => {
  const storage = await import('./storage.ts');
  // The real shape: 32 hex chars plus an extension, as multer's filename
  // callback produces. Absent from disk here, so ENOENT is the correct failure —
  // what must NOT happen is a containment rejection for a legitimate key.
  await assert.rejects(
    () => storage.getObject('a3f9c1d2e4b5a6978877665544332211.pdf', 'local'),
    (err) => {
      assert.doesNotMatch(
        String(err?.message ?? err),
        /outside the uploads directory/i,
        'a normal server-generated key was wrongly rejected as a traversal attempt',
      );
      return true;
    },
  );
});

test('deleteObject never throws, so one missing file cannot abort a cascade', async () => {
  const storage = await import('./storage.ts');
  // Deletion is called from the account/chat deletion cascade. If it threw on a
  // file that is already gone, a founder asking to be deleted would get a
  // partial deletion and an error instead of a completed one.
  const result = await storage.deleteObject('definitely-not-here-9f8e7d6c.pdf', 'local');
  assert.equal(result, false, 'a missing object should report "nothing removed", not throw');

  // Including for a key the containment guard rejects — that must be logged and
  // swallowed, not propagated into the middle of a cascade.
  const escaped = await storage.deleteObject('../../etc/passwd', 'local');
  assert.equal(escaped, false);
});

test('Supabase configuration is all-or-nothing', () => {
  // A half-configured deployment must refuse to boot rather than silently
  // falling back to a disk that gets discarded — that fallback is the exact
  // failure this module exists to remove, and it would be invisible.
  assert.match(
    STORAGE_SRC,
    /partially configured[\s\S]{0,200}Refusing to start/,
    'storage.ts must throw when only some SUPABASE_* variables are set',
  );
});

test('reads use the driver recorded on the row, never the active one', () => {
  // getObject/putText/deleteObject all take an explicit driver argument. If one
  // ever defaults to `activeDriver`, every file written before a storage switch
  // becomes unreadable and undeletable while appearing to succeed.
  for (const fn of ['getObject', 'getText', 'putText', 'deleteObject']) {
    const signature = STORAGE_SRC.match(new RegExp(`export async function ${fn}\\(([^)]*)\\)`));
    assert.ok(signature, `${fn} not found — was it renamed?`);
    assert.match(
      signature[1],
      /driver: StorageDriver/,
      `${fn} must take an explicit driver rather than reading the active one`,
    );
    assert.doesNotMatch(
      signature[1],
      /driver: StorageDriver\s*=/,
      `${fn}'s driver argument must not have a default — that reintroduces the orphaning bug`,
    );
  }
});
