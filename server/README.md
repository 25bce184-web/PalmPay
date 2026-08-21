# VEINPAY Backend

A real backend for the VEINPAY palm-payment biometric demo.

---

## ⚠️ DEMO / PITCH USE ONLY — NOT PRODUCTION-READY

This is a **demonstration prototype** built for a business-plan pitch. It has:
- No authentication or session management
- No TLS / HTTPS
- No rate limiting beyond the demo fraud-check rules
- Simulated bank/wallet balances (no real banking integration)
- Local disk storage — not suitable for real biometric data

Do not deploy this to a public server or use it with real financial accounts.

---

## Quick Start

### 1. Install dependencies

```bash
cd server
npm install
```

> `@tensorflow/tfjs-node` installs a native binary (libtensorflow). This may take 2–3 minutes and requires internet access. Run it before the venue.

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and add your GROQ_API_KEY
```

The demo works **without** a Groq key — a fallback explanation string is used. The Groq explanation is the judge-facing "why" text, not the match decision.

### 3. Start the server

```bash
npm start
# or for development with auto-restart:
npm run dev
```

Open **http://localhost:3001/palmpay.html** in your browser.

---

## Architecture

### Why is the match decision deterministic while Groq only explains it?

Vision LLMs are **not reliable frame-to-frame biometric matchers**. A flaky live demo — where a payment succeeds or fails based on whether the LLM happens to say the right thing — is worse for a pitch than an honest hybrid design.

The pipeline is:

```
Browser (camera burst)
  │
  ▼
POST /api/pay  (multipart, 5-7 JPEG frames)
  │
  ├── 1. embedBurst()      → MobileNetV2 1280-dim embedding (averaged across frames)
  ├── 2. rankAll()         → cosine similarity vs every enrolled palm
  ├── 3. decide()          → TWO-CONDITION GUARD:
  │                             top score ≥ MATCH_THRESHOLD (default 0.72)
  │                             AND margin ≥ MARGIN_THRESHOLD (default 0.06)
  │                           → ACCEPT or REJECT  ← THIS IS THE AUTHORITATIVE DECISION
  ├── 4. fraudCheck()      → velocity + amount-spike + balance rules
  ├── 5. updateBalance()   → debit happens HERE, before Groq
  └── 6. explainDecision() → Groq produces a 1-2 sentence explanation
                              of the already-made decision.
                              If Groq is unreachable → fallback string used.
                              Payment always completes regardless.
```

**The LLM is the announcer, not the judge.** The embedding matcher decides; Groq narrates.

---

## Current Groq vision model

```
meta-llama/llama-4-scout-17b-16e-instruct
```

Configured via `GROQ_VISION_MODEL` in `.env`. To swap models (e.g. if Groq deprecates this one):

1. Check https://console.groq.com/docs/models for the current vision-capable model ID.
2. Edit `.env` → `GROQ_VISION_MODEL=<new-model-id>`.
3. Restart the server. No code changes required.

---

## API Reference

### `POST /api/register`
Register a new palm.

**Body**: `multipart/form-data`
- `name` (string, required)
- `bankBalance` (number, required)
- `walletBalance` (number, required)
- `frames[]` (files, 1-10 JPEG blobs)

**Response**: `{ id, name, bankBalance, walletBalance, thumbnail, createdAt }`

---

### `POST /api/pay`
Attempt a biometric payment.

**Body**: `multipart/form-data`
- `amount` (number, required)
- `mode` (`'bank'` | `'wallet'`, required)
- `frames[]` (files, 1-10 JPEG blobs)

**Success response**:
```json
{
  "accepted": true,
  "user": { "id": "...", "name": "...", "bankBalance": ..., "walletBalance": ... },
  "score": 87.3,
  "margin": 14.1,
  "explanation": "Primary crease and vein pattern match...",
  "transaction": { "id": "...", "amount": ..., "mode": "...", "createdAt": "..." }
}
```

**Failure response**:
```json
{
  "accepted": false,
  "reason": "Best match score 41.2% is below the required threshold of 72%.",
  "explanation": "The scanned palm did not match..."
}
```

---

### `GET /api/transactions`
Retrieve all transactions, most recent first.

**Response**: array of `{ id, userName, userThumbnail, amount, mode, cnnScore, margin, explanation, accepted, rejectReason, createdAt }`

---

## Thresholds

Configured via environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `MATCH_THRESHOLD` | `0.72` | Minimum cosine similarity (0–1) to accept a match |
| `MARGIN_THRESHOLD` | `0.06` | Minimum gap between top and runner-up scores |

Lower thresholds = more permissive (fewer false rejects, more false accepts). Raise them for a more secure demo, lower them if the embedding model is producing systematically lower scores for your particular camera/lighting conditions.
