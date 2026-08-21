// lib/fraudCheck.js
// Rule-based behavioural fraud check.
//
// IMPORTANT: This is NOT a trained GNN model. It is a deliberately simple
// graph-shaped rule check — velocity, amount-spike, and balance — implemented
// as explicit rules. We call it a "behaviour check" in UI copy, not "AI."
// The frontend's animated GNN canvas is a visual metaphor for this step.
//
// For a production system this is where a real GNN (e.g. PyG with trained
// transaction graph) would slot in. For the demo it is transparent and auditable.

import { getRecentTransactionsForUser } from '../db/schema.js';

const VELOCITY_WINDOW_MS = 60_000;   // 60 seconds
const VELOCITY_MAX_TX = 3;           // max payments in that window before flag
const SPIKE_MULTIPLIER = 5;          // flag if amount > 5× rolling average
const SPIKE_LOOKBACK = 5;            // rolling average over last N accepted transactions

/**
 * Run the behaviour check for a given user + requested payment.
 *
 * @param {object} user         — DB user row (has id, bank_balance, wallet_balance)
 * @param {number} amount       — requested payment amount in ₹
 * @param {'bank'|'wallet'} payMode
 * @returns {{ clear: boolean, reason: string, flags: string[] }}
 */
export function fraudCheck(user, amount, payMode) {
  const flags = [];
  const recentTx = getRecentTransactionsForUser(user.id); // last 10 accepted transactions

  // ── Rule 1: Velocity — too many payments in the last 60 seconds ──────────
  const nowMs = Date.now();
  const inWindow = recentTx.filter(tx => nowMs - tx.created_at < VELOCITY_WINDOW_MS);
  if (inWindow.length >= VELOCITY_MAX_TX) {
    flags.push(`velocity_exceeded: ${inWindow.length} payments in the last 60 s (limit: ${VELOCITY_MAX_TX})`);
  }

  // ── Rule 2: Amount spike — large jump from rolling average ───────────────
  if (recentTx.length >= 2) {
    const lookback = recentTx.slice(0, SPIKE_LOOKBACK);
    const avgAmount = lookback.reduce((sum, tx) => sum + tx.amount, 0) / lookback.length;
    if (avgAmount > 0 && amount > avgAmount * SPIKE_MULTIPLIER) {
      flags.push(`amount_spike: ₹${amount} is ${(amount / avgAmount).toFixed(1)}× the rolling average of ₹${avgAmount.toFixed(0)}`);
    }
  }

  // ── Rule 3: Insufficient balance ─────────────────────────────────────────
  // (This is also enforced in pay.js before debiting, but we surface it here
  //  as a clear labelled reason for the rejection UI.)
  const balance = payMode === 'bank' ? user.bank_balance : user.wallet_balance;
  const balanceLabel = payMode === 'bank' ? 'bank balance' : 'wallet balance';
  if (balance < amount) {
    flags.push(`insufficient_${payMode}_balance: ₹${balance.toFixed(0)} available, ₹${amount} requested`);
  }

  const clear = flags.length === 0;
  const reason = clear
    ? 'Behaviour graph check passed — no anomalous links or velocity flags.'
    : `Transaction flagged: ${flags.join('; ')}.`;

  return { clear, reason, flags };
}
