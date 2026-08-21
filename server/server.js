// server.js
// PalmPay backend — Express entry point.
// Starts the embedding model, mounts routes, serves the frontend.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initEmbedder } from './lib/embedder.js';
import registerRouter from './routes/register.js';
import payRouter from './routes/pay.js';
import transactionsRouter from './routes/transactions.js';
import usersRouter from './routes/users.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3001', 10);

const app = express();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());                            // allow browser on any origin during demo
app.use(express.json({ limit: '50mb' }));   // for any JSON payloads
app.use(express.urlencoded({ extended: true }));

// ─── STATIC ──────────────────────────────────────────────────────────────────
// Serve the updated frontend from the parent directory (PalmPay/)
app.use(express.static(join(__dirname, '..')));

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.use('/api/register', registerRouter);
app.use('/api/pay', payRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/users', usersRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ─── STARTUP ──────────────────────────────────────────────────────────────────
async function start() {
  try {
    // Load the embedding model before accepting requests.
    // This prevents a cold-start delay on the first registration/payment.
    await initEmbedder();

    app.listen(PORT, () => {
      console.log(`\n✅ PalmPay backend running at http://localhost:${PORT}`);
      console.log(`   Frontend: http://localhost:${PORT}/palmpay.html`);
      console.log(`   API health: http://localhost:${PORT}/api/health\n`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
