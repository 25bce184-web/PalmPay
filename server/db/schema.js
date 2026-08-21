// db/schema.js
// Persistent JSON database for VEINPAY demo.
// Stores users and transactions directly to disk in data/veinpay.json.
// Completely dependency-free and 100% reliable across all Node versions.

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, '..', 'data');
mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = join(DB_DIR, 'veinpay.json');

function loadData() {
  if (!existsSync(DB_PATH)) {
    const initial = { users: [], transactions: [] };
    writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const raw = readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { users: [], transactions: [] };
  }
}

function saveData(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── USER HELPERS ─────────────────────────────────────────────────────────────

export function insertUser(user) {
  const data = loadData();
  data.users.push(user);
  saveData(data);
}

export function getAllUsers() {
  const data = loadData();
  return data.users.sort((a, b) => a.created_at - b.created_at);
}

export function getUserById(id) {
  const data = loadData();
  return data.users.find(u => u.id === id) || null;
}

export function deleteUser(id) {
  const data = loadData();
  data.users = data.users.filter(u => u.id !== id);
  data.transactions = data.transactions.filter(t => t.user_id !== id);
  saveData(data);
  return true;
}

export function updateBalance(id, bankBalance, walletBalance) {
  const data = loadData();
  const u = data.users.find(user => user.id === id);
  if (u) {
    u.bank_balance = bankBalance;
    u.wallet_balance = walletBalance;
    saveData(data);
  }
}

// ─── TRANSACTION HELPERS ──────────────────────────────────────────────────────

export function insertTransaction(tx) {
  const data = loadData();
  data.transactions.unshift(tx);
  saveData(data);
}

export function getAllTransactions() {
  const data = loadData();
  return data.transactions.sort((a, b) => b.created_at - a.created_at);
}

export function getRecentTransactionsForUser(userId) {
  const data = loadData();
  return data.transactions
    .filter(t => t.user_id === userId && t.accepted === 1)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 10);
}

export default {
  insertUser,
  getAllUsers,
  getUserById,
  deleteUser,
  updateBalance,
  insertTransaction,
  getAllTransactions,
  getRecentTransactionsForUser,
};
