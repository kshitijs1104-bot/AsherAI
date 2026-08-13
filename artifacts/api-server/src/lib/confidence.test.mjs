import test from 'node:test';
import assert from 'node:assert/strict';
import { computeConfidence } from './confidence.ts';

// Run with:  npx tsx --test src/lib/confidence.test.mjs   (from artifacts/api-server)

function retrieval({ tier = 'none', confidence = 0, precedents = [] } = {}) {
  return { matched: precedents.length > 0, tier, confidence, inferredSector: null, precedents, sectorCoverageCount: 0 };
}

function strongPrecedent(id, { status = 'acquired', verificationStatus = 'auto-extracted-unverified', questionOverlap = 1, score = 0.5 } = {}) {
  return {
    precedent: { id, companyName: `Company ${id}`, status, verificationStatus },
    score,
    questionOverlap,
  };
}

function ownDecision(id, { score = 0.2, outcomeSentiment = 'positive' } = {}) {
  return { decision: { id, query: `q${id}`, recommendationSummary: '', outcome: 'it worked', lesson: null, outcomeSentiment, resolvedAt: new Date() }, score };
}

test('no evidence at all stays exploratory with no groundedIn', () => {
  const result = computeConfidence(retrieval(), []);
  assert.equal(result.tier, 'exploratory');
  assert.equal(result.groundedIn, null);
});

test('a strong, citable precedent match still earns verified/precedent (regression check)', () => {
  const result = computeConfidence(
    retrieval({ tier: 'strong', confidence: 0.5, precedents: [strongPrecedent(1), strongPrecedent(2)] }),
    [],
  );
  assert.equal(result.tier, 'verified');
  assert.equal(result.groundedIn, 'precedent');
});

test('two strong, reported own-history matches earn verified/own_history with zero precedent coverage', () => {
  const result = computeConfidence(
    retrieval({ tier: 'none', confidence: 0 }),
    [ownDecision(1, { score: 0.2 }), ownDecision(2, { score: 0.3 })],
  );
  assert.equal(result.tier, 'verified');
  assert.equal(result.groundedIn, 'own_history');
});

test('a single own-history match is not enough on its own', () => {
  const result = computeConfidence(retrieval(), [ownDecision(1, { score: 0.3 })]);
  assert.equal(result.tier, 'exploratory');
  assert.equal(result.groundedIn, null);
});

test('resolved decisions with no reported sentiment do not count toward own-history verification', () => {
  const result = computeConfidence(
    retrieval(),
    [ownDecision(1, { score: 0.3, outcomeSentiment: null }), ownDecision(2, { score: 0.3, outcomeSentiment: null })],
  );
  assert.equal(result.tier, 'exploratory');
  assert.equal(result.groundedIn, null);
});

test('a weak precedent match does not block own-history from carrying the tier', () => {
  const result = computeConfidence(
    retrieval({ tier: 'moderate', confidence: 0.1, precedents: [strongPrecedent(1, { questionOverlap: 0 })] }),
    [ownDecision(1, { score: 0.25 }), ownDecision(2, { score: 0.25 })],
  );
  assert.equal(result.tier, 'verified');
  assert.equal(result.groundedIn, 'own_history');
});
