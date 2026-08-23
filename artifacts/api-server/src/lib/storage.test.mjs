import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

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

test('a half-configured bucket disables attachments without taking the server down', async () => {
  /* A partial SUPABASE_* configuration has to do two things AT ONCE, and the
     first version of this rule only did the second:

       - it must never fall back to the local disk, because on an autoscale
         host that disk is discarded on redeploy and the founder's document is
         gone while the UI still lists it;
       - it must not stop the rest of the API from working. It used to `throw`
         at module scope, which aborted boot for every route — sign-in,
         /access/me, the operator surface — over one mistyped Secret out of
         three.

     Checked in a CHILD PROCESS rather than in this one because storage.ts
     reads its environment once at import time and the module is then cached;
     there is no way to re-import it under different env in-process. The child
     imports the module, then reports what it observed. */

  const probe = `
    const s = await import(${JSON.stringify(new URL('./storage.ts', import.meta.url).href)});
    let rejected = false;
    try { await s.putFromTempFile('k', 'tmp', 'text/plain'); } catch { rejected = true; }
    // Marker-delimited: the module logs its own (pretty-printed) warning to
    // stdout on import, so the result cannot just be "the last line".
    console.log('__PROBE__' + JSON.stringify({
      imported: true,
      reason: s.storageUnavailableReason,
      rejected,
      healthy: await s.storageHealthy(),
    }));
  `;

  // Written to a file rather than passed with `-e`: tsx's loader refuses
  // --input-type=module, so an inline script cannot use `await import`.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-storage-probe-'));
  const probePath = path.join(dir, 'probe.mjs');
  fs.writeFileSync(probePath, probe, 'utf8');

  let child;
  try {
    child = spawnSync(process.execPath, ['--import', 'tsx', probePath], {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Two of three: the exact shape that used to abort boot.
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
        SUPABASE_STORAGE_BUCKET: '',
      },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(
    child.status,
    0,
    `importing storage.ts with a partial config must not abort the process. stderr:\n${child.stderr}`,
  );

  const marked = child.stdout.split(/\r?\n/).find((l) => l.includes('__PROBE__'));
  assert.ok(marked, `probe produced no result.\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`);
  const out = JSON.parse(marked.slice(marked.indexOf('__PROBE__') + '__PROBE__'.length));

  assert.ok(out.reason, 'a partial config must expose storageUnavailableReason');
  assert.match(out.reason, /SUPABASE_STORAGE_BUCKET/, 'the reason must name the variable that is missing');
  assert.ok(out.rejected, 'writes must be refused rather than falling back to the local disk');
  assert.equal(out.healthy, false, 'storageHealthy must report the misconfiguration');
});

test('a partial config is refused rather than silently falling back to disk', () => {
  // The direction of the failure, asserted on the source: nothing may quietly
  // choose the local driver when SUPABASE_* is half-set.
  assert.match(
    STORAGE_SRC,
    /partiallyConfigured[\s\S]{0,600}storageUnavailableReason/,
    'storage.ts must derive an unavailable-reason from a partial configuration',
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
