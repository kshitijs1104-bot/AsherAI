import test from 'node:test';
import assert from 'node:assert/strict';

// The db package throws at import time without a connection string. Nothing
// here opens a connection (node-postgres Pools connect lazily and every
// function under test is pure), so a placeholder is enough to load the module.
process.env.DATABASE_URL ??= 'postgres://placeholder:placeholder@localhost:5432/placeholder';

const { looksLikeRecallQuestion, rankChatMemories, extractiveSynopsis, formatChatMemory } = await import('./chatMemory.ts');

// Run with:  npx tsx --test src/lib/chatMemory.test.mjs   (from artifacts/api-server)
//
// THE FAILURE THESE TESTS PIN DOWN. A founder worked out over one chat that
// Aurelian should approach IITB's VLabs, was given the address and a drafted
// outreach mail, opened a new chat, asked what they had discussed, and was
// told "I don't have a record of our previous conversation about an IIT."
// Every word of that chat was in the database; nothing ever read it across
// chats, and lexical retrieval could not have found it anyway — a question
// about a conversation shares no vocabulary with the conversation.
//
// So the negative controls matter as much as the positives here. Detecting
// recall too eagerly spends a few hundred tokens on summaries the model
// ignores; missing it puts Vera back to denying conversations it had.

const LIVE_FAILURE = 'what did we talk abt on our last chat abt some IIT i dont remember if u cld remind me';

test('the live failure message is recognised as a recall question', () => {
  assert.equal(looksLikeRecallQuestion(LIVE_FAILURE), true);
});

test('the ordinary ways founders reach for a past conversation', () => {
  const recalls = [
    'what did we discuss yesterday',
    'remind me what you said about the lab outreach',
    'do you remember the email you drafted for me',
    'in our last chat we picked a lab, which one was it',
    'did we ever talk about pricing for the ML module',
    'what did you recommend last time',
    'who did you say i should contact at IITB',
    'we discussed this before, what was the conclusion',
    'u told me to reach out to someone, who was it',
    'what was that previous conversation about',
    'which option did we decide on earlier',
    'go back to our first chat, what was the plan',
  ];
  for (const message of recalls) {
    assert.equal(looksLikeRecallQuestion(message), true, `should read as recall: "${message}"`);
  }
});

test('ordinary business questions are not recall questions', () => {
  // Every one of these must stay on the normal topical path — pulling other
  // chats into these costs budget the answer itself needs.
  const notRecalls = [
    'should we raise a seed round now',
    'what is our biggest risk over the next six months',
    'draft a cold email to a lab manager at IITB',
    'why is our churn climbing',
    'what does CAC mean',
    'i am the founder of a B2B SaaS company selling to clinics',
    'compare the webdev module against the ML module for IITB',
    'give me three ways to price this',
    'hi',
    'what can you help me with',
  ];
  for (const message of notRecalls) {
    assert.equal(looksLikeRecallQuestion(message), false, `should NOT read as recall: "${message}"`);
  }
});

/* ---- Ranking ---------------------------------------------------------- */

const day = (n) => new Date(Date.UTC(2026, 7, n));

const AURELIAN = {
  id: 1,
  chatId: 11,
  userId: 'u1',
  title: 'at aurelian, everything ha...',
  summary:
    'Founder is building Aurelian Academy. Vera recommended approaching IIT and IIIT tech labs, identified VLabs at IITB (support@vlabs.co.in) as the strongest fit for the ML module, and drafted an outreach email to the lab manager.',
  topics: 'aurelian iitb vlabs outreach lab manager email ml module',
  messageCount: 24,
  lastMessageId: 240,
  source: 'model',
  updatedAt: day(16),
  createdAt: day(16),
};

const PRICING = {
  ...AURELIAN,
  id: 2,
  chatId: 12,
  title: 'I am founder of a B2B Saa...',
  summary: 'Founder set seat pricing at $49/seat/month after Vera compared it against two benchmarks.',
  topics: 'pricing seat benchmark saas clinics',
  messageCount: 8,
  updatedAt: day(10),
  createdAt: day(10),
};

const HIRING = {
  ...AURELIAN,
  id: 3,
  chatId: 13,
  title: 'hiring a second engineer',
  summary: 'Vera advised holding the second engineering hire until the pilot converts.',
  topics: 'hiring engineer pilot runway',
  messageCount: 6,
  updatedAt: day(4),
  createdAt: day(4),
};

test('a recall question retrieves the recent chat despite zero topical overlap', () => {
  // THE CORE OF THE BUG. Scored on shared words, LIVE_FAILURE overlaps the
  // Aurelian chat on almost nothing — "iit" at best — because the founder is
  // asking ABOUT the conversation, not about its subject. Ranked by overlap it
  // is dropped and Vera denies the conversation happened.
  const ranked = rankChatMemories([PRICING, HIRING, AURELIAN], LIVE_FAILURE, true);
  assert.ok(ranked.length > 0, 'a recall question must never come back empty when chats exist');
  assert.equal(ranked[0].chatId, AURELIAN.chatId, 'most recent conversation comes first');
});

test('a recall question with no overlap at all still returns chats, most recent first', () => {
  const ranked = rankChatMemories([HIRING, PRICING, AURELIAN], 'remind me what we talked about', true);
  assert.deepEqual(
    ranked.map((r) => r.chatId),
    [AURELIAN.chatId, PRICING.chatId, HIRING.chatId],
  );
});

test('an ordinary question pulls in only chats that share real subject matter', () => {
  const ranked = rankChatMemories([PRICING, HIRING, AURELIAN], 'should we send the vlabs outreach email now', false);
  assert.deepEqual(ranked.map((r) => r.chatId), [AURELIAN.chatId]);
});

test('an ordinary question about an unrelated subject pulls in nothing', () => {
  // One coincidental shared word must not be enough — this is the same floor
  // messageLog.ts applies to in-chat history, for the same reason.
  const ranked = rankChatMemories([PRICING, HIRING, AURELIAN], 'what is a SAFE note', false);
  assert.deepEqual(ranked, []);
});

test('a short follow-up naming the subject still finds the right chat', () => {
  // The founder's second message in the live transcript, after Vera had
  // already denied the first. It is four words and names nothing but the lab.
  const ranked = rankChatMemories([PRICING, HIRING, AURELIAN], 'IITB lab or something', false);
  assert.deepEqual(ranked.map((r) => r.chatId), [AURELIAN.chatId]);
});

/* ---- Rendering -------------------------------------------------------- */

test('the block names each chat and stays inside its character budget', () => {
  const block = formatChatMemory([AURELIAN, PRICING, HIRING], 1800);
  assert.match(block, /OTHER CONVERSATIONS WITH THIS FOUNDER/);
  assert.match(block, /support@vlabs\.co\.in/, 'contact details must survive into the prompt verbatim');
  assert.match(block, /at aurelian/);
  assert.ok(block.length <= 1800 + 200, `block was ${block.length} chars`);
});

test('a tight budget keeps the first chat rather than returning nothing', () => {
  const block = formatChatMemory([AURELIAN, PRICING, HIRING], 50);
  assert.match(block, /at aurelian/);
  assert.equal(block.includes('hiring a second engineer'), false);
});

test('an unsummarised chat is labelled as excerpts, not presented as an account', () => {
  const block = formatChatMemory([{ ...AURELIAN, source: 'extractive' }], 1800);
  assert.match(block, /not yet condensed/);
});

test('the extractive stub keeps the opening ask and the last answer', () => {
  const synopsis = extractiveSynopsis([
    { role: 'user', content: 'at aurelian, everything has to go through one person and it is slowing us down' },
    { role: 'assistant', content: 'That is a coordination bottleneck, not a headcount one.' },
    { role: 'user', content: 'which lab should we approach in bombay' },
    { role: 'assistant', content: 'VLabs at IITB — support@vlabs.co.in is the outreach address.' },
  ]);
  assert.match(synopsis, /at aurelian/);
  assert.match(synopsis, /support@vlabs\.co\.in/);
});

test('the extractive stub survives a chat with only one message', () => {
  const synopsis = extractiveSynopsis([{ role: 'user', content: 'hi' }]);
  assert.match(synopsis, /hi/);
  assert.equal(extractiveSynopsis([]), '');
});
