// End-to-end test of the whole API, in the style of logistics-system-backend/__test__.mjs.
//
// Runs against a LIVE API + worker. Start both against a throwaway database first, e.g.:
//   MONGO_URI="mongodb://localhost:27017/northcut_test?replicaSet=rs0" ORDER_HOLD_MINUTES=1 SHIPPING_FEE_KOBO=150000 npm run dev
//   (same env) npm run dev:worker
// then:  MONGO_URI="…northcut_test…" node __test__.mjs
//
// ORDER_HOLD_MINUTES=1 lets the expiry section finish in about a minute.
// SHIPPING_FEE_KOBO=150000 (₦1,500) is what the totals checks expect.
import "dotenv/config";
import { createHmac } from "node:crypto";

import bcrypt from "bcrypt";
import { Queue } from "bullmq";
import mongoose from "mongoose";

import { User } from "#models/user.model.js";

const API = process.env.TEST_API_URL ?? "http://127.0.0.1:4000";
const BASE = `${API}/api/v1`;
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/northcut_test?replicaSet=rs0";
const SHIPPING_FEE = Number(process.env.TEST_SHIPPING_FEE_KOBO ?? 150000);
const HOLD_MS = Number(process.env.TEST_ORDER_HOLD_MINUTES ?? 1) * 60 * 1000;

let passCount = 0;
let failCount = 0;
const failures = [];

const check = (label, condition, extra) => {
  if (condition) {
    passCount += 1;
    console.log(`PASS: ${label}`);
  } else {
    failCount += 1;
    failures.push(label);
    console.log(`FAIL: ${label}` + (extra !== undefined ? ` -- ${JSON.stringify(extra).slice(0, 600)}` : ""));
  }
};

const section = (title) => console.log(`\n================= ${title} =================`);

const extractCookie = (res) => {
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : null;
};

const request = async (method, path, { body, token, cookie, rawBody, headers: extraHeaders = {}, form } = {}) => {
  const headers = { ...extraHeaders };
  if (!form) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ?? rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  let json = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 200) };
    }
  }
  return { status: res.status, json, cookie: extractCookie(res) };
};

const rand = () => Math.random().toString(36).slice(2, 8);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Re-runs `fn` until `isDone(result)` or the timeout — for things the worker does asynchronously.
const poll = async (fn, isDone, { timeoutMs = 20000, intervalMs = 500 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let result = await fn();
  while (!isDone(result) && Date.now() < deadline) {
    await sleep(intervalMs);
    result = await fn();
  }
  return result;
};

const address = (overrides = {}) => ({
  label: "Home",
  fullName: "Ada Obi",
  phone: "+234 803 123 4567",
  line1: "12 Admiralty Way",
  city: "Lekki",
  state: "Lagos",
  country: "Nigeria",
  ...overrides,
});

const emailsQueue = new Queue("emails", { connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" } });

const findEmailJobs = async (to, template) => {
  const jobs = await emailsQueue.getJobs(["completed", "waiting", "active", "delayed", "failed"], 0, 1000);
  return jobs
    .filter((job) => job && job.data?.to === to && (!template || job.data.template === template))
    .sort((a, b) => b.timestamp - a.timestamp);
};

// Signs a webhook exactly like the mock provider does.
const sendSignedWebhook = (event, data) => {
  const rawBody = JSON.stringify({ event, data });
  const signature = createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return request("POST", "/webhooks/payments", { rawBody, headers: { "x-payment-signature": signature } });
};

// A 1×1 transparent PNG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// Starts with the JPEG signature (FF D8 FF), which is all the API checks; the worker does the real upload.
const JPEG_SIGNATURE_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

const main = async () => {
  await mongoose.connect(MONGO_URI);

  // ================= Health, 404, docs =================
  section("Health, 404, docs");
  {
    const res = await request("GET", "/health");
    check("GET /health -> 200 ok", res.status === 200 && res.json?.data?.health?.status === "ok", res);
  }
  {
    const res = await request("GET", "/nope-does-not-exist");
    check("Unknown route -> 404 ROUTE_NOT_FOUND", res.status === 404 && res.json?.error?.code === "ROUTE_NOT_FOUND", res);
  }
  {
    const res = await request("POST", "/auth/login", { rawBody: "{not json" });
    check("Malformed JSON -> 400 MALFORMED_JSON", res.status === 400 && res.json?.error?.code === "MALFORMED_JSON", res);
  }
  {
    const res = await fetch(`${API}/api/docs/`);
    const html = await res.text();
    check("Swagger UI served at /api/docs", res.status === 200 && html.includes("swagger"), res.status);
  }
  {
    const res = await fetch(`${API}/api/docs/openapi.yaml`);
    const yaml = await res.text();
    check("Raw openapi.yaml served", res.status === 200 && yaml.includes("openapi: 3.1.0") && yaml.includes("/orders/{orderNumber}/cancel:"), res.status);
  }
  {
    const res = await fetch(`${API}/api/docs/swagger-ui-init.js`);
    const script = await res.text();
    check("Swagger UI loads the YAML file", script.includes("/api/docs/openapi.yaml"), script.slice(0, 200));
  }

  // ================= Auth =================
  section("Auth");
  const customerEmail = `customer.${rand()}@example.com`;
  let customerPassword = "CustomerPass123!";
  let customerToken;
  let customerCookie;
  {
    const res = await request("POST", "/auth/signup", {
      body: { name: "Cara Customer", email: customerEmail.toUpperCase(), password: customerPassword },
    });
    check("Signup -> 201 with token + user", res.status === 201 && !!res.json?.data?.accessToken, res);
    check("Signup lowercases email", res.json?.data?.user?.email === customerEmail, res.json?.data?.user);
    check("Signup response has no passwordHash", res.json?.data?.user?.passwordHash === undefined);
    check("Signup sets refresh cookie", res.cookie?.startsWith("refreshToken="), res.cookie);
    customerToken = res.json?.data?.accessToken;
    customerCookie = res.cookie;
  }
  {
    const res = await request("POST", "/auth/signup", { body: { name: "Cara Two", email: customerEmail, password: customerPassword } });
    check("Signup duplicate email -> 409 EMAIL_ALREADY_REGISTERED", res.status === 409 && res.json?.error?.code === "EMAIL_ALREADY_REGISTERED", res);
  }
  {
    const res = await request("POST", "/auth/signup", { body: { name: "X", email: "not-an-email", password: "short" } });
    const fields = res.json?.error?.details?.fields?.map((field) => field.path) ?? [];
    check("Signup invalid -> 422 with per-field details", res.status === 422 && fields.includes("email") && fields.includes("password"), res);
  }
  {
    const res = await request("POST", "/auth/login", { body: { email: customerEmail, password: "WrongPass!" } });
    check("Login wrong password -> 401 INVALID_CREDENTIALS", res.status === 401 && res.json?.error?.code === "INVALID_CREDENTIALS", res);
  }
  {
    const res = await request("POST", "/auth/login", { body: { email: "nobody@example.com", password: "whatever1" } });
    check("Login unknown email -> 401 INVALID_CREDENTIALS", res.status === 401 && res.json?.error?.code === "INVALID_CREDENTIALS", res);
  }
  {
    const res = await request("GET", "/me");
    check("GET /me without token -> 401", res.status === 401 && res.json?.error?.code === "UNAUTHORIZED", res);
  }
  {
    const res = await request("GET", "/me", { token: "not.a.jwt" });
    check("GET /me with garbage token -> 401", res.status === 401, res);
  }
  {
    const res = await request("POST", "/auth/refresh", { cookie: customerCookie });
    check("Refresh with cookie -> 200 new token", res.status === 200 && !!res.json?.data?.accessToken, res);
  }
  {
    const res = await request("POST", "/auth/refresh");
    check("Refresh without cookie -> 401", res.status === 401, res);
  }
  {
    const res = await request("GET", "/admin/products", { token: customerToken });
    check("Customer on admin route -> 403 FORBIDDEN", res.status === 403 && res.json?.error?.code === "FORBIDDEN", res);
  }

  // Password reset
  {
    const res = await request("POST", "/auth/password-reset/request", { body: { email: customerEmail } });
    check("Reset request -> 204", res.status === 204, res);
  }
  {
    const res = await request("POST", "/auth/password-reset/request", { body: { email: "nobody-registered@example.com" } });
    check("Reset request for unknown email -> 204 (no enumeration)", res.status === 204, res);
  }
  const [resetJob] = await findEmailJobs(customerEmail, "PASSWORD_RESET_CODE");
  const resetCode = resetJob?.data?.data?.code;
  check("Reset code email was queued", /^\d{6}$/.test(resetCode ?? ""), resetJob?.data);
  {
    const wrongCode = resetCode === "000000" ? "111111" : "000000";
    const res = await request("POST", "/auth/password-reset/verify", { body: { email: customerEmail, code: wrongCode } });
    check("Verify wrong code -> 400 INVALID_RESET_CODE", res.status === 400 && res.json?.error?.code === "INVALID_RESET_CODE", res);
  }
  let resetToken;
  {
    const res = await request("POST", "/auth/password-reset/verify", { body: { email: customerEmail, code: resetCode } });
    check("Verify correct code -> 200 resetToken", res.status === 200 && !!res.json?.data?.resetToken, res);
    resetToken = res.json?.data?.resetToken;
  }
  {
    const res = await request("POST", "/auth/password-reset/verify", { body: { email: customerEmail, code: resetCode } });
    check("Reset code is single-use", res.status === 400, res);
  }
  {
    const res = await request("POST", "/auth/password-reset/complete", { body: { resetToken, password: "NewPassword123!" } });
    check("Complete reset -> 204", res.status === 204, res);
  }
  {
    const res = await request("POST", "/auth/password-reset/complete", { body: { resetToken, password: "Another123!" } });
    check("Reset token is single-use -> 400 INVALID_RESET_TOKEN", res.status === 400 && res.json?.error?.code === "INVALID_RESET_TOKEN", res);
  }
  {
    const res = await request("POST", "/auth/refresh", { cookie: customerCookie });
    check("Reset revoked existing sessions (refresh -> 401)", res.status === 401, res);
  }
  {
    const res = await request("POST", "/auth/login", { body: { email: customerEmail, password: customerPassword } });
    check("Old password fails after reset", res.status === 401, res);
  }
  customerPassword = "NewPassword123!";
  {
    const res = await request("POST", "/auth/login", { body: { email: customerEmail, password: customerPassword } });
    check("New password works", res.status === 200, res);
    customerToken = res.json?.data?.accessToken;
    customerCookie = res.cookie;
  }

  // ================= Admin seed =================
  section("Admin seed");
  const adminEmail = `admin.${rand()}@example.com`;
  const adminPassword = "AdminPass123!";
  await User.create({ name: "Test Admin", email: adminEmail, passwordHash: await bcrypt.hash(adminPassword, 10), role: "ADMIN" });
  let adminToken;
  {
    const res = await request("POST", "/auth/login", { body: { email: adminEmail, password: adminPassword } });
    check("Admin login -> 200 role ADMIN", res.status === 200 && res.json?.data?.user?.role === "ADMIN", res);
    adminToken = res.json?.data?.accessToken;
  }
  const admin = { token: adminToken };
  const getAdminProduct = async (id) => (await request("GET", `/admin/products/${id}`, admin)).json?.data?.product;

  // ================= Catalog =================
  section("Catalog (admin + public)");
  const runTag = rand();
  const skuBase = `T${runTag.toUpperCase()}`;
  let tee;
  {
    const res = await request("POST", "/admin/products", {
      ...admin,
      body: {
        name: `Classic Tee ${runTag} — Black`,
        sku: `${skuBase}-TEE`,
        description: "Heavyweight cotton.",
        tags: ["Tees", "essentials", "tees"],
        pricing: { launchPrice: 1250000 },
        availabilityStatus: "IN_STOCK",
        publicityStatus: "PUBLIC",
        stock: 10,
      },
    });
    tee = res.json?.data?.product;
    check("Create product -> 201", res.status === 201 && !!tee?.id, res);
    check("Slug generated from name", tee?.slug === `classic-tee-${runTag}-black`, tee?.slug);
    check("SKU uppercased", tee?.sku === `${skuBase}-TEE`, tee?.sku);
    check("Tags lowercased + de-duplicated", JSON.stringify(tee?.tags) === JSON.stringify(["tees", "essentials"]), tee?.tags);
    check("availableStock virtual = 10", tee?.availableStock === 10, tee);
  }
  {
    const res = await request("POST", "/admin/products", {
      ...admin,
      body: { name: `Other ${runTag}`, sku: `${skuBase}-TEE`, pricing: { launchPrice: 100 } },
    });
    check("Duplicate SKU -> 409 SKU_ALREADY_EXISTS", res.status === 409 && res.json?.error?.code === "SKU_ALREADY_EXISTS", res);
  }
  {
    const res = await request("POST", "/admin/products", {
      ...admin,
      body: { name: `Classic Tee ${runTag} Black`, sku: `${skuBase}-X2`, pricing: { launchPrice: 100 } },
    });
    check("Duplicate slug -> 409 SLUG_ALREADY_EXISTS", res.status === 409 && res.json?.error?.code === "SLUG_ALREADY_EXISTS", res);
  }
  {
    const res = await request("POST", "/admin/products", {
      ...admin,
      body: { name: `Preorder No Price ${runTag}`, sku: `${skuBase}-NP`, pricing: { launchPrice: 100 }, availabilityStatus: "PRE_ORDER" },
    });
    check("PRE_ORDER without preorder price -> 422 PREORDER_PRICE_REQUIRED", res.status === 422 && res.json?.error?.code === "PREORDER_PRICE_REQUIRED", res);
  }
  {
    const res = await request("POST", "/admin/products", { ...admin, body: { name: "Bad", sku: "a", pricing: { launchPrice: 12.5 } } });
    check("Invalid product -> 422 VALIDATION_ERROR", res.status === 422 && res.json?.error?.code === "VALIDATION_ERROR", res);
  }
  {
    const res = await request("PATCH", `/admin/products/${tee.id}`, { ...admin, body: { sku: "CHANGED" } });
    check("Changing SKU is rejected -> 422", res.status === 422, res);
  }
  {
    const res = await request("PATCH", `/admin/products/${tee.id}`, { ...admin, body: { description: "Updated.", pricing: {} } });
    check("Partial update -> 200", res.status === 200 && res.json?.data?.product?.description === "Updated.", res);
  }
  {
    const res = await request("PATCH", `/admin/products/${tee.id}/stock`, { ...admin, body: { adjustment: 5, reason: "Restock" } });
    check("Stock +5 -> 15", res.status === 200 && res.json?.data?.product?.stock === 15, res);
  }
  {
    const res = await request("PATCH", `/admin/products/${tee.id}/stock`, { ...admin, body: { adjustment: 0 } });
    check("Stock adjustment of 0 -> 422", res.status === 422, res);
  }
  let hidden;
  {
    const res = await request("POST", "/admin/products", {
      ...admin,
      body: { name: `Secret Hoodie ${runTag}`, sku: `${skuBase}-HID`, pricing: { launchPrice: 3000000 }, availabilityStatus: "IN_STOCK", stock: 5 },
    });
    hidden = res.json?.data?.product;
    check("New products default to HIDDEN", hidden?.publicityStatus === "HIDDEN", hidden);
  }
  {
    const res = await request("GET", "/products?limit=50");
    const skus = res.json?.data?.products?.map((product) => product.sku) ?? [];
    check("Public list includes public product", skus.includes(tee.sku), skus);
    check("Public list excludes hidden product", !skus.includes(hidden.sku), skus);
    const publicTee = res.json?.data?.products?.find((product) => product.sku === tee.sku);
    check("Public product has price + availableQuantity, no counters", publicTee?.price === 1250000 && publicTee?.availableQuantity === 15 && publicTee?.stock === undefined, publicTee);
  }
  {
    const res = await request("GET", "/products?tag=essentials&limit=50");
    check("Tag filter", res.json?.data?.products?.some((product) => product.sku === tee.sku), res.json?.data?.products?.length);
  }
  {
    const res = await request("GET", `/products/${tee.slug}`);
    check("Public detail by slug -> 200", res.status === 200 && res.json?.data?.product?.sku === tee.sku, res);
  }
  {
    const res = await request("GET", `/products/${hidden.slug}`);
    check("Hidden product detail -> 404 PRODUCT_NOT_FOUND", res.status === 404 && res.json?.error?.code === "PRODUCT_NOT_FOUND", res);
  }
  {
    const res = await request("GET", "/admin/products?search=secret&publicityStatus=HIDDEN", admin);
    check("Admin search + filter", res.json?.data?.products?.some((product) => product.id === hidden.id), res.json?.data?.pagination);
  }
  // Images — validated by the API, uploaded to Cloudinary later by the worker (so the API answers 202)
  {
    const form = new FormData();
    const res = await request("POST", `/admin/products/${tee.id}/images`, { ...admin, form });
    check("Upload with no file -> 400 INVALID_UPLOAD", res.status === 400 && res.json?.error?.code === "INVALID_UPLOAD", res);
  }
  {
    const form = new FormData();
    form.append("images", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
    const res = await request("POST", `/admin/products/${tee.id}/images`, { ...admin, form });
    check("Upload non-image -> 400 INVALID_UPLOAD", res.status === 400 && res.json?.error?.code === "INVALID_UPLOAD", res);
  }
  {
    const form = new FormData();
    form.append("images", new Blob([TINY_PNG], { type: "image/png" }), "pixel.png");
    const res = await request("POST", `/admin/products/${tee.id}/images`, { ...admin, form });
    check("Upload PNG -> 400 INVALID_UPLOAD (JPEG only)", res.status === 400 && res.json?.error?.code === "INVALID_UPLOAD", res);
  }
  {
    const form = new FormData();
    form.append("images", new Blob([TINY_PNG], { type: "image/jpeg" }), "fake.jpg");
    const res = await request("POST", `/admin/products/${tee.id}/images`, { ...admin, form });
    check("Upload PNG bytes labelled JPEG -> 400 INVALID_UPLOAD", res.status === 400 && res.json?.error?.code === "INVALID_UPLOAD", res);
  }
  {
    const form = new FormData();
    for (let index = 0; index < 5; index += 1) {
      form.append("images", new Blob([JPEG_SIGNATURE_BYTES], { type: "image/jpeg" }), `photo-${index}.jpg`);
    }
    const res = await request("POST", `/admin/products/${tee.id}/images`, { ...admin, form });
    check("Upload 5 images -> 400 INVALID_UPLOAD (max 4)", res.status === 400 && res.json?.error?.code === "INVALID_UPLOAD", res);
  }
  {
    const form = new FormData();
    form.append("images", new Blob([JPEG_SIGNATURE_BYTES], { type: "image/jpeg" }), "photo.jpg");
    const res = await request("POST", `/admin/products/${tee.id}/images`, { ...admin, form });
    check("Upload JPEG -> 202 PROCESSING (queued for the worker)",
      res.status === 202 && res.json?.data?.upload?.status === "PROCESSING" && res.json?.data?.upload?.imageCount === 1, res);
  }

  // ================= Profile =================
  section("Profile, addresses, favourites");
  const customer = { token: customerToken };
  {
    const res = await request("GET", "/me", customer);
    check("GET /me -> profile", res.status === 200 && res.json?.data?.profile?.email === customerEmail, res);
  }
  {
    const res = await request("PATCH", "/me", { ...customer, body: { name: "Cara Renamed" } });
    check("PATCH /me name", res.status === 200 && res.json?.data?.profile?.name === "Cara Renamed", res);
  }
  {
    const res = await request("PATCH", "/me", { ...customer, body: { email: "x@y.com" } });
    check("PATCH /me email is rejected -> 422", res.status === 422, res);
  }
  let homeAddress;
  let workAddress;
  {
    const res = await request("POST", "/me/addresses", { ...customer, body: address() });
    homeAddress = res.json?.data?.addresses?.[0];
    check("First address becomes default", res.status === 201 && homeAddress?.isDefault === true, res);
  }
  {
    const res = await request("POST", "/me/addresses", { ...customer, body: address({ label: "Work", line1: "1 Office Rd", isDefault: true }) });
    const addresses = res.json?.data?.addresses ?? [];
    workAddress = addresses.find((item) => item.label === "Work");
    check("New default address clears the old default", workAddress?.isDefault && addresses.filter((item) => item.isDefault).length === 1, addresses);
  }
  {
    const res = await request("POST", "/me/addresses", { ...customer, body: address({ label: "home", line1: "2 Other St" }) });
    check("Duplicate label (any case) -> 409 ADDRESS_LABEL_TAKEN", res.status === 409 && res.json?.error?.code === "ADDRESS_LABEL_TAKEN", res);
  }
  {
    const { label, ...unlabelled } = address({ line1: "3 No Label St" });
    const res = await request("POST", "/me/addresses", { ...customer, body: unlabelled });
    check("Address without a label -> 422", res.status === 422, res);
  }
  {
    const res = await request("PATCH", `/me/addresses/${homeAddress.id}`, { ...customer, body: { city: "Ikoyi" } });
    const updated = res.json?.data?.addresses?.find((item) => item.id === homeAddress.id);
    check("Edit address", res.status === 200 && updated?.city === "Ikoyi", res);
  }
  {
    const res = await request("DELETE", `/me/addresses/${workAddress.id}`, customer);
    const addresses = res.json?.data?.addresses ?? [];
    check("Deleting default passes default on", addresses.length === 1 && addresses[0].isDefault === true, addresses);
  }
  {
    const res = await request("PATCH", "/me/addresses/64b000000000000000000000", { ...customer, body: { city: "Yaba" } });
    check("Edit missing address -> 404 ADDRESS_NOT_FOUND", res.status === 404 && res.json?.error?.code === "ADDRESS_NOT_FOUND", res);
  }
  {
    const res = await request("PUT", `/me/favourites/${tee.sku}`, customer);
    check("Add favourite -> 204", res.status === 204, res);
  }
  {
    const res = await request("PUT", `/me/favourites/${tee.sku}`, customer);
    check("Add favourite twice is idempotent", res.status === 204, res);
  }
  {
    const res = await request("PUT", `/me/favourites/${hidden.sku}`, customer);
    check("Favourite hidden product -> 404", res.status === 404, res);
  }
  {
    const res = await request("GET", "/me/favourites", customer);
    check("List favourites", res.json?.data?.products?.length === 1 && res.json.data.products[0].sku === tee.sku, res);
  }
  {
    const res = await request("DELETE", `/me/favourites/${tee.sku}`, customer);
    const list = await request("GET", "/me/favourites", customer);
    check("Remove favourite", res.status === 204 && list.json?.data?.products?.length === 0, list);
  }
  // Change password: keeps this device, logs out others
  {
    const other = await request("POST", "/auth/login", { body: { email: customerEmail, password: customerPassword } });
    const wrong = await request("PATCH", "/auth/password", { ...customer, cookie: customerCookie, body: { currentPassword: "nope", newPassword: "Changed123!" } });
    check("Change password with wrong current -> 400 INVALID_CURRENT_PASSWORD", wrong.status === 400 && wrong.json?.error?.code === "INVALID_CURRENT_PASSWORD", wrong);
    const same = await request("PATCH", "/auth/password", { ...customer, cookie: customerCookie, body: { currentPassword: customerPassword, newPassword: customerPassword } });
    check("Change to the same password -> 422", same.status === 422, same);
    const ok = await request("PATCH", "/auth/password", { ...customer, cookie: customerCookie, body: { currentPassword: customerPassword, newPassword: "Changed123!" } });
    check("Change password -> 204", ok.status === 204, ok);
    customerPassword = "Changed123!";
    const thisDevice = await request("POST", "/auth/refresh", { cookie: customerCookie });
    check("This device stays logged in", thisDevice.status === 200, thisDevice);
    const otherDevice = await request("POST", "/auth/refresh", { cookie: other.cookie });
    check("Other device is logged out", otherDevice.status === 401, otherDevice);
  }

  // ================= Cart =================
  section("Cart preview");
  let preorderProduct;
  {
    const res = await request("POST", "/admin/products", {
      ...admin,
      body: {
        name: `Launch Jacket ${runTag}`,
        sku: `${skuBase}-JKT`,
        pricing: { launchPrice: 5000000, preorderPrice: 4000000 },
        availabilityStatus: "PRE_ORDER",
        publicityStatus: "PUBLIC",
        preorderLimit: 3,
      },
    });
    preorderProduct = res.json?.data?.product;
    check("Create pre-order product", res.status === 201 && preorderProduct?.availablePreorderSpots === 3, res);
  }
  {
    const res = await request("POST", "/cart/preview", {
      body: {
        items: [
          { sku: tee.sku, quantity: 2 },
          { sku: "NOPE-NOPE", quantity: 1 },
          { sku: preorderProduct.sku, quantity: 1 },
          { sku: hidden.sku, quantity: 1 },
        ],
      },
    });
    const preview = res.json?.data?.preview;
    const reasons = Object.fromEntries((preview?.issues ?? []).map((issue) => [issue.sku, issue.reason]));
    check("Preview -> 200 with one line per item", res.status === 200 && preview?.items?.length === 4, res);
    check("Preview reasons: NOT_FOUND / PRE_ORDER_ONLY / NOT_AVAILABLE",
      reasons["NOPE-NOPE"] === "NOT_FOUND" && reasons[preorderProduct.sku] === "PRE_ORDER_ONLY" && reasons[hidden.sku] === "NOT_AVAILABLE", reasons);
    check("Preview totals over issue-free lines + shipping",
      preview?.subtotal === 2500000 && preview?.shippingFee === SHIPPING_FEE && preview?.total === 2500000 + SHIPPING_FEE, preview);
  }
  {
    const res = await request("POST", "/cart/preview", { body: { items: [{ sku: tee.sku, quantity: 99 }, { sku: `${skuBase}-X`, quantity: 1 }] } });
    const issue = res.json?.data?.preview?.issues?.find((item) => item.sku === tee.sku);
    check("Quantity over max -> INVALID_QUANTITY", issue?.reason === "INVALID_QUANTITY", res.json?.data?.preview?.issues);
  }
  {
    const res = await request("POST", "/cart/preview", { body: { items: [{ sku: tee.sku, quantity: 16 }] } });
    const issue = res.json?.data?.preview?.issues?.[0];
    check("Quantity over available -> INSUFFICIENT_QUANTITY with availableQuantity", issue?.reason === "INSUFFICIENT_QUANTITY" && issue?.availableQuantity === 15, issue);
  }
  {
    const res = await request("POST", "/cart/preview", { body: { items: [] } });
    check("Empty cart preview -> 200, totals 0", res.status === 200 && res.json?.data?.preview?.total === 0, res);
  }
  {
    const res = await request("POST", "/cart/preview", { body: { items: [{ sku: tee.sku, quantity: 1 }, { sku: tee.sku, quantity: 1 }] } });
    check("Duplicate SKUs in cart -> 422", res.status === 422, res);
  }

  // ================= Orders =================
  section("Orders");
  const addressId = homeAddress.id;
  // Placed first and never paid — the expiry section at the end checks it.
  let expiringOrder;
  let expiringPayment;
  {
    const res = await request("POST", "/orders", { ...customer, body: { items: [{ sku: tee.sku, quantity: 1 }], shippingAddressId: addressId } });
    expiringOrder = res.json?.data?.order;
    expiringPayment = res.json?.data?.payment;
    check("Place order (will expire) -> 201", res.status === 201 && expiringOrder?.status === "PENDING_PAYMENT", res);
  }
  const expiringPlacedAt = Date.now();
  let orderA;
  let paymentA;
  {
    const res = await request("POST", "/orders", { ...customer, body: { items: [{ sku: tee.sku, quantity: 2 }], shippingAddressId: addressId } });
    orderA = res.json?.data?.order;
    paymentA = res.json?.data?.payment;
    check("Place order -> 201 PENDING_PAYMENT", res.status === 201 && orderA?.status === "PENDING_PAYMENT", res);
    check("Order number format", /^NC-\d{6}-[A-Z0-9]{6}$/.test(orderA?.orderNumber ?? ""), orderA?.orderNumber);
    check("Order totals include shipping", orderA?.subtotal === 2500000 && orderA?.total === 2500000 + SHIPPING_FEE, orderA);
    check("Order snapshots address", orderA?.shippingAddress?.city === "Ikoyi", orderA?.shippingAddress);
    check("Order response has canPay/canCancel", orderA?.canPay === true && orderA?.canCancel === true, orderA);
    check("Order response hides hold bookkeeping", orderA?.reservationStatus === undefined && orderA?.reservedFrom === undefined, orderA);
    check("Payment started with checkoutUrl", /\/mock-pay\/NCPAY-/.test(paymentA?.checkoutUrl ?? ""), paymentA);
  }
  {
    const product = await getAdminProduct(tee.id);
    check("Reserved = 3 after two orders (1 + 2)", product?.reserved === 3 && product?.availableStock === 12, product);
  }
  {
    const res = await request("POST", "/orders", { ...customer, body: { items: [{ sku: tee.sku, quantity: 13 }], shippingAddressId: addressId } });
    check("Order over available -> 422 CART_REQUIRES_UPDATE with issues",
      res.status === 422 && res.json?.error?.code === "CART_REQUIRES_UPDATE" && res.json?.error?.details?.issues?.[0]?.reason === "INSUFFICIENT_QUANTITY", res);
    const product = await getAdminProduct(tee.id);
    check("Failed order reserved nothing", product?.reserved === 3, product);
  }
  {
    const res = await request("POST", "/orders", { ...customer, body: { items: [{ sku: tee.sku, quantity: 1 }], shippingAddressId: "64b000000000000000000000" } });
    check("Order with unknown address -> 404 ADDRESS_NOT_FOUND", res.status === 404 && res.json?.error?.code === "ADDRESS_NOT_FOUND", res);
  }
  {
    const res = await request("POST", "/orders", { ...customer, body: { items: [{ sku: tee.sku, quantity: 1 }] } });
    check("Order without address -> 422", res.status === 422, res);
  }
  let orderB;
  {
    const res = await request("POST", "/orders", {
      ...customer,
      body: { items: [{ sku: tee.sku, quantity: 1 }], shippingAddress: address({ line1: "5 Garden St" }) },
    });
    orderB = res.json?.data?.order;
    const addresses = (await request("GET", "/me/addresses", customer)).json?.data?.addresses ?? [];
    check("One-off address -> order placed, address NOT saved to the address book",
      res.status === 201 && orderB?.shippingAddress?.line1 === "5 Garden St" && !addresses.some((item) => item.line1 === "5 Garden St"),
      { status: res.status, addresses });
  }
  {
    const res = await request("PATCH", `/orders/${orderB?.orderNumber}/shipping-address`, {
      ...customer,
      body: { shippingAddress: address({ line1: "9 New Lane" }) },
    });
    check("Change address on an unshipped order -> 200 with the new address",
      res.status === 200 && res.json?.data?.order?.shippingAddress?.line1 === "9 New Lane" && res.json?.data?.order?.canChangeAddress === true, res);
  }
  {
    const res = await request("GET", "/orders", customer);
    check("List my orders", res.status === 200 && res.json?.data?.orders?.length === 3, res.json?.data?.pagination);
  }
  {
    const res = await request("GET", `/orders/${orderA.orderNumber}`, customer);
    check("Get my order", res.status === 200 && res.json?.data?.order?.orderNumber === orderA.orderNumber, res);
  }
  {
    const otherCustomer = await request("POST", "/auth/signup", { body: { name: "Other Person", email: `other.${rand()}@example.com`, password: "OtherPass123!" } });
    const res = await request("GET", `/orders/${orderA.orderNumber}`, { token: otherCustomer.json?.data?.accessToken });
    check("Another customer can't see my order -> 404", res.status === 404, res);
  }
  {
    const res = await request("POST", `/orders/${orderB.orderNumber}/cancel`, { ...customer, body: { reason: "Changed my mind" } });
    check("Cancel unpaid order -> CANCELLED", res.status === 200 && res.json?.data?.order?.status === "CANCELLED", res);
    const product = await getAdminProduct(tee.id);
    check("Cancel released stock (reserved back to 3)", product?.reserved === 3, product);
    const again = await request("POST", `/orders/${orderB.orderNumber}/cancel`, { ...customer, body: {} });
    check("Cancel again -> 409 ORDER_NOT_CANCELLABLE", again.status === 409 && again.json?.error?.code === "ORDER_NOT_CANCELLABLE", again);
  }

  // ================= Payments =================
  section("Payments (mock gateway -> webhook -> worker)");
  const getMyOrder = async (orderNumber) => (await request("GET", `/orders/${orderNumber}`, customer)).json?.data?.order;
  const getAdminOrder = async (orderId) => (await request("GET", `/admin/orders/${orderId}`, admin)).json?.data?.order;
  const refA = paymentA.reference;
  {
    const res = await request("GET", `/mock-gateway/payments/${refA}`);
    check("Mock gateway shows the payment", res.status === 200 && res.json?.data?.payment?.amount === orderA.total, res);
  }
  {
    const res = await request("POST", `/mock-gateway/payments/${refA}/complete`, { body: { outcome: "failure" } });
    check("Mock gateway: simulate failure", res.status === 200 && res.json?.data?.result?.status === "FAILED", res);
    const order = await poll(() => getAdminOrder(orderA.id), (value) => value?.transactions?.[0]?.status === "FAILED");
    check("Failed payment recorded as FAILED transaction", order?.transactions?.[0]?.status === "FAILED", order?.transactions);
    check("Order still awaiting payment after a failure", order?.status === "PENDING_PAYMENT" && order?.reservationStatus === "HELD", order?.status);
  }
  let retryPayment;
  {
    const res = await request("POST", `/orders/${orderA.orderNumber}/payment`, customer);
    retryPayment = res.json?.data?.payment;
    check("Retry payment -> new reference", res.status === 201 && retryPayment?.reference && retryPayment.reference !== refA, res);
  }
  {
    const res = await request("POST", `/mock-gateway/payments/${retryPayment.reference}/complete`, { body: { outcome: "success" } });
    check("Mock gateway: pay", res.status === 200 && res.json?.data?.result?.status === "SUCCEEDED", res);
    const order = await poll(() => getMyOrder(orderA.orderNumber), (value) => value?.status === "PAID");
    check("Order becomes PAID via webhook + worker", order?.status === "PAID" && !!order?.paidAt, order);
    check("Paid order: canPay false, canCancel true", order?.canPay === false && order?.canCancel === true, order);
  }
  {
    const replay = await sendSignedWebhook("payment.succeeded", { reference: retryPayment.reference, amount: orderA.total, currency: "NGN" });
    check("Replayed webhook accepted -> 200", replay.status === 200, replay);
    await sleep(1500);
    const order = await getAdminOrder(orderA.id);
    const succeeded = order?.transactions?.filter((txn) => txn.status === "SUCCEEDED") ?? [];
    check("Duplicate webhook is harmless (one SUCCEEDED payment, still PAID)", succeeded.length === 1 && order?.status === "PAID", order?.transactions);
  }
  {
    const res = await request("POST", "/webhooks/payments", {
      rawBody: JSON.stringify({ event: "payment.succeeded", data: { reference: retryPayment.reference } }),
      headers: { "x-payment-signature": "0".repeat(64) },
    });
    check("Webhook with bad signature -> 401 INVALID_WEBHOOK_SIGNATURE", res.status === 401 && res.json?.error?.code === "INVALID_WEBHOOK_SIGNATURE", res);
  }
  {
    const res = await request("POST", `/orders/${orderA.orderNumber}/payment`, customer);
    check("Pay an already-paid order -> 409 PAYMENT_NOT_ALLOWED", res.status === 409 && res.json?.error?.code === "PAYMENT_NOT_ALLOWED", res);
  }

  // Paid order cancelled by the customer -> refund
  let orderC;
  {
    const placed = await request("POST", "/orders", { ...customer, body: { items: [{ sku: tee.sku, quantity: 1 }], shippingAddressId: addressId } });
    orderC = placed.json?.data?.order;
    await request("POST", `/mock-gateway/payments/${placed.json?.data?.payment?.reference}/complete`, { body: { outcome: "success" } });
    const paid = await poll(() => getMyOrder(orderC.orderNumber), (value) => value?.status === "PAID");
    check("Order C paid", paid?.status === "PAID", paid);
    const res = await request("POST", `/orders/${orderC.orderNumber}/cancel`, { ...customer, body: { reason: "Wrong size" } });
    check("Customer cancels paid order within 24h -> CANCELLED", res.status === 200 && res.json?.data?.order?.status === "CANCELLED", res);
    const withRefund = await poll(() => getAdminOrder(orderC.id), (value) => value?.transactions?.some((txn) => txn.type === "REFUND" && txn.status === "SUCCEEDED"));
    check("Refund transaction SUCCEEDED", withRefund?.transactions?.some((txn) => txn.type === "REFUND" && txn.status === "SUCCEEDED"), withRefund?.transactions);
  }

  // ================= Pre-orders =================
  section("Pre-orders and conversion");
  let preorder;
  {
    const res = await request("POST", "/orders/preorder", { ...customer, body: { sku: preorderProduct.sku, quantity: 2, shippingAddressId: addressId } });
    preorder = res.json?.data?.order;
    check("Place pre-order -> 201 at pre-order price", res.status === 201 && preorder?.type === "PREORDER" && preorder?.subtotal === 8000000, res);
    const product = await getAdminProduct(preorderProduct.id);
    check("Pre-order claims spots (preorderReserved = 2)", product?.preorderReserved === 2 && product?.reserved === 0, product);
    await request("POST", `/mock-gateway/payments/${res.json?.data?.payment?.reference}/complete`, { body: { outcome: "success" } });
    const paid = await poll(() => getMyOrder(preorder.orderNumber), (value) => value?.status === "PAID");
    check("Pre-order paid", paid?.status === "PAID", paid);
  }
  {
    const res = await request("POST", "/orders/preorder", { ...customer, body: { sku: preorderProduct.sku, quantity: 2, shippingAddressId: addressId } });
    check("Pre-order over remaining spots -> 409 PREORDER_UNAVAILABLE (1 left)",
      res.status === 409 && res.json?.error?.details?.reason === "INSUFFICIENT_QUANTITY" && res.json?.error?.details?.availableQuantity === 1, res);
  }
  {
    const res = await request("POST", "/orders/preorder", { ...customer, body: { sku: tee.sku, quantity: 1, shippingAddressId: addressId } });
    check("Pre-order an in-stock product -> 409 NOT_PRE_ORDER", res.status === 409 && res.json?.error?.details?.reason === "NOT_PRE_ORDER", res);
  }
  {
    const res = await request("PATCH", `/admin/orders/${preorder.id}/status`, { ...admin, body: { status: "SHIPPED" } });
    check("Ship pre-order before conversion -> 409 PREORDER_NOT_READY_TO_SHIP", res.status === 409 && res.json?.error?.code === "PREORDER_NOT_READY_TO_SHIP", res);
  }
  {
    const res = await request("PATCH", `/admin/products/${preorderProduct.id}`, { ...admin, body: { availabilityStatus: "OUT_OF_STOCK" } });
    check("PRE_ORDER -> OUT_OF_STOCK with claimed spots -> 409 PREORDERS_PENDING", res.status === 409 && res.json?.error?.code === "PREORDERS_PENDING", res);
  }
  {
    const res = await request("PATCH", `/admin/products/${preorderProduct.id}`, { ...admin, body: { preorderLimit: 1 } });
    check("Pre-order limit below claimed -> 409 PREORDER_LIMIT_BELOW_RESERVED", res.status === 409 && res.json?.error?.code === "PREORDER_LIMIT_BELOW_RESERVED", res);
  }
  {
    const res = await request("PATCH", `/admin/products/${preorderProduct.id}`, { ...admin, body: { availabilityStatus: "IN_STOCK" } });
    check("Convert with no stock -> 409 INSUFFICIENT_STOCK_FOR_PREORDERS", res.status === 409 && res.json?.error?.code === "INSUFFICIENT_STOCK_FOR_PREORDERS", res);
  }
  {
    await request("PATCH", `/admin/products/${preorderProduct.id}/stock`, { ...admin, body: { adjustment: 5 } });
    const res = await request("PATCH", `/admin/products/${preorderProduct.id}`, { ...admin, body: { availabilityStatus: "IN_STOCK" } });
    const product = res.json?.data?.product;
    check("Convert with stock -> IN_STOCK, reserved 2, preorderReserved 0",
      res.status === 200 && product?.availabilityStatus === "IN_STOCK" && product?.reserved === 2 && product?.preorderReserved === 0, product);
    const order = await getAdminOrder(preorder.id);
    check("Held pre-order now reserved from STOCK", order?.reservedFrom === "STOCK", order?.reservedFrom);
  }

  // ================= Admin: fulfilment =================
  section("Admin orders");
  {
    const res = await request("GET", "/admin/orders?status=PAID", admin);
    const numbers = res.json?.data?.orders?.map((order) => order.orderNumber) ?? [];
    check("Admin list filtered by PAID", numbers.includes(orderA.orderNumber) && numbers.includes(preorder.orderNumber), numbers);
    check("Admin list shows customer", res.json?.data?.orders?.[0]?.customer?.email !== undefined, res.json?.data?.orders?.[0]);
  }
  {
    const res = await request("GET", `/admin/orders?search=${orderA.orderNumber.slice(0, 12)}`, admin);
    check("Admin search by order-number prefix", res.json?.data?.orders?.some((order) => order.orderNumber === orderA.orderNumber), res.json?.data?.pagination);
  }
  {
    const before = await getAdminProduct(tee.id);
    const res = await request("PATCH", `/admin/orders/${orderA.id}/status`, { ...admin, body: { status: "SHIPPED" } });
    const after = await getAdminProduct(tee.id);
    check("Ship paid order -> SHIPPED, hold FULFILLED", res.status === 200 && res.json?.data?.order?.status === "SHIPPED" && res.json?.data?.order?.reservationStatus === "FULFILLED", res);
    check("Shipping moves units out of stock and reserved", after.stock === before.stock - 2 && after.reserved === before.reserved - 2, { before, after });
  }
  {
    const res = await request("PATCH", `/admin/orders/${orderA.id}/status`, { ...admin, body: { status: "SHIPPED" } });
    check("Ship twice -> 409 INVALID_STATUS_TRANSITION", res.status === 409 && res.json?.error?.code === "INVALID_STATUS_TRANSITION", res);
  }
  {
    const res = await request("POST", `/orders/${orderA.orderNumber}/cancel`, { ...customer, body: {} });
    check("Customer can't cancel a shipped order -> 409", res.status === 409, res);
  }
  {
    const res = await request("PATCH", `/admin/orders/${orderA.id}/status`, { ...admin, body: { status: "DELIVERED" } });
    check("Mark delivered", res.status === 200 && res.json?.data?.order?.status === "DELIVERED" && !!res.json?.data?.order?.deliveredAt, res);
  }
  {
    const res = await request("POST", `/admin/orders/${orderA.id}/cancel`, { ...admin, body: { reason: "Too late" } });
    check("Admin can't cancel a delivered order -> 409", res.status === 409 && res.json?.error?.code === "ORDER_NOT_CANCELLABLE", res);
  }
  {
    const res = await request("PATCH", `/admin/orders/${preorder.id}/status`, { ...admin, body: { status: "SHIPPED" } });
    const product = await getAdminProduct(preorderProduct.id);
    check("Converted pre-order ships -> stock 3, reserved 0", res.status === 200 && product?.stock === 3 && product?.reserved === 0, product);
  }
  {
    const placed = await request("POST", "/orders", { ...customer, body: { items: [{ sku: tee.sku, quantity: 1 }], shippingAddressId: addressId } });
    const order = placed.json?.data?.order;
    await request("POST", `/mock-gateway/payments/${placed.json?.data?.payment?.reference}/complete`, { body: { outcome: "success" } });
    await poll(() => getMyOrder(order.orderNumber), (value) => value?.status === "PAID");
    const res = await request("POST", `/admin/orders/${order.id}/cancel`, { ...admin, body: { reason: "Damaged in warehouse" } });
    check("Admin cancels paid order", res.status === 200 && res.json?.data?.order?.cancellation?.by === "ADMIN", res);
    const refunded = await poll(() => getAdminOrder(order.id), (value) => value?.transactions?.some((txn) => txn.type === "REFUND" && txn.status === "SUCCEEDED"));
    check("Admin cancel refunds", refunded?.transactions?.some((txn) => txn.type === "REFUND" && txn.status === "SUCCEEDED"), refunded?.transactions);
  }
  {
    const product = await getAdminProduct(tee.id);
    const res = await request("PATCH", `/admin/products/${tee.id}/stock`, { ...admin, body: { adjustment: -product.stock } });
    check("Stock can't drop below reserved -> 409 STOCK_BELOW_RESERVED", res.status === 409 && res.json?.error?.code === "STOCK_BELOW_RESERVED", res);
  }

  // ================= Admin: transactions, customers, dashboard, logs =================
  section("Admin transactions, customers, dashboard, logs");
  {
    const res = await request("GET", "/admin/transactions?type=REFUND", admin);
    const refund = res.json?.data?.transactions?.[0];
    check("Admin transactions filter by REFUND", res.status === 200 && refund?.type === "REFUND" && !!refund?.order?.orderNumber, refund);
    const detail = await request("GET", `/admin/transactions/${refund?.id}`, admin);
    check("Transaction detail links the payment it refunds", detail.status === 200 && detail.json?.data?.transaction?.refundOf?.providerReference?.startsWith("NCPAY-"), detail.json?.data?.transaction);
  }
  let customerId;
  {
    const res = await request("GET", `/admin/customers?search=${encodeURIComponent(customerEmail)}`, admin);
    customerId = res.json?.data?.customers?.[0]?.id;
    check("Admin finds customer by email", !!customerId, res.json);
    const adminsListed = (await request("GET", `/admin/customers?search=${encodeURIComponent(adminEmail)}`, admin)).json?.data?.customers ?? [];
    check("Admins are never listed as customers", adminsListed.length === 0, adminsListed);
  }
  {
    const res = await request("GET", `/admin/customers/${customerId}`, admin);
    const stats = res.json?.data?.stats;
    check("Customer detail with stats + recent orders", res.status === 200 && stats?.orderCount >= 5 && res.json?.data?.recentOrders?.length >= 5, stats);
  }
  {
    const res = await request("PATCH", `/admin/customers/${customerId}/status`, { ...admin, body: { status: "DISABLED" } });
    check("Disable customer", res.status === 200 && res.json?.data?.customer?.status === "DISABLED", res);
    const refresh = await request("POST", "/auth/refresh", { cookie: customerCookie });
    check("Disabled customer is logged out (refresh -> 401)", refresh.status === 401, refresh);
    const login = await request("POST", "/auth/login", { body: { email: customerEmail, password: customerPassword } });
    check("Disabled customer can't log in -> 403 ACCOUNT_DISABLED", login.status === 403 && login.json?.error?.code === "ACCOUNT_DISABLED", login);
    await request("PATCH", `/admin/customers/${customerId}/status`, { ...admin, body: { status: "ACTIVE" } });
    const relogin = await request("POST", "/auth/login", { body: { email: customerEmail, password: customerPassword } });
    check("Re-enabled customer can log in", relogin.status === 200, relogin);
    customer.token = relogin.json?.data?.accessToken;
  }
  {
    const adminUser = await User.findOne({ email: adminEmail });
    const res = await request("PATCH", `/admin/customers/${adminUser.id}/status`, { ...admin, body: { status: "DISABLED" } });
    check("Can't disable an admin through customers -> 404", res.status === 404 && res.json?.error?.code === "CUSTOMER_NOT_FOUND", res);
  }
  {
    const res = await request("GET", "/admin/dashboard", admin);
    const dashboard = res.json?.data?.dashboard;
    check("Dashboard -> 200 with figures",
      res.status === 200 && dashboard?.revenue?.allTime > 0 && typeof dashboard?.orders?.byStatus?.PAID === "number" && dashboard?.customers?.total >= 2, dashboard);
  }
  {
    const res = await request("GET", "/admin/logs/system?limit=50", admin);
    const events = new Set(res.json?.data?.logs?.map((log) => log.event));
    check("System logs record ORDER_PAID, PAYMENT_FAILED, REFUND_SUCCEEDED",
      events.has("ORDER_PAID") && events.has("PAYMENT_FAILED") && events.has("REFUND_SUCCEEDED"), [...events]);
  }
  for (const action of ["ORDER_SHIPPED", "ORDER_CANCELLED_BY_ADMIN", "CUSTOMER_DISABLED", "PRODUCT_CREATED", "LOGIN", "ORDER_PLACED"]) {
    const res = await request("GET", `/admin/logs/users?action=${action}&limit=5`, admin);
    const [log] = res.json?.data?.logs ?? [];
    check(`User log recorded ${action} (with who did it)`, log?.action === action && !!log?.user?.email, res.json);
  }
  {
    const res = await request("GET", "/admin/logs/users?limit=51", admin);
    check("Logs page size is capped at 50 -> 422", res.status === 422, res.status);
  }

  // ================= Expiry + late payment =================
  section(`Expiry (waiting for the ${HOLD_MS / 1000}s hold)`);
  const waitMs = Math.max(0, expiringPlacedAt + HOLD_MS + 2000 - Date.now());
  if (waitMs) console.log(`...waiting ${Math.round(waitMs / 1000)}s for the order to expire`);
  await sleep(waitMs);
  {
    const order = await poll(() => getMyOrder(expiringOrder.orderNumber), (value) => value?.status === "EXPIRED", { timeoutMs: 30000 });
    check("Unpaid order expires", order?.status === "EXPIRED", order?.status);
    const adminView = await getAdminOrder(expiringOrder.id);
    check("Expired order released its hold", adminView?.reservationStatus === "RELEASED", adminView?.reservationStatus);
    check("Expired order's pending payment marked EXPIRED", adminView?.transactions?.[0]?.status === "EXPIRED", adminView?.transactions);
  }
  {
    const res = await request("POST", `/mock-gateway/payments/${expiringPayment.reference}/complete`, { body: { outcome: "success" } });
    check("Late payment on expired order goes through at the provider", res.status === 200, res);
    const order = await poll(() => getAdminOrder(expiringOrder.id), (value) => value?.transactions?.some((txn) => txn.type === "REFUND" && txn.status === "SUCCEEDED"));
    check("Late payment is recorded SUCCEEDED and refunded", order?.transactions?.some((txn) => txn.type === "PAYMENT" && txn.status === "SUCCEEDED") && order?.transactions?.some((txn) => txn.type === "REFUND" && txn.status === "SUCCEEDED"), order?.transactions);
    check("Order stays EXPIRED after late payment", order?.status === "EXPIRED", order?.status);
  }

  // ================= Emails =================
  section("Emails (queued + delivered by the worker)");
  {
    await sleep(1500);
    const jobs = await findEmailJobs(customerEmail);
    const templates = new Set(jobs.map((job) => job.data.template));
    for (const template of ["ORDER_PLACED", "ORDER_PAID", "ORDER_SHIPPED", "ORDER_CANCELLED", "ORDER_EXPIRED"]) {
      check(`${template} email queued`, templates.has(template), [...templates]);
    }
    const states = await Promise.all(jobs.map((job) => job.getState()));
    check("Every email job was delivered by the worker", states.every((state) => state === "completed"), states);
  }

  // ================= Summary =================
  console.log(`\n===== ${passCount} passed, ${failCount} failed =====`);
  if (failures.length) {
    console.log("Failures:");
    failures.forEach((failure) => console.log(" - " + failure));
  }

  await emailsQueue.close();
  await mongoose.disconnect();
  process.exitCode = failCount > 0 ? 1 : 0;
};

main().catch(async (error) => {
  console.error("TEST SCRIPT CRASHED:", error);
  await emailsQueue.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
