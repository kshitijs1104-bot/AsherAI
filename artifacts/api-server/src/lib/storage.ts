import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

/* ---------------------------------------------------------------------------
   WHERE FOUNDERS' UPLOADED FILES ACTUALLY LIVE

   THE FAILURE THIS FIXES. Uploads were written to a directory inside the
   api-server's own container with multer's diskStorage, and read back with
   res.sendFile. The deployment target is Replit autoscale. Those two facts do
   not survive contact with each other:

     * The container is replaced on every redeploy and after scaling to zero.
       The `attachments` ROW survives in Postgres, so the founder still sees
       their P&L listed in the UI — and gets "File no longer available" when
       they open it. Silent data loss in the one feature carrying the most
       sensitive content anyone gives Vera.
     * With more than one instance, a file written by instance A is simply not
       present on instance B. The same document opens or fails depending on
       which instance answers, which reads as an intermittent bug rather than a
       missing file.

   The old code's comment said the directory sits outside dist/ "so redeploys
   don't silently delete every founder's uploaded files". That reasoning is
   correct for a persistent filesystem and this is not one.

   THE SHAPE. Two drivers behind one interface, chosen by environment:

     local     — the api-server's own disk. Still the default, still what runs
                 in development, and still correct for a single persistent
                 machine. Unchanged behaviour.
     supabase  — Supabase Storage, over its plain REST API.

   WHY SUPABASE AND WHY NO SDK. Supabase Storage is S3-backed object storage
   with a simple authenticated HTTP API, and the project is already going to
   want Supabase for Postgres (it is ordinary Postgres, so DATABASE_URL is a
   straight swap, and it brings automated backups — which is the other blocker
   this codebase could not close from code). Using fetch against three
   endpoints instead of adding @supabase/supabase-js keeps the dependency count
   flat, keeps the esbuild bundle small, and avoids the workspace's one-day
   minimum-release-age rule on new packages. If the bucket is ever moved to
   R2 or S3 proper, this file is the only thing that changes.

   THE COLUMN THAT MAKES THE SWITCH SAFE. attachments.storageDriver records
   which store wrote each row. Rows created before the switch say "local" and
   keep being read from disk; rows created after say "supabase". Without that
   column, turning the driver on would orphan every existing attachment,
   because a storage key alone cannot tell you which system it belongs to.

   FAIL-CLOSED CONFIG. Supabase is used only when ALL THREE of its variables
   are present. A half-configured deployment silently falling back to a disk
   that gets discarded is exactly the failure this file exists to remove, so a
   partially-set configuration disables attachments outright — see the second
   block below for why it disables the FEATURE and no longer the whole server.
--------------------------------------------------------------------------- */

export type StorageDriver = "local" | "supabase";

export const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

// Where multer streams the incoming file before it is handed to a driver.
// Always local, always transient: keeping the upload streaming to disk rather
// than into memory is what bounds memory at 10MB × concurrent uploads instead
// of letting a burst of large files exhaust the heap.
export const UPLOAD_TMP_DIR = path.resolve(process.cwd(), "uploads", ".incoming");

const SUPABASE_URL = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() ?? "";

const supabaseParts = [
  ["SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY],
  ["SUPABASE_STORAGE_BUCKET", SUPABASE_BUCKET],
] as const;

const supabaseSet = supabaseParts.filter(([, v]) => v.length > 0);

const partiallyConfigured = supabaseSet.length > 0 && supabaseSet.length < supabaseParts.length;

/* ---------------------------------------------------------------------------
   A HALF-CONFIGURED BUCKET DISABLES ATTACHMENTS. IT NO LONGER DISABLES VERA.

   THE FAILURE THIS FIXES, and it is the expensive one. The three lines above
   used to end in a bare `throw` at module scope. storage.ts is imported by
   routes/attachments.ts, which is imported by the route index, which is
   imported by app.ts — so the throw happened during module evaluation, before
   the logger was attached to anything and before the port was bound. The whole
   API refused to boot. Every route, not just uploads: sign-in, /access/me, the
   operator surface, chat. One mistyped Secret out of three and the product was
   down with a stack trace that named a storage file, which reads as "Supabase
   is broken" rather than "one of these three values is missing".

   The reasoning for failing closed was right and is kept: the alternative it
   was written against — silently falling back to a local disk that Replit
   discards on every redeploy — loses founders' uploaded documents while still
   showing them in the UI. That must not happen.

   What was wrong was the BLAST RADIUS, not the direction. Attachments are one
   feature. Taking the entire product offline to protect it is not a safer
   choice than turning that feature off, it is a louder version of the same
   outage. So a partial configuration now:

     - refuses to serve attachments, loudly, with the missing variable named;
     - never writes to the ephemeral disk, so the data-loss guarantee holds;
     - leaves every other route working.

   Reads of EXISTING attachments are refused too, deliberately. Half a config
   usually means the wrong project or a rotated key, and answering a read with
   "not found" from the local disk when the file is really in a bucket this
   process cannot reach is how a configuration mistake gets mistaken for data
   loss and acted on.
--------------------------------------------------------------------------- */

/** Non-null when storage is misconfigured; the sentence an operator needs. */
export const storageUnavailableReason: string | null = partiallyConfigured
  ? "Supabase Storage is partially configured — set all three or none of: " +
    supabaseParts.map(([k]) => k).join(", ") +
    ". Missing: " +
    supabaseParts.filter(([, v]) => !v).map(([k]) => k).join(", ") +
    ". Attachments are disabled until this is fixed; nothing is being written to the local disk, because on this host that disk is discarded on every redeploy."
  : null;

if (storageUnavailableReason) {
  logger.error({ missing: supabaseParts.filter(([, v]) => !v).map(([k]) => k) }, storageUnavailableReason);
}

/** Throws the operator-readable reason if storage is not usable at all. */
export function assertStorageAvailable(): void {
  if (storageUnavailableReason) throw new Error(storageUnavailableReason);
}

/** The driver NEW uploads are written with. Existing rows carry their own. */
export const activeDriver: StorageDriver = supabaseSet.length === supabaseParts.length ? "supabase" : "local";

if (storageUnavailableReason) {
  // Deliberately says nothing about a driver. `activeDriver` still computes to
  // "local" in this state — it has no third value — and announcing "using the
  // LOCAL disk driver" right under the error would contradict it, telling an
  // operator that uploads are landing on disk when they are being refused.
  logger.warn("Attachment uploads and downloads are DISABLED until the storage configuration above is fixed. Everything else is running normally.");
} else if (activeDriver === "local") {
  logger.warn(
    "Attachment storage is using the LOCAL disk driver. On an ephemeral or autoscaled host, uploaded files are lost on every redeploy and are invisible to other instances. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET to use object storage.",
  );
} else {
  logger.info({ bucket: SUPABASE_BUCKET }, "Attachment storage is using Supabase object storage");
}

/* -------------------------------------------------------------------------
 * local driver
 * ---------------------------------------------------------------------- */

// storagePath is always a server-generated random filename (see the schema
// comment on that column), so this cannot be steered by user input. Verified
// anyway rather than trusting that invariant to survive every future change
// to the upload handler — the check is what makes it an invariant.
function localPathFor(key: string): string {
  const full = path.resolve(path.join(UPLOADS_DIR, key));
  if (!full.startsWith(UPLOADS_DIR + path.sep) && full !== UPLOADS_DIR) {
    throw new Error("Refusing to resolve a storage key outside the uploads directory");
  }
  return full;
}

/* -------------------------------------------------------------------------
 * supabase driver
 * ---------------------------------------------------------------------- */

const SUPABASE_TIMEOUT_MS = 20_000;

function supabaseObjectUrl(key: string): string {
  // Each segment encoded separately so a key containing a slash stays a path
  // and never collapses into one escaped component.
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encoded}`;
}

async function supabaseFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        // BOTH headers, not just Authorization. Supabase's gateway (Kong) sits
        // in front of the Storage API and identifies the calling project from
        // `apikey` independently of who the caller is authenticated as; the
        // official supabase-js client always sends both for exactly this
        // reason, and going through only one is an easy way to get a 401 that
        // has nothing to do with the credential being wrong.
        //
        // Works with both of Supabase's key formats. The legacy JWT
        // `service_role` key and the newer opaque `sb_secret_...` key are
        // both privileged, server-only, bypass-RLS credentials — Supabase's
        // own docs describe the new "Secret key" as the direct replacement
        // for `service_role`, used the same way. Whichever one is in
        // SUPABASE_SERVICE_ROLE_KEY, it goes in both headers unchanged.
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// The response body is never returned to the caller: Supabase's error bodies
// carry request ids and bucket internals, and every caller of this module
// turns a failure into a fixed founder-facing sentence anyway.
async function assertOk(res: Response, action: string, key: string): Promise<void> {
  if (res.ok) return;
  const detail = await res.text().catch(() => "");
  logger.error({ action, key, status: res.status, detail: detail.slice(0, 300) }, "Supabase Storage request failed");
  throw new Error(`Storage ${action} failed with status ${res.status}`);
}

/* -------------------------------------------------------------------------
 * public interface
 * ---------------------------------------------------------------------- */

/**
 * Moves a freshly-uploaded temp file into durable storage under `key`.
 * The temp file is always consumed — renamed on the local driver, uploaded
 * then unlinked on Supabase — so a failure never leaves the incoming
 * directory growing.
 */
export async function putFromTempFile(key: string, tempPath: string, contentType: string): Promise<StorageDriver> {
  assertStorageAvailable();
  if (activeDriver === "local") {
    const dest = localPathFor(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(tempPath, dest);
    return "local";
  }

  try {
    const body = await fsp.readFile(tempPath);
    const res = await supabaseFetch(supabaseObjectUrl(key), {
      method: "POST",
      headers: { "Content-Type": contentType, "x-upsert": "true" },
      body: new Uint8Array(body),
    });
    await assertOk(res, "upload", key);
    return "supabase";
  } finally {
    // Best-effort: the durable copy is what matters, and a leftover temp file
    // is swept by the next deploy rather than being worth failing an upload.
    await fsp.unlink(tempPath).catch(() => {});
  }
}

/** Reads an object written by `driver`. Throws if it is not there. */
export async function getObject(key: string, driver: StorageDriver): Promise<Buffer> {
  assertStorageAvailable();
  if (driver === "local") return fsp.readFile(localPathFor(key));

  const res = await supabaseFetch(supabaseObjectUrl(key), { method: "GET" });
  await assertOk(res, "download", key);
  return Buffer.from(await res.arrayBuffer());
}

/** Small text objects (the extraction sidecar). Null when absent or unreadable. */
export async function getText(key: string, driver: StorageDriver): Promise<string | null> {
  try {
    return (await getObject(key, driver)).toString("utf8");
  } catch {
    return null;
  }
}

export async function putText(key: string, driver: StorageDriver, body: string): Promise<void> {
  assertStorageAvailable();
  if (driver === "local") {
    const dest = localPathFor(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, body, "utf8");
    return;
  }
  const res = await supabaseFetch(supabaseObjectUrl(key), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upsert": "true" },
    body,
  });
  await assertOk(res, "upload", key);
}

/**
 * Removes an object. Never throws: this is called from the deletion cascade,
 * where one missing file must not abort the removal of everything else the
 * founder asked to have deleted. Returns whether something was actually gone.
 */
export async function deleteObject(key: string, driver: StorageDriver): Promise<boolean> {
  assertStorageAvailable();
  try {
    if (driver === "local") {
      await fsp.unlink(localPathFor(key));
      return true;
    }
    const res = await supabaseFetch(supabaseObjectUrl(key), { method: "DELETE" });
    // 404 means it is already gone, which is the desired end state.
    if (res.status === 404) return false;
    await assertOk(res, "delete", key);
    return true;
  } catch (err) {
    logger.warn({ err, key, driver }, "Could not delete a stored object during cascade");
    return false;
  }
}

/**
 * Liveness of the storage backend, for the readiness probe. Local is always
 * ready; Supabase is checked with a HEAD against the bucket so a revoked key
 * or a deleted bucket is visible before a founder discovers it by uploading.
 */
export async function storageHealthy(): Promise<boolean> {
  if (storageUnavailableReason) return false;
  if (activeDriver === "local") {
    try {
      await fsp.access(UPLOADS_DIR, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const res = await supabaseFetch(`${SUPABASE_URL}/storage/v1/bucket/${encodeURIComponent(SUPABASE_BUCKET)}`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export function ensureLocalDirs(): void {
  if (storageUnavailableReason) return;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
}
