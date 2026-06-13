const http = require("http");
const fs   = require("fs");
const path = require("path");

// ── Load .env file ──────────────────────────────────────────────────────────
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    const envContent = fs.readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    });
  } catch { /* .env not found — rely on system env vars */ }
})();

const PORT             = Number(process.env.PORT || 4173);
const PUBLIC_BASE_URL  = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const TABBY_SECRET_KEY = process.env.TABBY_SECRET_KEY;   // sk_... secret key
const TABBY_PUBLIC_KEY = process.env.TABBY_PUBLIC_KEY;   // pk_... public key
const TABBY_MERCHANT_CODE = process.env.TABBY_MERCHANT_CODE || "AE";
const TABBY_API_BASE   = "https://api.tabby.ai";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".avif": "image/avif",
  ".svg":  "image/svg+xml",
  ".webp": "image/webp",
};

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type":                "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":"Content-Type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 200_000) { req.destroy(); reject(new Error("Body too large.")); }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("Invalid JSON.")); }
    });
  });
}

function tabbyHeaders() {
  return {
    "Authorization": `Bearer ${TABBY_SECRET_KEY}`,
    "Content-Type":  "application/json",
    "Accept":        "application/json",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Build Tabby payload
// ════════════════════════════════════════════════════════════════════════════

function buildTabbyPayload(p, includeRedirects = true) {
  const orderId = `OS-${Date.now()}`;
  const payload = {
    payment: {
      amount:      Number(p.amount).toFixed(2),
      currency:    "AED",
      description: p.service || "Over Seas Travel Service",
      buyer: {
        phone: p.phone || "",
        email: p.email || "",
        name:  p.name  || "",
        dob:   "1990-01-01",
      },
      buyer_history: {
        registered_since:             new Date().toISOString(),
        loyalty_level:                0,
        wishlist_count:               0,
        is_social_networks_connected: false,
        is_phone_number_verified:     false,
        is_email_verified:            false,
      },
      order: {
        tax_amount:      "0.00",
        shipping_amount: "0.00",
        discount_amount: "0.00",
        updated_at:      new Date().toISOString(),
        reference_id:    orderId,
        items: [{
          title:           p.service || "Travel Service",
          quantity:        1,
          unit_price:      Number(p.amount).toFixed(2),
          discount_amount: "0.00",
          reference_id:    "SERVICE-001",
          image_url:       `${PUBLIC_BASE_URL}/logo/logo.png`,
          product_url:     PUBLIC_BASE_URL,
          category:        "Travel",
        }],
      },
      order_history: [],
      meta: { order_id: orderId, customer: p.email || "" },
    },
    lang:          "ar",
    merchant_code: TABBY_MERCHANT_CODE,
  };

  if (includeRedirects) {
    payload.merchant_urls = {
      success: `${PUBLIC_BASE_URL}/payment.html?status=success`,
      cancel:  `${PUBLIC_BASE_URL}/payment.html?status=cancelled`,
      failure: `${PUBLIC_BASE_URL}/payment.html?status=failed`,
    };
  }

  return payload;
}

function extractWebUrl(data, preferredProduct) {
  const products = data?.configuration?.available_products;
  if (!products) return data?.web_url || null;

  // If a preferred product is specified, try that first
  if (preferredProduct && products[preferredProduct]) {
    const arr = products[preferredProduct];
    for (const item of arr) {
      if (item?.web_url) return item.web_url;
    }
  }

  // Otherwise, scan all product types for any valid web_url
  const productOrder = ['installments', 'credit_card_installments', 'pay_later', 'monthly'];
  for (const key of productOrder) {
    if (products[key]) {
      for (const item of products[key]) {
        if (item?.web_url) return item.web_url;
      }
    }
  }

  // Fallback: check any remaining product types
  for (const key of Object.keys(products)) {
    if (productOrder.includes(key)) continue;
    const arr = products[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item?.web_url) return item.web_url;
      }
    }
  }

  return data?.web_url || null;
}

function extractRejectionReason(data) {
  const installments = data?.configuration?.available_products?.installments;
  if (!installments || installments.length === 0) return "not_available";
  return installments[0]?.rejection_reason || "not_available";
}

// ════════════════════════════════════════════════════════════════════════════
// TEST MODE fallback (no secret key set)
// ════════════════════════════════════════════════════════════════════════════

function isTestMode() {
  return !TABBY_SECRET_KEY || TABBY_SECRET_KEY.length < 10;
}

function testModeLog(label, p) {
  console.log(`\n[TEST MODE] ${label}`);
  console.log("  Customer:", p.name || p.buyer_name || "-", "|", p.phone || p.buyer_phone || "-", "|", p.email || p.buyer_email || "-");
  console.log("  Service:", p.service || "-", "| Amount: AED", p.amount);
}

// ════════════════════════════════════════════════════════════════════════════
// Route: POST /api/tabby/eligibility
// Background pre-score as user fills the form
// ════════════════════════════════════════════════════════════════════════════

async function tabbyEligibility(req, res) {
  try {
    const p = await readJsonBody(req);

    if (!p.amount || !p.buyer_email || !p.buyer_phone) {
      return sendJson(res, 400, { eligible: false, rejection_reason: "missing_fields" });
    }

    if (isTestMode()) {
      console.log("[Tabby][TEST MODE] Eligibility — returning eligible (no secret key set)");
      return sendJson(res, 200, { eligible: true });
    }

    const payload   = buildTabbyPayload({
      amount:  p.amount,
      phone:   p.buyer_phone,
      email:   p.buyer_email,
      name:    p.buyer_name || "",
      service: "Eligibility Check",
    }, false);

    const tabbyRes  = await fetch(`${TABBY_API_BASE}/api/v2/checkout`, {
      method: "POST", headers: tabbyHeaders(), body: JSON.stringify(payload),
    });
    const tabbyData = await tabbyRes.json();

    console.log("[Tabby][eligibility] HTTP:", tabbyRes.status, "| status:", tabbyData?.status);

    if (tabbyData?.status === "rejected") {
      return sendJson(res, 200, { eligible: false, rejection_reason: extractRejectionReason(tabbyData) });
    }

    // "created" or anything else → eligible (fail open)
    return sendJson(res, 200, { eligible: true });

  } catch (err) {
    console.error("[Tabby][eligibility] error:", err.message);
    return sendJson(res, 200, { eligible: true }); // fail open
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Route: POST /api/tabby/checkout
// Creates session → returns web_url for redirect
// ════════════════════════════════════════════════════════════════════════════

async function tabbyCheckout(req, res) {
  try {
    const p = await readJsonBody(req);

    const missing = ["name","phone","email","service","amount"].find(f => !p[f]);
    if (missing) return sendJson(res, 400, { message: `Missing: ${missing}` });

    if (isTestMode()) {
      testModeLog("Tabby Checkout", p);
      // In test mode redirect to demo gateway page
      return sendJson(res, 200, { web_url: null, test_mode: true });
    }

    const payload   = buildTabbyPayload(p);
    const tabbyRes  = await fetch(`${TABBY_API_BASE}/api/v2/checkout`, {
      method: "POST", headers: tabbyHeaders(), body: JSON.stringify(payload),
    });
    const tabbyData = await tabbyRes.json();

    console.log("[Tabby][checkout] HTTP:", tabbyRes.status, "| status:", tabbyData?.status);

    if (tabbyData?.status === "rejected") {
      return sendJson(res, 200, { status: "rejected", rejection_reason: extractRejectionReason(tabbyData) });
    }

    const webUrl = extractWebUrl(tabbyData, p.payment_method);
    if (!webUrl) {
      console.error("[Tabby][checkout] Full response:", JSON.stringify(tabbyData, null, 2));
      return sendJson(res, 502, { message: "Tabby did not return a checkout URL. Check TABBY_SECRET_KEY and TABBY_MERCHANT_CODE." });
    }

    console.log("[Tabby][checkout] → Redirecting to:", webUrl);
    return sendJson(res, 200, { web_url: webUrl });

  } catch (err) {
    console.error("[Tabby][checkout] error:", err.message);
    return sendJson(res, 500, { message: err.message || "Unable to create Tabby checkout." });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Static file server
// ════════════════════════════════════════════════════════════════════════════

function serveStatic(req, res) {
  const reqUrl   = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end("Forbidden"); return; }

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(content);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Router
// ════════════════════════════════════════════════════════════════════════════

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    res.end();
    return;
  }

  const url = req.url.split("?")[0];

  if (req.method === "POST") {
    if (url === "/api/tabby/eligibility") return tabbyEligibility(req, res);
    if (url === "/api/tabby/checkout")    return tabbyCheckout(req, res);
  }

  if (req.method === "GET") return serveStatic(req, res);

  res.writeHead(405); res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`\n🌍 Over Seas running at http://localhost:${PORT}`);
  if (isTestMode()) {
    console.log("⚠  TEST MODE — set TABBY_SECRET_KEY in .env to enable real payments");
  } else {
    console.log("✅ Tabby secret key loaded — merchant code:", TABBY_MERCHANT_CODE);
  }
});