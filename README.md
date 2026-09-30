# Northcut — backend

Express 5 API + BullMQ worker, on MongoDB (replica set) and Redis.

```sh
cp .env.example .env    # fill in JWT_ACCESS_SECRET, PAYMENT_WEBHOOK_SECRET, CLOUDINARY_*
npm install
npm run seed:admin -- --name "Admin" --email admin@example.com --password "change-me-123"
npm run dev             # API on :4000, docs at /api/docs
npm run dev:worker      # background jobs: emails, order expiry, payments, refunds
```

Both processes are needed. Setup, how to try every flow, and a tour of the code: [`../README.md`](../README.md).
Coding conventions: [`CLAUDE.md`](CLAUDE.md).
