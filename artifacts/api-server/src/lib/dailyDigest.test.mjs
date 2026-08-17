import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run with:  node node_modules/tsx/dist/cli.mjs src/lib/dailyDigest.test.mjs
//
/* ---------------------------------------------------------------------------
   The daily brief is the one feature here that INTERRUPTS a founder — it puts
   an item on their board and sends mail. So the rules that keep it from
   becoming the thing they mute are the rules worth testing, and both are the
   kind that a future edit breaks silently.

   This codebase has already made the mistake once: the queue used to be seeded
   with three fabricated rows (a drafted reply to a customer who did not exist,
   a revenue reading off a sheet nobody had connected), and they were deleted
   because a founder's first impression was fiction they had to clear by hand.
   A daily notification is the same trap with a schedule attached.
--------------------------------------------------------------------------- */

const SRC = fs.readFileSync(path.resolve('src/lib/dailyDigest.ts'), 'utf8');
const JOB = fs.readFileSync(path.resolve('src/jobs/dailyJob.ts'), 'utf8');

test('a quiet day produces nothing at all', () => {
  // hasSignal gates BOTH the board item and the email. If either ever stops
  // checking it, Vera starts nudging people about nothing, every morning.
  assert.match(
    SRC,
    /if \(!digest\.hasSignal\) return false;/,
    'ensureDailyBriefItem must refuse to create an item when there is no signal',
  );
  assert.match(
    JOB,
    /if \(!digest\.hasSignal\) continue;/,
    'the job must skip a founder entirely when their digest has no signal',
  );
});

test('the email only ever goes out alongside a newly created item', () => {
  // This is what makes a re-run safe. If the email were sent independently of
  // whether the item was created, running the job twice — or a retry after a
  // partial failure — would mail the same founder twice about the same day.
  const briefBlock = JOB.slice(JOB.indexOf('const digest = await buildDailyDigest'), JOB.indexOf('page.data.length < PAGE'));
  const createdIndex = briefBlock.indexOf('if (!created) continue;');
  const emailIndex = briefBlock.indexOf('sendDigestEmail');
  assert.ok(createdIndex > -1, 'the job must bail when no item was created');
  assert.ok(emailIndex > createdIndex, 'sendDigestEmail must come AFTER the not-created bail-out');
});

test('one brief per UTC day, enforced by the database not by bookkeeping', () => {
  // The unique index on (userId, source, externalId) already exists on
  // queue_items. Keying externalId on the date means a second insert on the
  // same day is a no-op at the database level — which is a much stronger
  // guarantee than this code remembering to check first, and it is what makes
  // the job safe to re-run after a crash.
  assert.match(SRC, /brief:\$\{utcDay\(now\)\}/, 'the brief item must be keyed on the UTC date');
  assert.match(
    SRC,
    /onConflictDoNothing\(\{[\s\S]{0,160}queueItemsTable\.externalId/,
    'the insert must rely on the dedupe index rather than a pre-check',
  );
});

test('every figure in a digest is counted, never estimated', () => {
  // No invented numbers. Each field comes from a count() over real rows; the
  // moment one is derived from an average or a guess, the digest starts making
  // claims about a business that nothing backs.
  const builder = SRC.slice(SRC.indexOf('export async function buildDailyDigest'), SRC.indexOf('function writeLines'));
  assert.ok(builder.length > 200, 'could not isolate buildDailyDigest — renamed?');
  const counts = builder.match(/count\(\)/g) ?? [];
  assert.ok(counts.length >= 5, `expected every figure to come from a count(), found ${counts.length}`);
  assert.doesNotMatch(builder, /Math\.random|estimate|assume/i, 'a digest figure must never be estimated');
});

test('the unread dot is not cleared by merely fetching the board', () => {
  // TanStack Query refetches on window focus. If GET /queue marked items seen,
  // alt-tabbing back to a tab parked on another page would silently clear the
  // dot for items that were never on screen — and a dot that clears itself is
  // one nobody trusts.
  const routeSrc = fs.readFileSync(path.resolve('src/routes/queue.ts'), 'utf8');
  const getHandler = routeSrc.slice(routeSrc.indexOf('router.get("/queue"'), routeSrc.indexOf('const ActionBody'));
  assert.ok(getHandler.length > 100, 'could not isolate the GET /queue handler');
  assert.doesNotMatch(getHandler, /markQueueSeen/, 'GET /queue must not mark items seen as a side effect');
  assert.match(routeSrc, /router\.post\("\/queue\/seen"/, 'clearing the dot needs its own deliberate endpoint');
});

test('email is optional and its absence degrades to board-only', () => {
  // Vera sends no other email (Clerk handles auth mail), so an unset provider
  // must not break the feature or the job — the in-app item is the part that
  // always works.
  assert.match(SRC, /export function emailConfigured\(\)/, 'callers need to be able to ask before sending');
  assert.match(
    SRC,
    /if \(!emailConfigured\(\)\) return false;/,
    'sendDigestEmail must no-op rather than throw when unconfigured',
  );
});

test('digest text is escaped before going into an HTML email', () => {
  // Counted numbers are safe today, but the day someone puts a chat title or a
  // sender name into a headline, an unescaped template becomes an injection
  // into every inbox it reaches.
  assert.match(SRC, /function escapeHtml/, 'the HTML email must escape interpolated values');
  const htmlBlock = SRC.slice(SRC.indexOf('const html ='), SRC.indexOf('try {'));
  const interpolations = htmlBlock.match(/\$\{(?!escapeHtml)[^}]+\}/g) ?? [];
  assert.deepEqual(interpolations, [], `every value in the HTML body must go through escapeHtml, found raw: ${interpolations.join(', ')}`);
});
