# Allo — Inventory & Order Fulfillment Platform

> **Submitted by:** Bhuvaneswari N &nbsp;|&nbsp; **Register Number:** 22MIS0578

---

## 🧩 Problem Statement

In multi-warehouse retail, checkout creates a race condition: payment flows (3DS, UPI, wallet redirects) can take several minutes. Without a reservation layer, two customers can pay for the same physical unit simultaneously — one gets a refund, the other a broken experience.

**This platform solves it with temporary stock reservations:**

```
Customer checks out  →  Units held for 10 minutes  →  Payment succeeds → Confirmed ✅
                                                    →  Timer runs out  → Released  🔄
                                                    →  User cancels    → Released  🔄
```

---

## 🌐 Live Demo

>https://allo-inventry-final.vercel.app/

---

## 🛠 Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 14 (App Router) | Full-stack, serverless-ready |
| Language | TypeScript (end-to-end) | Type safety across API + UI |
| Database | Supabase (hosted PostgreSQL) | Managed, free tier, reliable |
| ORM | Prisma | Type-safe queries + migrations |
| Distributed Lock | Upstash Redis | Sub-ms locking, no open connections |
| Validation | Zod | Shared schemas across API + forms |
| Styling | Tailwind CSS | Rapid, consistent UI |
| Deployment | Vercel + Vercel Cron | Zero-config, cron built-in |

---

## 🗂 Project Structure

```
allo-inventory/
├── prisma/
│   ├── schema.prisma              ← 5 models: Warehouse, Product, StockLevel,
│   │                                           Reservation, IdempotencyRecord
│   └── seed.ts                    ← 3 warehouses · 5 products · 13 stock entries
│
├── src/
│   ├── app/
│   │   ├── page.tsx               ← Product listing + Reserve modal
│   │   ├── layout.tsx             ← App shell + sticky header
│   │   ├── globals.css
│   │   ├── reservations/
│   │   │   └── [id]/page.tsx      ← Checkout page + live countdown + actions
│   │   └── api/
│   │       ├── products/          ← GET  /api/products
│   │       ├── warehouses/        ← GET  /api/warehouses
│   │       ├── reservations/      ← POST /api/reservations  ← 🔒 LOCK HERE
│   │       │   └── [id]/
│   │       │       ├── route.ts   ← GET  /api/reservations/:id
│   │       │       ├── confirm/   ← POST /api/reservations/:id/confirm
│   │       │       └── release/   ← POST /api/reservations/:id/release
│   │       └── cron/expire/       ← GET  /api/cron/expire (Vercel Cron)
│   │
│   └── lib/
│       ├── prisma.ts              ← Prisma singleton (dev-safe)
│       ├── redis.ts               ← Upstash REST client + withLock()
│       ├── expiry.ts              ← releaseExpiredReservations()
│       ├── idempotency.ts         ← Idempotency key middleware
│       └── schemas.ts             ← Zod validation schemas
│
├── .env.example
├── vercel.json                    ← Cron: every minute
└── README.md
```

---

## 🔌 API Reference

| Method | Path | Description | Error Codes |
|--------|------|-------------|-------------|
| `GET` | `/api/products` | List products with available stock per warehouse | — |
| `GET` | `/api/warehouses` | List all warehouses | — |
| `POST` | `/api/reservations` | Reserve units for a product/warehouse | `409` if insufficient stock |
| `GET` | `/api/reservations/:id` | Fetch single reservation | `404` if not found |
| `POST` | `/api/reservations/:id/confirm` | Confirm reservation (payment succeeded) | `410` if expired |
| `POST` | `/api/reservations/:id/release` | Release reservation early | `409` if already confirmed |

---

## 🗄 Data Model

```
Warehouse  1 ──────* StockLevel *────── 1 Product
                        │
                        * Reservation
```

```prisma
StockLevel {
  totalUnits    Int   // physical units in warehouse
  reservedUnits Int   // currently held by PENDING reservations
  // availableUnits = totalUnits - reservedUnits
}

Reservation {
  status     PENDING | CONFIRMED | RELEASED
  expiresAt  DateTime
}
```

**State transitions:**

| Event | totalUnits | reservedUnits |
|-------|-----------|--------------|
| Reserve | unchanged | +quantity |
| Confirm | −quantity | −quantity |
| Release / Expire | unchanged | −quantity |

---

## ⚡ Concurrency Strategy

> **The core problem:** Two requests arrive simultaneously for the last unit of a SKU. Both read `available = 1`, both pass the check, both decrement — overselling occurs.

**Solution: Redis distributed lock + Prisma atomic transaction**

```
Request A                              Request B
  │                                       │
  ├─ acquireLock("stock:P1:W1")  ✅       ├─ acquireLock("stock:P1:W1")  ❌ → 409
  ├─ SELECT stockLevel  (consistent read) │
  ├─ available = 1 ≥ 1  ✅               │
  ├─ BEGIN TRANSACTION                    │
  │    UPDATE reservedUnits += 1          │
  │    INSERT reservation                 │
  ├─ COMMIT                               │
  └─ releaseLock()                        │
```

**Key design decisions:**
- Lock key scoped to `productId + warehouseId` → parallel requests for different SKUs don't block each other
- Lock TTL = 10s → auto-releases on crash, no deadlocks
- Stock is re-read **inside** the lock → no stale read possible
- Prisma `$transaction([...])` → stock update + reservation insert are atomic

**Why Redis over `SELECT FOR UPDATE`?**
Both are correct. Redis gives sub-millisecond lock acquisition without holding a Postgres connection open during the lock window. `SELECT FOR UPDATE` is a valid alternative that removes the Redis dependency — noted in Trade-offs.

---

## ⏱ Expiry Mechanism

Two complementary mechanisms — neither depends on the other for correctness:

### 1. Lazy Cleanup *(always active)*
Every `GET /api/products` call runs `releaseExpiredReservations()` before computing available stock. Any visitor to the products page triggers cleanup automatically.

### 2. Vercel Cron *(production)*
`vercel.json` schedules `GET /api/cron/expire` every minute:

```json
{
  "crons": [{ "path": "/api/cron/expire", "schedule": "0 0 * *" }]
}
```

The endpoint is protected: `Authorization: Bearer $CRON_SECRET`

Cleanup logic:
1. Find all `PENDING` reservations where `expiresAt < now`
2. Batch update `status = RELEASED`
3. Decrement `reservedUnits` on each affected `StockLevel`
4. All in a single Prisma transaction

---

## 🔁 Idempotency *(Bonus)*

Pass `Idempotency-Key: <uuid>` header on `POST /api/reservations` or `POST /api/reservations/:id/confirm`.

```
First call  (key: abc-123)  →  Execute + store { key, statusCode, responseBody }
Retry call  (key: abc-123)  →  Return stored response, skip all side effects
```

Stored in `idempotency_records` table in Postgres. Durable across restarts. In production, a 24h TTL cleanup cron would be added.

---

## 🚀 Local Setup

### Prerequisites
- Node.js 18+
- Supabase account → [supabase.com](https://supabase.com) (free)
- Upstash account → [upstash.com](https://upstash.com) (free)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill environment file
cp .env.example .env

# 3. Generate Prisma client
npx prisma generate

# 4. Push schema to Supabase (creates all tables)
npx prisma db push

# 5. Seed the database
npm run db:seed

# 6. Start dev server
npm run dev
# → http://localhost:3000
```

### Environment Variables (`.env`)

```env
# ── Supabase ─────────────────────────────────────────────────────────────────
# Settings → Database → Connect → URI (port 6543 = pooler, port 5432 = direct)
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[ref]:[password]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

# ── Upstash Redis ─────────────────────────────────────────────────────────────
# Redis dashboard → REST API tab
UPSTASH_REDIS_REST_URL="https://your-instance.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your-token"

# ── App config ────────────────────────────────────────────────────────────────
CRON_SECRET="any-random-string"
RESERVATION_WINDOW_MINUTES=10
```

---

## ☁️ Supabase Setup

1. [supabase.com](https://supabase.com) → New Project → choose `ap-south-1` (India)
2. Settings → Database → **Connect** button (top of page) → **ORMs** tab
3. Copy `DATABASE_URL` (port 6543) and `DIRECT_URL` (port 5432)
4. Paste into `.env` with your password
5. Run `npx prisma db push` → tables created
6. Run `npm run db:seed` → data populated
7. Verify in **Table Editor**: `warehouses` `products` `stock_levels` `reservations`

---

## 🟢 Upstash Redis Setup

1. [upstash.com](https://upstash.com) → Create Database → Redis
2. Name: `allo-locks` · Region: `ap-southeast-1`
3. **REST API** tab → copy URL and token into `.env`

---

## 🌍 Deploy to Vercel

```bash
# Push to GitHub
git init && git add . && git commit -m "feat: allo inventory platform"
git remote add origin https://github.com/YOUR/allo-inventory.git
git push -u origin main
```

1. [vercel.com](https://vercel.com) → Import Project → select repo
2. Add all env vars from `.env` in the Vercel dashboard
3. Deploy → Vercel auto-detects Next.js
4. After deploy: run `npm run db:seed` locally (with prod env vars set) to seed production DB

---

## 🧪 Testing Guide

### ✅ Happy Path
1. Open `http://localhost:3000` → 5 products with per-warehouse stock
2. Click **Reserve** → select warehouse → set quantity → **Reserve — 10 min hold**
3. Checkout page opens with **live countdown timer**
4. Click **Confirm purchase** → status changes to "Order confirmed" **without page refresh**
5. Back to products → stock count decreased ✅

### 🔴 409 — Race Condition / Out of Stock
1. Find a product with **1 unit** (Mechanical Keyboard → Mumbai warehouse)
2. Open **two browser tabs** on the same product
3. Click Reserve simultaneously in both tabs
4. **One tab** → checkout page ✅
5. **Other tab** → red error: *"Only 0 unit(s) available"* ✅

### ⏱ 410 — Expired Reservation
1. Set `RESERVATION_WINDOW_MINUTES=1` in `.env` → restart server
2. Reserve any product → wait for countdown to hit 0
3. Click **Confirm purchase** → red error: *"Reservation has expired"* ✅

### 🔁 Idempotency Test
```bash
# Run twice — only ONE reservation should appear in Supabase
curl -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-001" \
  -d '{"productId":"PROD_ID","warehouseId":"WH_ID","quantity":1}'
```

### 🕐 Cron Expiry Test
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  http://localhost:3000/api/cron/expire
# → {"released": 2, "timestamp": "2024-..."}
```

### 🔍 API Smoke Test (browser)
```
http://localhost:3000/api/products
http://localhost:3000/api/warehouses
```

### 📋 Verify in Supabase Table Editor
After each action, check the `reservations` table:

| Action | Expected `status` |
|--------|------------------|
| Reserved | `PENDING` |
| Confirmed | `CONFIRMED` |
| Cancelled | `RELEASED` |
| Expired | `RELEASED` |

---

## ⚖️ Trade-offs & What I'd Do Differently

### Decisions made

| Decision | Rationale |
|----------|-----------|
| Redis SET NX EX for locking | Sub-ms, no Postgres connection held open; `SELECT FOR UPDATE` is equally correct but holds a connection |
| Lazy expiry on `GET /api/products` | Correctness doesn't depend on cron — cron is additive, not load-bearing |
| Prisma `$transaction` | Stock update + reservation insert are atomic — no partial state |
| Idempotency in Postgres | Durable across restarts; Redis would be faster but adds TTL complexity |

### Given more time
- **Jest + Supertest concurrency tests** — programmatically fire two simultaneous requests and assert exactly one 201 and one 409
- **`SELECT FOR UPDATE` fallback** — if Redis is unavailable, fall back to Postgres-level locking instead of failing
- **Payment webhook simulation** — real flow is async: reserve → redirect to payment provider → receive webhook → confirm
- **Stock audit log** — track every increment/decrement with timestamp, actor, reason
- **Queue-based expiry** — BullMQ + Redis for high-SKU scenarios where per-minute cron is too coarse

---

*Submitted as part of the Allo Engineering take-home exercise.*  
*— Bhuvaneswari N · 22MIS0578*
