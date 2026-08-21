// routes/pay.js
// POST /api/pay
//
// Accepts: multipart/form-data
//   Fields: amount (number), mode ('bank'|'wallet')
//   Files:  frames[] — 5-7 JPEG blobs (live palm burst from browser)
//
// Pipeline (order matters — do not reorder):
//   1.  Validate inputs
//   2.  embedBurst(liveFrames) → live template
//   3.  rankAll(live, allUsers) → sorted similarity list [DETERMINISTIC]
//   4.  decide(ranked) → accept/reject  [DETERMINISTIC — AUTHORITATIVE DECISION]
//   5.  fraudCheck(user, amount, mode)  [DETERMINISTIC]
//   6.  Debit balance in DB             [SIDE EFFECT — money moves here]
//   7.  Call Groq for explanation       [EXPLANATORY ONLY — cannot change outcome]
//   8.  Log transaction to DB
//   9.  Return response to frontend

import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { embedBurst } from '../lib/embedder.js';
import { rankAll, decide } from '../lib/matcher.js';
import { fraudCheck } from '../lib/fraudCheck.js';
import { explainDecision } from '../lib/groqExplainer.js';
import { getAllUsers, getUserById, updateBalance, insertTransaction } from '../db/schema.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post('/', upload.array('frames', 10), async (req, res) => {
  try {
    // ── 1. Validate inputs ────────────────────────────────────────────────
    const amount = parseFloat(req.body.amount);
    const payMode = req.body.mode;

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ accepted: false, reason: 'Amount must be a positive number.' });
    }
    if (!['bank', 'wallet'].includes(payMode)) {
      return res.status(400).json({ accepted: false, reason: 'mode must be "bank" or "wallet".' });
    }
    if (!req.files || req.files.length < 1) {
      return res.status(400).json({ accepted: false, reason: 'At least 1 palm frame is required.' });
    }

    const enrolledUsers = getAllUsers();
    if (!enrolledUsers.length) {
      return res.status(400).json({ accepted: false, reason: 'No users registered. Register a palm first.' });
    }

    // ── 2. Embed live burst ───────────────────────────────────────────────
    const frameBuffers = req.files.map(f => f.buffer);
    const liveEmbedding = await embedBurst(frameBuffers);

    // Save first frame as thumbnail for Groq vision
    const liveThumbnailBase64 = `data:image/jpeg;base64,${frameBuffers[0].toString('base64')}`;

    const expectedUserId = req.body.expectedUserId || null;

    // ── 3. Rank all enrolled users ────────────────────────────────────────
    const ranked = rankAll(liveEmbedding, enrolledUsers);
    const second = ranked[1] ?? null;

    // ── 4. Deterministic identity decision ────────────────────────────────
    const decision = decide(ranked, expectedUserId);

    if (!decision.accepted) {
      // Log rejected transaction (no debit — no money moves)
      const txId = uuidv4();
      const now = Date.now();

      // Get explanation from Groq (non-blocking, fallback if it fails)
      // GROQ IS EXPLANATORY ONLY — the rejection is already final above.
      const explanation = await explainDecision({
        thumbnailBase64: liveThumbnailBase64,
        matchedName: decision.top?.user?.name ?? 'unknown',
        topScore: decision.top?.score ?? 0,
        secondScore: second?.score ?? null,
        margin: decision.margin,
        accepted: false,
        rejectReason: decision.reason,
      });

      insertTransaction({
        id: txId,
        user_id: decision.top?.user?.id ?? 'unknown',
        user_name: decision.top?.user?.name ?? 'Unknown',
        user_thumbnail: decision.top?.user?.thumbnail ?? '',
        amount,
        mode: payMode,
        match_score: decision.top?.score ?? 0,
        margin: decision.margin,
        explanation,
        accepted: 0,
        reject_reason: decision.reason,
        created_at: now,
      });

      return res.status(200).json({
        accepted: false,
        reason: decision.reason,
        explanation,
        score: parseFloat(((decision.top?.score ?? 0) * 100).toFixed(1)),
        margin: parseFloat((decision.margin * 100).toFixed(1)),
        ranked: ranked.map(r => ({
          id: r.user.id,
          name: r.user.name,
          score: parseFloat((r.score * 100).toFixed(1)),
        })),
      });
    }

    // Identity confirmed — get the fresh user record (with current balances)
    const user = getUserById(decision.top.user.id);

    // ── 5. Fraud / behaviour check ────────────────────────────────────────
    const fraud = fraudCheck(user, amount, payMode);

    if (!fraud.clear) {
      const txId = uuidv4();
      const now = Date.now();

      const explanation = await explainDecision({
        thumbnailBase64: liveThumbnailBase64,
        matchedName: user.name,
        topScore: decision.top.score,
        secondScore: second?.score ?? null,
        margin: decision.margin,
        accepted: false,
        rejectReason: fraud.reason,
      });

      insertTransaction({
        id: txId,
        user_id: user.id,
        user_name: user.name,
        user_thumbnail: user.thumbnail,
        amount,
        mode: payMode,
        match_score: decision.top.score,
        margin: decision.margin,
        explanation,
        accepted: 0,
        reject_reason: fraud.reason,
        created_at: now,
      });

      return res.status(200).json({
        accepted: false,
        reason: fraud.reason,
        explanation,
        user: { id: user.id, name: user.name, thumbnail: user.thumbnail },
        score: parseFloat((decision.top.score * 100).toFixed(1)),
        margin: parseFloat((decision.margin * 100).toFixed(1)),
        ranked: ranked.map(r => ({
          id: r.user.id,
          name: r.user.name,
          score: parseFloat((r.score * 100).toFixed(1)),
        })),
      });
    }

    // ── 6. Debit balance ──────────────────────────────────────────────────
    // Money moves HERE — before calling Groq.
    // If Groq fails, the payment is already committed.
    const newBankBalance = payMode === 'bank'
      ? user.bank_balance - amount
      : user.bank_balance;
    const newWalletBalance = payMode === 'wallet'
      ? user.wallet_balance - amount
      : user.wallet_balance;

    updateBalance(user.id, newBankBalance, newWalletBalance);

    // ── 7. Call Groq for explanation ──────────────────────────────────────
    // GROQ OUTPUT IS EXPLANATORY ONLY. The debit is already done above.
    // This call is wrapped in the explainDecision try/catch so it can never
    // fail the payment.
    const explanation = await explainDecision({
      thumbnailBase64: liveThumbnailBase64,
      matchedName: user.name,
      topScore: decision.top.score,
      secondScore: second?.score ?? null,
      margin: decision.margin,
      accepted: true,
    });

    // ── 8. Log transaction ────────────────────────────────────────────────
    const txId = uuidv4();
    const now = Date.now();

    insertTransaction({
      id: txId,
      user_id: user.id,
      user_name: user.name,
      user_thumbnail: user.thumbnail,
      amount,
      mode: payMode,
      match_score: decision.top.score,
      margin: decision.margin,
      explanation,
      accepted: 1,
      reject_reason: null,
      created_at: now,
    });

    // ── 9. Return response ────────────────────────────────────────────────
    return res.status(200).json({
      accepted: true,
      user: {
        id: user.id,
        name: user.name,
        thumbnail: user.thumbnail,
        bankBalance: newBankBalance,
        walletBalance: newWalletBalance,
      },
      score: parseFloat((decision.top.score * 100).toFixed(1)),
      margin: parseFloat((decision.margin * 100).toFixed(1)),
      ranked: ranked.map(r => ({
        id: r.user.id,
        name: r.user.name,
        score: parseFloat((r.score * 100).toFixed(1)),
      })),
      explanation,
      transaction: {
        id: txId,
        amount,
        mode: payMode,
        createdAt: new Date(now).toISOString(),
      },
    });

  } catch (err) {
    console.error('[pay] error:', err);
    return res.status(500).json({ accepted: false, reason: 'Server error during payment', detail: err.message });
  }
});

export default router;
