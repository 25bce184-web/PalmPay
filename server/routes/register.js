// routes/register.js
// POST /api/register
//
// Accepts: multipart/form-data
//   Fields: name (string), bankBalance (number), walletBalance (number)
//   Files:  frames[] — 5-7 JPEG blobs (palm burst from browser)
//
// Pipeline:
//   1. Validate inputs
//   2. embedBurst(frameBuffers) → enrollment template (L2-normalised)
//   3. Store user in SQLite
//   4. Return user object (without raw embedding)

import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { embedBurst } from '../lib/embedder.js';
import { rankAll } from '../lib/matcher.js';
import { insertUser, getAllUsers } from '../db/schema.js';

const router = Router();

// Use memory storage — we only persist the thumbnail, not the raw frames
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per frame, generous for demo
});

router.post('/', upload.array('frames', 10), async (req, res) => {
  try {
    // ── Input validation ──────────────────────────────────────────────────
    const name = req.body.name?.trim();
    const bankBalance = parseFloat(req.body.bankBalance);
    const walletBalance = parseFloat(req.body.walletBalance);

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (isNaN(bankBalance) || bankBalance < 0) {
      return res.status(400).json({ error: 'bankBalance must be a non-negative number' });
    }
    if (isNaN(walletBalance) || walletBalance < 0) {
      return res.status(400).json({ error: 'walletBalance must be a non-negative number' });
    }
    if (!req.files || req.files.length < 1) {
      return res.status(400).json({ error: 'At least 1 palm frame is required' });
    }

    // ── Demo limit: max 3 registered users (mirrors the frontend limit) ───
    const existingUsers = getAllUsers();
    if (existingUsers.length >= 3) {
      return res.status(400).json({ error: 'Demo limit of 3 registered palms reached. Delete one to enroll another.' });
    }

    // ── Embed burst ───────────────────────────────────────────────────────
    const frameBuffers = req.files.map(f => f.buffer);
    const embedding = await embedBurst(frameBuffers);

    // ── Check for duplicate palm registration ─────────────────────────────
    if (existingUsers.length > 0) {
      const rankedMatches = rankAll(embedding, existingUsers);
      const topMatch = rankedMatches[0];
      // If this palm is already registered to someone else with >= 85% similarity
      if (topMatch && topMatch.score >= 0.85) {
        return res.status(400).json({
          error: `Biometric conflict: This palm is already registered as "${topMatch.user.name}" (${(topMatch.score * 100).toFixed(1)}% match). Please scan a different hand or delete the existing account first.`
        });
      }
    }

    // ── Generate thumbnail (first frame, 160×160) ─────────────────────────
    const thumbnailBuffer = await sharp(frameBuffers[0])
      .resize(160, 160, { fit: 'cover' })
      .jpeg({ quality: 75 })
      .toBuffer();
    const thumbnail = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;

    // ── Persist to DB ─────────────────────────────────────────────────────
    const id = uuidv4();
    const now = Date.now();

    insertUser({
      id,
      name,
      bank_balance: bankBalance,
      wallet_balance: walletBalance,
      embedding: JSON.stringify(Array.from(embedding)),
      thumbnail,
      created_at: now,
    });

    // ── Return user (no raw embedding) ────────────────────────────────────
    return res.status(201).json({
      id,
      name,
      bankBalance,
      walletBalance,
      thumbnail,
      createdAt: new Date(now).toISOString(),
    });

  } catch (err) {
    console.error('[register] error:', err);
    return res.status(500).json({ error: 'Registration failed', detail: err.message });
  }
});

export default router;
