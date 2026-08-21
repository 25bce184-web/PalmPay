// routes/transactions.js
// GET /api/transactions
//
// Returns all transaction records ordered newest-first,
// shaped to match the frontend's history screen expectations.

import { Router } from 'express';
import { getAllTransactions } from '../db/schema.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const rows = getAllTransactions();

    const transactions = rows.map(row => ({
      id: row.id,
      userName: row.user_name,
      userThumbnail: row.user_thumbnail,
      amount: row.amount,
      mode: row.mode,
      cnnScore: parseFloat((row.match_score * 100).toFixed(1)),  // convert 0-1 → 0-100 % for frontend
      margin: parseFloat((row.margin * 100).toFixed(1)),
      explanation: row.explanation,
      accepted: row.accepted === 1,
      rejectReason: row.reject_reason ?? null,
      createdAt: new Date(row.created_at).toISOString(),
    }));

    return res.json(transactions);
  } catch (err) {
    console.error('[transactions] error:', err);
    return res.status(500).json({ error: 'Failed to load transactions', detail: err.message });
  }
});

export default router;
