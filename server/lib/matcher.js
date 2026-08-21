// lib/matcher.js
// Deterministic cosine-similarity palm matcher.
//
// This is the AUTHORITATIVE identity decision-maker. The LLM (Groq) is called
// AFTER this step only to produce a human-readable explanation of the decision.
// The accept/reject outcome is fixed here, independent of any LLM response.

import 'dotenv/config';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Cosine similarity thresholds on the raw 0-1 scale.
// The frontend used a stretched 0-100 scale (MATCH_THRESHOLD=55, MARGIN=8).
// Here we operate directly on the L2-normalised embedding cosine (0-1).
export const MATCH_THRESHOLD = parseFloat(process.env.MATCH_THRESHOLD ?? '0.72');
export const MARGIN_THRESHOLD = parseFloat(process.env.MARGIN_THRESHOLD ?? '0.06');

/**
 * Cosine similarity between two L2-normalised Float32Arrays.
 * Because both vectors are already unit-length, this is just the dot product.
 * @param {Float32Array|number[]} a
 * @param {Float32Array|number[]} b
 * @returns {number} value in [-1, 1], higher = more similar
 */
export function cosine(a, b) {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Rank all enrolled users by cosine similarity to the live embedding.
 * @param {Float32Array|number[]} liveEmbedding
 * @param {Array<{id, name, embedding: string, ...}>} users  — raw DB rows
 * @returns {Array<{user, score: number}>}  sorted best→worst
 */
export function rankAll(liveEmbedding, users) {
  return users
    .map(user => {
      const storedEmbedding = JSON.parse(user.embedding); // JSON array stored in DB
      const score = cosine(liveEmbedding, storedEmbedding);
      return { user, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Decide whether to accept identity from the ranked list.
 * Two-condition guard:
 *   1. Top score must meet MATCH_THRESHOLD.
 *   2. If there are other enrolled users, the top match must be distinct
 *      from the closest other user by at least MARGIN_THRESHOLD.
 *
 * @param {Array<{user, score}>} ranked
 * @returns {{ accepted: boolean, top: {user, score}, margin: number, reason?: string }}
 */
export function decide(ranked, expectedUserId = null) {
  if (!ranked.length) {
    return { accepted: false, top: null, margin: 0, reason: 'No enrolled users to match against.' };
  }

  // Pure deterministic biometric ranking based on actual similarity
  const top = ranked[0];
  const second = ranked[1] ?? null;
  const margin = second ? (top.score - second.score) : 1.0;

  // Convert scores to human readable percentages
  const topPct = (top.score * 100).toFixed(1);
  const threshPct = (MATCH_THRESHOLD * 100).toFixed(0);

  // 1. Biometric threshold check
  if (top.score < MATCH_THRESHOLD) {
    return {
      accepted: false,
      top,
      margin,
      reason: `Palm pattern mismatch: closest match "${top.user.name}" scored ${topPct}%, which is below the minimum verification threshold (${threshPct}%).`,
    };
  }

  // 2. Distinctiveness check when multiple people are registered
  if (second && margin < MARGIN_THRESHOLD) {
    const secondPct = (second.score * 100).toFixed(1);
    return {
      accepted: false,
      top,
      margin,
      reason: `Ambiguous biometric match: highest match is "${top.user.name}" (${topPct}%) but too close to "${second.user.name}" (${secondPct}%). Margin ${(margin * 100).toFixed(1)}% < ${(MARGIN_THRESHOLD * 100).toFixed(1)}%. Please rescan steadily.`,
    };
  }

  return { accepted: true, top, margin: Math.max(0.01, margin) };
}
