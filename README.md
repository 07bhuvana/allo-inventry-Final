<<<<<<< HEAD
# Allo — Inventory & Reservation Platform

A Next.js 14 application that solves the **checkout race condition** in multi-warehouse retail: temporary stock reservations with automatic expiry, concurrency-safe locking, and idempotent endpoints.

---

## Live Demo

> Deploy URL goes here after deployment

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Next.js App Router)                           │
│  /           → Product listing + Reserve modal          │
│  /reservations/[id] → Checkout + countdown + actions    │
└──────────────────────────┬──────────────────────────────┘
                           │ fetch()
┌──────────────────────────▼──────────────────────────────┐
│  Next.js API Routes                                     │
│  GET  /api/products          List + lazy expiry         │
│  GET  /api/warehouses        Warehouse list             │
│  POST /api/reservations      Create reservation ← LOCK  │
│  GET  /api/reservations/[id] Fetch single               │
│  POST /api/reservations/[id]/confirm   Confirm (410)    │
│  POST /api/reservations/[id]/release   Cancel           │
│  GET  /api/cron/expire       Vercel Cron cleanup        │
└──────────┬─────────────────────────────┬────────────────┘
           │                             │
┌──────────▼──────────┐   ┌─────────────▼──────────────┐
│  Supabase Postgres  │   │  Upstash Redis              │
│  (Prisma ORM)       │   │  Distributed lock           │
│                     │   │  Idempotency cache          │
│  warehouses         │   │  key: lock:productId:whId   │
│  products           │   └────────────────────────────┘
│  stock_levels       │
│  reservations       │
│  idempotency_records│
└─────────────────────┘
```

---

## Concurrency Strategy

**The core problem:** Two requests arrive simultaneously for the last unit of SKU-HEADPH-001 at Mumbai warehouse. Without a lock, both read `available = 1`, both pass the check, and both decrement — resulting in `reservedUnits = 2` against `totalUnits = 1`.

**Solution: Redis distributed lock + Postgres transaction**

```
Request A                          Request B
  │                                  │
  ├── acquireLock("stock:P1:W1") ✓   ├── acquireLock("stock:P1:W1") ✗ → 409
  ├── SELECT stockLevel (inside lock)│
  ├── available = 1 ≥ 1 ✓           │
  ├── BEGIN TRANSACTION              │
  ├──   UPDATE reservedUnits += 1    │
  ├──   INSERT reservation           │
  ├── COMMIT                         │
  └── releaseLock()                  │
```

The lock key is scoped to `productId + warehouseId`, so requests for different SKUs/warehouses don't block each other. Lock TTL is 10s to prevent deadlocks on crash.

Why not just use Postgres `SELECT FOR UPDATE`? That works too, and is noted as an alternative in Trade-offs below. Redis gives us sub-millisecond lock acquisition without holding a Postgres connection open.

---

## Expiry Mechanism

Two complementary approaches:

### 1. Lazy cleanup (always active)
`GET /api/products` runs `releaseExpiredReservations()` before computing available stock. This means any visitor to the products page will trigger cleanup — no background worker needed for correctness.

### 2. Vercel Cron (production)
`vercel.json` schedules `GET /api/cron/expire` every minute. This ensures cleanup happens even if nobody visits the products page.

```json
{
  "crons": [{ "path": "/api/cron/expire", "schedule": "* * * * *" }]
}
```

The cron endpoint is protected by `Authorization: Bearer $CRON_SECRET`.

---

## Idempotency (Bonus)

Pass `Idempotency-Key: <uuid>` header on `POST /api/reservations` or `POST /api/reservations/:id/confirm`.

On first call: execute normally, store `{ key, endpoint, statusCode, responseBody }` in `idempotency_records`.

On retry with same key: return stored response immediately, skipping all side effects.

Records are never deleted (in production you'd set a 24h TTL or cron cleanup).

---

## Data Model

```prisma
Warehouse  1───* StockLevel *───1 Product
                    │
                    1
                    │
                    * Reservation
```

`StockLevel.availableUnits = totalUnits - reservedUnits`

- **PENDING reservation**: units are held (`reservedUnits` incremented)
- **CONFIRMED reservation**: units are permanently removed (`totalUnits` decremented, `reservedUnits` decremented)
- **RELEASED reservation**: units return (`reservedUnits` decremented only)

---

## Running Locally

### 1. Prerequisites
- Node.js 18+
- A Supabase account (free tier works)
- An Upstash account (free tier works)

### 2. Clone and install
```bash
git clone <repo-url>
cd allo-inventory
npm install
```

### 3. Configure environment variables
```bash
cp .env.example .env.local
```

Fill in:
```env
# From Supabase → Project Settings → Database → Connection String
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[ref]:[password]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

# From Upstash → Redis → REST API
UPSTASH_REDIS_REST_URL="https://your-instance.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your-token"

# Any random string for cron auth
CRON_SECRET="some-random-secret"

# Optional: override the 10-minute window
RESERVATION_WINDOW_MINUTES=10
```

### 4. Push schema and seed
```bash
npm run db:generate   # Generate Prisma client
npm run db:push       # Push schema to Supabase
npm run db:seed       # Seed with warehouses, products, stock
```

### 5. Run dev server
```bash
npm run dev
# Open http://localhost:3000
```

---

## Supabase Setup (Step-by-Step)

1. Go to [supabase.com](https://supabase.com) → New project
2. Choose a region close to you (ap-south-1 for India)
3. Note your database password
4. Go to **Project Settings → Database**
5. Copy the **Connection Pooler** string (port 6543) → `DATABASE_URL`
6. Copy the **Direct connection** string (port 5432) → `DIRECT_URL`
7. Append `?pgbouncer=true` to `DATABASE_URL`
8. Run `npm run db:push` — this creates all tables
9. Run `npm run db:seed` — this populates test data
10. Verify in **Table Editor** that you see data in `warehouses`, `products`, `stock_levels`

---

## Upstash Setup (Step-by-Step)

1. Go to [upstash.com](https://upstash.com) → Create Database → Redis
2. Choose region (eu-west-1 or ap-southeast-1 are fine for testing)
3. Go to **REST API** tab
4. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
5. Add both to `.env.local`

---

## Deploying to Vercel

1. Push repo to GitHub
2. Import project at [vercel.com](https://vercel.com)
3. Add all env vars from `.env.local` in Vercel dashboard
4. Add `CRON_SECRET` as well
5. Deploy — Vercel auto-detects Next.js
6. After deploy, run seed against prod DB: set env vars locally and `npm run db:seed`

---

## Testing the Full Flow

### Manual happy path
1. Open `http://localhost:3000`
2. Click **Reserve** on any product with stock
3. Select a warehouse → set quantity → click **Reserve — 10 min hold**
4. You land on the checkout page with a live countdown
5. Click **Confirm purchase** → status changes to "Order confirmed" without page refresh
6. Go back to products → stock count has decreased

### Testing 409 (race condition / out of stock)
1. Find a product with only 1 unit (e.g. Mechanical Keyboard at Mumbai)
2. Open two browser tabs
3. Click Reserve on both simultaneously
4. One should succeed (201), the other should show a red 409 error

### Testing 410 (expired reservation)
1. Set `RESERVATION_WINDOW_MINUTES=1` (or even lower with a code change)
2. Create a reservation
3. Wait for the countdown to reach 0
4. Click **Confirm purchase** → should get the 410 expired error

### Testing idempotency
```bash
# First call
curl -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-abc123" \
  -d '{"productId":"<id>","warehouseId":"<id>","quantity":1}'

# Same key again — returns identical response, no second reservation created
curl -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-abc123" \
  -d '{"productId":"<id>","warehouseId":"<id>","quantity":1}'
```

### Testing cron expiry
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/expire
# Returns: {"released": N, "timestamp": "..."}
```

### API smoke tests (curl)
```bash
# List products
curl http://localhost:3000/api/products | jq .

# List warehouses
curl http://localhost:3000/api/warehouses | jq .

# Reserve
curl -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -d '{"productId":"PROD_ID","warehouseId":"WH_ID","quantity":1}' | jq .

# Confirm
curl -X POST http://localhost:3000/api/reservations/RES_ID/confirm | jq .

# Release
curl -X POST http://localhost:3000/api/reservations/RES_ID/release | jq .
```

---

## Trade-offs & What I'd Do Differently

### What I chose and why
- **Redis SET NX EX for locking** — simple, sub-ms, no Postgres connection held open. Alternative is `SELECT FOR UPDATE` inside a transaction, which is equally correct and removes the Redis dependency. With more time I'd benchmark both.
- **Lazy expiry on GET /products** — ensures correctness even without the cron. The cron is additive, not load-bearing.
- **Prisma transactions** — stock update + reservation creation are atomic. No partial state.
- **Idempotency in Postgres** — simple and durable; Redis would be faster but adds TTL complexity.

### Given more time
- **`SELECT FOR UPDATE` fallback** — if Redis is unavailable, fall back to Postgres-level locking rather than returning 409. More resilient.
- **Optimistic locking with version column** — retry loop instead of lock; better for very high throughput.
- **Webhook simulation for payment** — currently "Confirm" is immediate. Real flow would be async: reserve → redirect to payment provider → receive webhook → confirm.
- **Reservation cleanup backoff** — cron every minute is coarse; with more SKUs, a queue-based approach (BullMQ + Redis) scales better.
- **Stock history / audit log** — track every increment/decrement with who/why.
- **Multi-quantity concurrency tests** — Jest + Supertest to verify two concurrent requests for the last unit produce exactly one 201 and one 409.
=======
# allo-inventry-Final
>>>>>>> a8e1b0c7db3403a35d27a34b705b959e9c927eb2
