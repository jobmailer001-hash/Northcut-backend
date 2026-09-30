# Northcut — Backend Coding Standards and Conventions

**Scope:** Node.js / Express 5 / MongoDB / Redis backend for the Northcut clothing-brand e-commerce MVP.
This document does not cover frontend (Vue.js) conventions — see `northcut-frontend/CLAUDE.md` for those.

This is a living instruction document intended to be read as project instructions (e.g. by Claude or any contributor) before writing, modifying, or reviewing backend code. Follow these rules consistently.

Adapted from the coding standards used in the `logistics-system-backend` project, with the folder layout, import-alias map and examples adjusted to this project's actual domain (products/orders/inventory/payments) and stack (Mongoose on a replica set, Redis sessions, BullMQ worker, a hand-written `openapi.yaml` served by Swagger UI). **What** to build lives in `../plan.md`; **how** to write it lives here.

---

## 1. General Principles

* Write clean, readable, maintainable, and scalable code.
* Prefer simplicity over unnecessary abstraction.
* Do not over-engineer small features.
* Keep responsibilities separated.
* Avoid duplicated logic. Extract reusable logic only when it has a clear, proven purpose.
* Prefer composition over inheritance.
* Do not introduce libraries or dependencies unless they provide clear value — the agreed stack is listed in `plan.md` §1.
* Before creating new utilities, handlers, or helpers, check whether an existing implementation can be reused.
* Do not leave unused imports, variables, functions, files, or commented-out code.

---

## 2. JavaScript Standards

* Use modern JavaScript (ES2022+) syntax.
* Use **ES Modules only** (`"type": "module"`) — no CommonJS.

```js
// Correct
import express from "express";
import { placeOrder } from "#handlers/order.handler.js";

export const createOrder = async () => {};
```

```js
// Avoid
const express = require("express");
module.exports = app;
```

* Prefer `const` by default.
* Use `let` only when reassignment is necessary.
* Never use `var`.
* Use optional chaining and nullish coalescing when appropriate.

```js
const email = user?.email;
const limit = query.limit ?? 20;
```

* Prefer `async/await` over `.then()` chains.

---

## 3. Naming Conventions

### Variables

Use descriptive `camelCase`.

```js
const orderDraft = {};
const availableQuantity = product.stock - product.reserved;
const isPreorder = order.type === OrderTypes.PREORDER;
```

Boolean variables should clearly communicate a true/false state, using prefixes such as:

```js
isLoading;
isActive;
hasStock;
canCancel;
shouldRefund;
```

Avoid vague names (`data`, `thing`, `result`, `temp`). Short names are fine only when context is obvious (e.g. `items.map((item) => item.sku)`).

### Functions

Use `camelCase`. Function names should describe an action and be verb-based.

```js
const placeOrder = async () => {};
const reserveInventory = async () => {};
const releaseReservation = async () => {};
const revokeAllSessions = async () => {};
```

Boolean-returning functions should read as a question:

```js
const isValidAccessToken = () => {};
const canCustomerCancel = () => {};
const hasEnoughStock = () => {};
```

Avoid generic names such as `processData()`, `handleStuff()`, `doSomething()`.

> See **Section 6 — Function Definition Standard** for how functions must be structured (arrow functions, exports, file layout).

### Classes

Use `PascalCase`. Reserve classes for cases where they earn their place — see Section 6.2. Do not create a class when a plain function or module is sufficient.

```js
class AppError extends Error {}
```

### Constants

Use `camelCase` for ordinary constants.

```js
const defaultPageSize = 20;
```

Use `UPPER_SNAKE_CASE` only for true global/static or environment-level constants, for **error codes** (see Section 9), and for **enum values** stored in the database.

```js
const CUSTOMER_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_TTL = "15m";

export const OrderStatuses = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  PAID: "PAID",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
};
```

Do not use uppercase simply because a variable is declared with `const`.

---

## 4. File and Folder Naming

Use lowercase `kebab-case` for files and folders.

```text
order.handler.js
order.controller.js
user-log.model.js
authenticate.middleware.js
order.validator.js
```

Recommended suffixes by responsibility:

```text
order.routes.js
order.controller.js
order.handler.js
order.repository.js
order.model.js
order.validator.js
authenticate.middleware.js
error-handler.middleware.js
order-expiry.processor.js
payment.provider.js
app-error.js
error-codes.js
session.util.js
```

Avoid generic file names such as `utils.js`, `helpers.js`, `common.js`, `misc.js` unless the contents have a genuinely narrow, clearly defined purpose (e.g. `money.util.js` for kobo formatting/arithmetic is fine — `utils.js` holding unrelated logic is not).

### 4.1 Folder structure

```text
northcut-backend/
├── package.json
├── .env.example
├── __test__.mjs                      # end-to-end test of the live API
├── docs/
│   └── openapi.yaml                  # the API docs — hand-written, see §10.1
└── src/
    ├── index.js                      # API entry: calls startApp()
    ├── worker.js                     # Worker entry: calls startWorker()
    ├── bootstrap/
    │   ├── start-app.js              # connect Mongo + Redis, then build the Express app and listen
    │   ├── start-worker.js           # connect Mongo + Redis, then start every queue worker
    │   ├── express-app.factory.js    # createExpressApp(): middleware, routes, error handlers
    │   └── crash-and-exit.js         # startup failure: close open connections, exit(1)
    ├── configs/                      # env (zod-validated), mongodb, redis/bullmq, cloudinary, logger
    ├── db/
    │   ├── mongodb/
    │   │   ├── mongodb.connection.js # default export: connectMongoDb
    │   │   ├── transaction.js        # runInTransaction
    │   │   ├── models/               # user, product, order, transaction, user-log, system-log, pending-image-upload, site-setting
    │   │   └── seeders/              # admin.seeder.js — create the first admin user
    │   └── redis/
    │       ├── redis.connection.js   # shared app client (sessions, reset codes); default export: connectRedis
    │       └── bullmq.connection.js  # default export: createBullMqConnection (queues + workers)
    ├── workers/
    │   ├── queue-workers.js          # one process, one BullMQ worker per registered processor
    │   └── processors/               # order-expiry, payment-events, refunds, emails, product-images, site-hero-images
    └── app/
        ├── routes/                   # auth, me, products, cart, orders, admin/*, webhooks
        ├── controllers/
        ├── handlers/                 # business logic (validateItems, reserveInventory, ...)
        ├── repositories/             # Mongoose queries only
        ├── validators/               # zod schemas (body/params/query)
        ├── middlewares/              # authenticate, require-role, validate, upload, error-handler
        ├── providers/                # payment/email provider adapters (swappable)
        ├── queues/                   # BullMQ queue definitions (shared by API + worker)
        ├── errors/                   # app-error.js, error-codes.js
        ├── constants/                # enums: statuses, roles, reasons
        └── utils/                    # session, token, money, log helpers
```

---

## 5. Import Conventions

### 5.1 Import aliasing (Node.js subpath imports)

Internal imports use Node.js native subpath imports, configured via the `imports` field in `package.json` — clean absolute-style imports in an ES module Node backend with no bundler config required.

`package.json`:

```json
{
  "imports": {
    "#controllers/*": "./src/app/controllers/*",
    "#routes/*": "./src/app/routes/*",
    "#handlers/*": "./src/app/handlers/*",
    "#repositories/*": "./src/app/repositories/*",
    "#models/*": "./src/db/mongodb/models/*",
    "#middlewares/*": "./src/app/middlewares/*",
    "#validators/*": "./src/app/validators/*",
    "#providers/*": "./src/app/providers/*",
    "#queues/*": "./src/app/queues/*",
    "#errors/*": "./src/app/errors/*",
    "#utils/*": "./src/app/utils/*",
    "#constants/*": "./src/app/constants/*",
    "#bootstrap/*": "./src/bootstrap/*",
    "#configs/*": "./src/configs/*",
    "#db/*": "./src/db/*",
    "#workers/*": "./src/workers/*"
  }
}
```

Usage:

```js
import { cancel as cancelHandler } from "#handlers/order.handler.js";
import { AppError } from "#errors/app-error.js";
```

Rules:

* Use a `#alias/*` import for anything **outside the current folder**.
* Use a relative import (`./`, `../`) only for files that live directly beside each other.
* Never write deep relative paths like `../../../handlers/order.handler.js` — that always means the aliased import should be used instead.
* Never use a namespace import (`import * as x from "..."`). Every import — internal or third-party — must be a named/destructured import (or a default import where the package only offers one).
* When importing a handler function into a controller, alias it with a `Handler` suffix and call it via that alias: `import { cancel as cancelHandler } from "#handlers/order.handler.js";` ... `await cancelHandler({ orderNumber, userId });`. This keeps the call site unambiguous even when the handler's exported name would otherwise collide with a same-named controller export. The same pattern applies when a handler imports a repository function it needs to disambiguate, e.g. `import { create as createOrderRepo } from "#repositories/order.repository.js";`.

### 5.2 Import order

Group and order imports in three blocks, separated by a blank line:

```js
// 1. External packages
import express from "express";
import mongoose from "mongoose";

// 2. Internal aliased modules
import { cancel as cancelHandler } from "#handlers/order.handler.js";
import { AppError } from "#errors/app-error.js";

// 3. Relative modules (same folder only)
import { orderRoutes } from "./order.routes.js";
```

* Remove unused imports.
* Avoid circular dependencies.
* Import only what you need.

---

## 6. Function Definition Standard

### 6.1 Arrow functions, `const`-assigned — everywhere

**All functions in this project — including exported/top-level functions — must be written as `const`-assigned arrow functions.** This applies to controllers, handlers, repositories, middleware, validators, processors, providers, and utilities alike.

```js
// Correct
export const placeOrder = async ({ userId, items, shippingAddress }) => {
  /* ... */
};
```

```js
// Avoid
export async function placeOrder({ userId, items, shippingAddress }) {
  /* ... */
}
```

Rationale: consistency across the codebase, no hoisting ambiguity, and it matches this project's ES module / `const`-by-default standard end to end.

### 6.2 When a class is (and isn't) appropriate

Prefer plain function modules over classes for handlers, repositories and providers — a handler file exports a set of arrow functions rather than an `OrderHandler` class with methods.

```js
// order.handler.js — preferred pattern
export const placeOrder = async ({ userId, items, shippingAddress }) => {
  /* ... */
};

export const cancel = async ({ orderNumber, userId }) => {
  /* ... */
};
```

Reserve `class` (PascalCase) for cases where it is genuinely the right tool:

* Custom error types (`AppError extends Error` — see Section 9).
* Mongoose schemas/models, which are inherently class-based.
* A stateful resource that must encapsulate internal state across calls, where a class provides real value over a closure.

Do not introduce a class purely out of habit for something that is really a stateless set of operations.

### 6.3 One function, one responsibility

Functions should do one logical thing. Avoid functions that mix validation, database access, business logic, notifications, logging, and response formatting.

Express 5 forwards rejected promises from async route handlers to the error middleware automatically, so controllers **do not** wrap their body in `try/catch` just to call `next(error)` — let the error propagate.

```js
// order.controller.js
import { cancel as cancelHandler } from "#handlers/order.handler.js";

export const cancelOrder = async (req, res) => {
  const order = await cancelHandler({
    orderNumber: req.validated.params.orderNumber,
    userId: req.user.id,
    cancelledBy: CancelledBy.CUSTOMER,
  });
  return res.status(200).json({ data: { order } });
};
```

```js
// order.handler.js
import { findByOrderNumber } from "#repositories/order.repository.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";

export const cancel = async ({ orderNumber, userId, cancelledBy }) => {
  const order = await findByOrderNumber({ orderNumber, userId });

  if (!order) {
    throw new AppError("Order not found.", { code: ErrorCodes.ORDER_NOT_FOUND });
  }

  if (!canCustomerCancel(order)) {
    throw new AppError("This order can no longer be cancelled.", { code: ErrorCodes.ORDER_NOT_CANCELLABLE });
  }

  /* ... release reservation, update status, enqueue refund if paid ... */
};
```

### 6.4 JSDoc on Every Function

Every function must have a JSDoc block directly above its definition — controllers, handlers, repositories, middleware, validators, processors, providers, utils, config/connection modules, all of it. No exported or internal function is exempt.

This also applies to **usage sites of third-party functions** — the codebase has no TypeScript, so JSDoc is the only source of editor autocomplete and parameter/return typing it gets. You cannot and must not add JSDoc inside `node_modules`, but any place *our* code defines, configures, or wraps a third-party call gets a JSDoc block above it, e.g.:

```js
/**
 * Express application instance configured with security headers, CORS,
 * cookie parsing, JSON body parsing, the v1 routes, and the centralized error handler.
 * @type {import("express").Express}
 */
const app = express();
```

```js
/**
 * Establishes the MongoDB connection (replica set, required for transactions).
 * @returns {Promise<import("mongoose").Mongoose>} The connected mongoose instance.
 */
export const connectMongoDb = async () => {
  return mongoose.connect(env.mongoUri);
};
```

A JSDoc block documents the function's **contract**, not its implementation — this is why it does not conflict with Section 12's "don't comment obvious code" rule. Keep it to:

* One-line summary of what the function does.
* `@param {Type} name - description` for each parameter (use `@param {Object} options` plus nested `@param {Type} options.field` for the options-object pattern in Section 8).
* `@returns {Type}` describing what's returned (wrap in `Promise<...>` for async functions).
* `@throws {AppError} CODE - when...` for each `AppError` the function deliberately throws.

```js
/**
 * Cancels an order, releasing its inventory reservation and enqueuing a refund if it was paid.
 * @param {Object} options
 * @param {string} options.orderNumber - Human-readable order number.
 * @param {string} options.userId - ID of the customer who owns the order.
 * @param {string} options.cancelledBy - One of CancelledBy (CUSTOMER | ADMIN | SYSTEM).
 * @returns {Promise<Order>} The cancelled order document.
 * @throws {AppError} ORDER_NOT_FOUND - if no order matches orderNumber for this user.
 * @throws {AppError} ORDER_NOT_CANCELLABLE - if the order is shipped or past the 24h window.
 */
export const cancel = async ({ orderNumber, userId, cancelledBy }) => {
  /* ... */
};
```

---

## 7. Architecture & Layer Responsibilities

Maintain clear boundaries between layers:

```text
Routes          (+ validate / authenticate / require-role middleware)
  ↓
Controller
  ↓
Handler         (+ providers, queues)
  ↓
Repository
  ↓
Model / Database
```

**Routes** should:

* Declare the path, method and middleware chain (`validate(schema)`, `authenticate`, `requireRole(Roles.ADMIN)`, `upload`).
* Contain no logic.

**Controllers** should:

* Handle HTTP concerns only (req/res, cookies, status codes).
* Read validated input from `req.validated` (never raw `req.body`) and pass it to handlers.
* Shape the final response using the envelope in Section 10.
* Never handle business errors themselves — let them propagate to the error handler.

**Handlers** should:

* Contain business logic and orchestration (the operations listed in `plan.md` §7).
* Throw `AppError` for expected/business-rule failures (see Section 9).
* Remain independent of `req`/`res`.
* Call repositories for data access — never a Mongoose model directly.
* Own the MongoDB transaction when an operation spans several writes (Section 13.1).

**Repositories** should:

* Handle database access only (wrap the Mongoose model's queries).
* Accept an optional `session` so they can take part in a handler's transaction.
* Contain no business logic and no `AppError` throwing for business rules.

**Providers** wrap third-party services (payment gateway, email) behind a small, stable function interface so the provider can be swapped without touching handlers. Handlers never import a vendor SDK directly.

**Worker processors** (`src/workers/processors/`) run in the single worker process (`worker.js` → `bootstrap/start-worker.js`), registered in `src/workers/queue-workers.js`. They are thin like controllers: validate the job payload, call a handler, let errors propagate so BullMQ can retry.

Do not place database queries directly in controllers or handlers unless the operation is intentionally trivial and this is a deliberate, agreed exception.

---

## 8. Object and Function Parameters

Avoid passing many positional arguments. Prefer a single options object for anything beyond 2 parameters.

```js
// Avoid
writeSystemLog("info", "ORDER_EXPIRED", "Order", orderId, message, meta);
```

```js
// Prefer
writeSystemLog({
  level: "info",
  event: "ORDER_EXPIRED",
  entityType: "Order",
  entityId: orderId,
  message,
  meta,
});
```

---

## 9. Error Handling

Errors are never silently swallowed, and every error the application throws deliberately is an instance of a single custom error class, distinguished by an **error code** rather than a growing tree of subclasses.

### 9.1 `AppError`

```js
// errors/app-error.js
import { ErrorStatusCodes } from "./error-codes.js";

export class AppError extends Error {
  constructor(message, { statusCode, code = "INTERNAL_ERROR", isOperational = true, details } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode ?? ErrorStatusCodes[code] ?? 500;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}
```

* `AppError` is the **only** custom error class in the application.
* Every deliberately-thrown error is distinguished by its `code`, not by `instanceof` checks against many subclasses.
* `statusCode` defaults from `ErrorStatusCodes[code]` (see 9.2), so a given code can never end up paired with the wrong status at two different call sites. Pass `statusCode` explicitly only when genuinely overriding the code's canonical status.
* `isOperational: true` marks an expected, handled failure (e.g. "order not found"); an *unexpected* bug should be left as a raw `Error` (or `isOperational: false`) so it is logged loudly rather than disguised as a normal business error.
* `details` carries structured data the client needs to recover — e.g. `CART_REQUIRES_UPDATE` puts `{ issues, items }` in `details` (see `plan.md` §5).

### 9.2 Error codes

Keep error codes centralized as `UPPER_SNAKE_CASE` string constants, grouped by domain, alongside their canonical HTTP status:

```js
// errors/error-codes.js
export const ErrorCodes = {
  // General
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // Auth
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  // Products / orders
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  CART_REQUIRES_UPDATE: "CART_REQUIRES_UPDATE",
  ORDER_NOT_CANCELLABLE: "ORDER_NOT_CANCELLABLE",
};

// Add an entry here whenever a new error code is added to ErrorCodes above,
// so every throw site for that code stays on the same status by default.
export const ErrorStatusCodes = {
  [ErrorCodes.VALIDATION_ERROR]: 422,
  [ErrorCodes.UNAUTHORIZED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.INTERNAL_ERROR]: 500,
  [ErrorCodes.INVALID_CREDENTIALS]: 401,
  [ErrorCodes.ACCOUNT_DISABLED]: 403,
  [ErrorCodes.PRODUCT_NOT_FOUND]: 404,
  [ErrorCodes.ORDER_NOT_FOUND]: 404,
  [ErrorCodes.CART_REQUIRES_UPDATE]: 422,
  [ErrorCodes.ORDER_NOT_CANCELLABLE]: 409,
};
```

```js
throw new AppError("Order not found.", { code: ErrorCodes.ORDER_NOT_FOUND });
```

Add new codes to both `ErrorCodes` and `ErrorStatusCodes` as new failure cases are introduced — do not invent inline string literals for codes at the call site, and do not pass a redundant `statusCode`.

### 9.3 Centralized error handling

All errors are caught by a single Express error-handling middleware, mounted last in `createExpressApp()` (`src/bootstrap/express-app.factory.js`).

```js
// middlewares/error-handler.middleware.js
import { AppError } from "#errors/app-error.js";
import { logger } from "#configs/logger.config.js";

export const errorHandler = (err, req, res, next) => {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : "INTERNAL_ERROR";

  if (!isAppError || !err.isOperational) {
    // Unexpected / programmer error — log full detail for investigation.
    logger.error(err);
  }

  return res.status(statusCode).json({
    error: {
      code,
      message: isAppError ? err.message : "Something went wrong.",
      ...(isAppError && err.details && { details: err.details }),
    },
  });
};
```

### 9.4 Rules

* Never use an empty `catch {}` block.
* Do not expose raw internal error messages/stack traces to API clients for non-operational errors.
* Do not use exceptions for normal control flow (e.g. `validateItems` collects per-item `issues`; it does not throw per item).
* Validate before you act, so most errors are `AppError`s you threw on purpose, not runtime exceptions you're catching defensively.

---

## 10. API Response Conventions

Base path: `/api/v1`. All API responses use a consistent envelope: no `success` boolean — the HTTP status code is the canonical signal for success/failure. The body is always exactly one of two shapes, `data` or `error`, and the payload is always nested one level down under that key.

**Success:**

```json
{
  "data": {
    "order": { "orderNumber": "NC-000123", "status": "PENDING_PAYMENT" }
  }
}
```

**Error:**

```json
{
  "error": {
    "code": "CART_REQUIRES_UPDATE",
    "message": "Some items in your cart need attention.",
    "details": { "issues": [], "items": [] }
  }
}
```

Guidelines:

* `data` always wraps the payload — even a list response: `{ "data": { "products": [...], "pagination": {...} } }`, not a bare array at the top level.
* Never flatten the payload onto the response body — `data`/`error` are the only two possible top-level keys.
* Use standard HTTP status codes consistently: `200` read/update, `201` created, `204` action with no body, `401` missing/invalid auth, `403` authenticated-but-not-allowed, `404` missing resource, `409` state conflict (e.g. cancelling a shipped order), `422` validation failure, `500` unexpected. Pick the code that matches the `AppError` thrown.
* Webhooks (`/webhooks/payments`) verify the signature, enqueue the event, and respond `200` immediately — no business logic in the request.

### 10.1 API Documentation — Mandatory

`docs/openapi.yaml` (in the backend root, outside `src/`) is the **single, hand-written** OpenAPI 3.1 document for the whole API. It is the canonical reference for every route, and the frontend reads it to know what to call. Nothing generates it: the app serves the file as-is — Swagger UI at `/api/docs`, the raw YAML at `/api/docs/openapi.yaml`.

Because nothing keeps it in sync automatically, **any change to a route must be made in `openapi.yaml` in the same change — this is not optional and not a follow-up task.** That covers every route's:

* **Inputs** — path params, query params, headers, and request body fields.
* **Outputs** — the success response shape and every response field.
* **Data types** — a field's type, format, pattern, min/max, enum values, required/optional, or nullability.
* **Auth** — public (`security: []`), logged in (`security: [{ bearerAuth: [] }]`), or ADMIN (say so in the description).
* **Errors** — every status code and `AppError` code the route can return, with when each applies.
* **Existence** — a new path or method is added; a removed one is deleted.

How the file is organised:

* `paths` describe each endpoint and **point at shared shapes with `$ref`** (e.g. `$ref: "#/components/schemas/Order"`) instead of repeating them.
* Every data shape is defined **once** under `components/schemas` — request bodies (`…Input`), resources (`Order`, `AdminProduct`, …), and enums (`OrderStatus`, `Role`, …).
* Shared parameters live under `components/parameters`; shared responses (401, 403, 422, common 404s) under `components/responses`.
* If a shared shape changes (e.g. a field added to `Order`), change it once in `components/schemas` — every endpoint that `$ref`s it updates with it.
* Keep it in step with the code it describes: the Zod validator for inputs, the handler's `to…` view functions for outputs, `errors/error-codes.js` for error codes, and `constants/` for enum values.

Check the file is valid OpenAPI after editing (every `$ref` resolves):

```sh
npx @redocly/cli lint docs/openapi.yaml
```

---

## 11. Avoid Magic Values

Do not scatter unexplained numbers or strings throughout the code.

```js
// Avoid
if (Date.now() - order.paidAt > 86400000) {}
if (order.status === "PAID") {}
```

```js
// Prefer
if (Date.now() - order.paidAt > CUSTOMER_CANCEL_WINDOW_MS) {}
if (order.status === OrderStatuses.PAID) {}
```

Every status, role, type and reason enum from `plan.md` §4–5 lives in `src/app/constants/` and is imported everywhere it's used — models, handlers and validators. When an enum changes, update its matching enum in `openapi.yaml` too (§10.1).

---

## 12. Comments

Do not comment obvious code. Comments should explain **why**, not **what**.

```js
// Conditional flip HELD → RELEASED makes release idempotent: the expiry job
// and a payment-failure event can race without double-decrementing stock.
```

Never leave commented-out code — use version control instead.

---

## 13. Async, Concurrency and Data Integrity

Always properly handle asynchronous operations. Avoid floating promises unless intentionally detached (and explain why in a comment).

Run independent operations concurrently:

```js
const [order, transactions] = await Promise.all([
  findOrderById(orderId),
  findTransactionsByOrderId(orderId),
]);
```

Do not use `Promise.all()` when one operation depends on the result of another.

### 13.1 MongoDB transactions

Any operation that writes more than one document that must stay consistent (reserve inventory + create order, release reservation + update order, fulfil) runs inside a single MongoDB transaction owned by the **handler**. The handler starts the session and passes it to every repository call as `{ session }`.

```js
await mongoose.connection.transaction(async (session) => {
  await reserveStock({ sku, quantity, session });
  await createOrderRepo({ order, session });
});
```

Side effects that must not roll back or must not run twice — enqueuing jobs, calling the payment provider, sending email — happen **after** the transaction commits.

### 13.2 Inventory rules

* Reserve with a **conditional update** (`findOneAndUpdate` with the availability check in the filter + `$inc`) — never read-check-then-write.
* `available = stock - reserved` is always computed, never stored.
* Release and fulfil flip `reservationStatus` conditionally first so they run exactly once (idempotent).
* Products are hidden via `publicityStatus`, never deleted.

### 13.3 Money

All money is stored and computed as **integers in minor units (kobo)**. Use `money.util.js` for any arithmetic or formatting — never floats, never `toFixed` on stored values. Orders snapshot item name, image and unit price at creation.

### 13.4 Background jobs

* Queue names and job payload shapes are defined once in `src/app/queues/` and imported by both the API and the worker.
* Job processors must be idempotent (payment events are keyed by `providerReference`), because BullMQ may retry.
* Anything slow or third-party (emails, refunds, payment webhooks) goes through a queue, not the request.

---

## 14. Validation

Validate external input at every application boundary with Zod: HTTP requests (body, params, query via `validate.middleware.js`), webhooks, queue job payloads, external API responses, and environment variables. Never assume external data is valid. Validation happens before business logic executes, and a failed validation throws an `AppError` with `code: ErrorCodes.VALIDATION_ERROR`, with the per-field messages in `details`.

---

## 15. Configuration, Auth and Environment Variables

Never hardcode secrets, credentials, URLs, or environment-specific configuration. `src/configs/env.config.js` parses `process.env` with a Zod schema at startup and exports the typed result; the app fails fast if critical configuration is missing. Every new variable is added to `.env.example` in the same change.

Auth follows `plan.md` §3 exactly:

* Access token: signed JWT (~15 min, payload `{ sub, role }`), returned in the response body only.
* Refresh token: opaque UUID, stored as `session:<token>` in Redis and set as an `httpOnly`, `secure`, `sameSite` cookie scoped to `/api/v1/auth`.
* All Redis key building goes through `session.util.js` — never hand-build `session:`/`user_sessions:`/`pwreset:` keys elsewhere.
* Password reset/change and disabling an account always call `revokeAllSessions`.
* Never log passwords, tokens, reset codes or full payment payloads.

---

## 16. Code Quality Rules

Always prefer:

```text
Clear > Clever
Simple > Over-engineered
Explicit > Implicit
Readable > Short
Maintainable > Fast to write
```

Do not optimize prematurely. Do not build abstractions for hypothetical future requirements. Refactor when duplication or complexity becomes real, not merely because abstraction is possible. Open decisions in `plan.md` §9 (payment/email provider, shipping, hold time) stay behind their adapter or config value — don't hardcode a guess.

---

## 17. Before Completing Any Implementation

Before considering a task complete, verify:

* Functions are `const`-assigned arrow functions, exported by name (Section 6).
* Every function has a JSDoc block above it, including usage sites of third-party functions (Section 6.4).
* Internal imports use the `#alias/*` subpath pattern, correctly ordered (Section 5).
* Naming is clear, consistent, and matches Section 3/4 conventions.
* No unused code, imports, or commented-out blocks remain.
* No duplicated logic was introduced where an existing utility could be reused.
* Errors are thrown as `AppError` with a registered `code`, never swallowed silently (Section 9).
* API responses follow the `{ data }` / `{ error }` envelope (Section 10).
* If a route was added/removed or its inputs, outputs, data types, auth or errors changed, `openapi.yaml` was updated to match and still lints clean — strictly required, no exceptions (Section 10.1).
* External input is validated with Zod at the boundary before business logic runs (Section 14).
* Multi-document writes run in a transaction; side effects run after commit (Section 13.1).
* Money is integer kobo; statuses/roles come from constants (Sections 11, 13.3).
* Async operations are properly awaited; no unexplained floating promises.
* No secrets or environment-specific values are hardcoded; new env vars are in `.env.example`.
* The implementation stays consistent with the existing architecture (Section 7) unless there's a clear, deliberate reason to change it.
