// routes/users.js
// GET /api/users
//
// Returns all registered users (excluding raw embeddings)
// so the frontend can populate registered palms on load.

import { Router } from 'express';
import { getAllUsers, deleteUser, getUserById } from '../db/schema.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const users = getAllUsers().map(u => ({
      id: u.id,
      name: u.name,
      bankBalance: u.bank_balance,
      walletBalance: u.wallet_balance,
      thumbnail: u.thumbnail,
      createdAt: new Date(u.created_at).toISOString(),
    }));
    return res.json(users);
  } catch (err) {
    console.error('[users] error:', err);
    return res.status(500).json({ error: 'Failed to load users' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getUserById(id);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }
    deleteUser(id);
    console.log(`[users] Deleted user: ${existing.name} (${id})`);
    return res.json({ success: true, deletedId: id, name: existing.name });
  } catch (err) {
    console.error('[users] delete error:', err);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
