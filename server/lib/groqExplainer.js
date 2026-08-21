// lib/groqExplainer.js
// Groq LLM explanation layer.
//
// IMPORTANT DESIGN NOTE: Groq's output here is EXPLANATORY ONLY.
// The accept/reject decision is already final (made deterministically by
// matcher.js) BEFORE this function is called. This call cannot change the
// outcome — it only generates the natural-language explanation that
// accompanies the decision in the UI for judges / demo viewers.
//
// The payment debit also happens BEFORE this call. If Groq is unreachable
// (network down at the venue), a hardcoded fallback string is used and the
// transaction still completes normally.

import Groq from 'groq-sdk';
import 'dotenv/config';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
// Model ID is a config value — swap in .env without touching code
const GROQ_MODEL = process.env.GROQ_VISION_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_TIMEOUT_MS = 5000; // 5 s — the demo cannot afford to hang on this

const FALLBACK_EXPLANATION = 'Match confirmed by palm-embedding comparison. Groq explanation service unavailable.';

let groqClient = null;

function getClient() {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'your_groq_api_key_here') return null;
  if (!groqClient) {
    groqClient = new Groq({ apiKey: GROQ_API_KEY });
  }
  return groqClient;
}

/**
 * Ask Groq to explain the biometric match decision in 1-2 sentences.
 *
 * @param {object} opts
 * @param {string}  opts.thumbnailBase64   — cropped palm image as base64 data-URL
 * @param {string}  opts.matchedName       — name of the matched user
 * @param {number}  opts.topScore          — cosine similarity of the winning match (0-1)
 * @param {number}  opts.secondScore       — cosine similarity of the runner-up (0-1), or null
 * @param {number}  opts.margin            — gap between top and second
 * @param {boolean} opts.accepted          — final deterministic decision (already executed)
 * @param {string}  [opts.rejectReason]    — if not accepted, why
 *
 * @returns {Promise<string>} 1-2 sentence human-readable explanation
 */
export async function explainDecision({
  thumbnailBase64,
  matchedName,
  topScore,
  secondScore,
  margin,
  accepted,
  rejectReason,
}) {
  const client = getClient();
  if (!client) {
    // No API key configured — return fallback immediately, don't hang
    return FALLBACK_EXPLANATION;
  }

  const systemPrompt = `You are a biometric payment system's explanation engine. 
Your job is to produce a concise, professional explanation of a palm-vein matching result for display to a merchant or judge.
IMPORTANT: The match decision has already been made deterministically by an embedding comparison algorithm. 
You are NOT deciding whether to accept or reject — you are ONLY explaining what the algorithm found.
Keep your response to 1-2 sentences maximum. Be specific about match scores. Do not hedge excessively.`;

  const userContent = accepted
    ? `The palm-embedding matcher ACCEPTED this payment. 
Match details: primary match is "${matchedName}" with a cosine similarity score of ${(topScore * 100).toFixed(1)}%.
The runner-up score was ${secondScore !== null ? (secondScore * 100).toFixed(1) + '%' : 'N/A (only one enrolled palm)'} — a margin of ${(margin * 100).toFixed(1)}%.
Briefly explain why this is a confident match, referencing the scores and margin.`
    : `The palm-embedding matcher REJECTED this payment attempt.
Reason: ${rejectReason}
Best candidate score: ${(topScore * 100).toFixed(1)}%.
Briefly explain why the match was insufficient, in plain terms a non-technical person can understand.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    const response = await client.chat.completions.create(
      {
        model: GROQ_MODEL,
        messages,
        max_tokens: 100, // 1-2 sentences is all we need — cheap + fast
        temperature: 0.3, // low temp = consistent, professional tone
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);
    return response.choices?.[0]?.message?.content?.trim() ?? FALLBACK_EXPLANATION;
  } catch (err) {
    // Network issue, timeout, or API error — log it but never crash the payment
    console.warn('[groqExplainer] Groq call failed (fallback used):', err?.message ?? err);
    return FALLBACK_EXPLANATION;
  }
}
