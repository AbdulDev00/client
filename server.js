const http = require("http");
const fs   = require("fs");
const path = require("path");
const nodemailer = require('nodemailer');

// ── Load .env ────────────────────────────────────────────────
(function loadEnv() {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, ".env"), "utf-8");
    envContent.split("\n").forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    });
  } catch {}
})();

const PORT                = Number(process.env.PORT || 4173);
const PUBLIC_BASE_URL     = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const ZIINA_API_KEY       = process.env.ZIINA_API_KEY;
const TABBY_SECRET_KEY    = process.env.TABBY_SECRET_KEY;
const TABBY_PUBLIC_KEY    = process.env.TABBY_PUBLIC_KEY;
const TABBY_MERCHANT_CODE = process.env.TABBY_MERCHANT_CODE || "AE";
const TABBY_API_BASE      = "https://api.tabby.ai";
const ZIINA_API_BASE      = "https://api-v2.ziina.com/api";

// ── Email Configuration ──────────────────────────────────────
// !!! REPLACE WITH YOUR GMAIL CREDENTIALS !!!
const EMAIL_CONFIG = {
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'Overseastravel.contact@gmail.com', 
    pass: 'fzrx erun oozf odoh',
  },
};

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

// ── Helpers ──────────────────────────────────────────────────
function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type":                "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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

function hasTabbyKey() {
  return TABBY_SECRET_KEY && TABBY_SECRET_KEY.length >= 10;
}

// ── Email Handler ────────────────────────────────────────────
async function sendPaymentEmail(req, res) {
  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    res.end();
    return;
  }

  try {
    const data = await readJsonBody(req);
    
    console.log('[Email] Received data:', JSON.stringify(data, null, 2));
    
    const required = ['name', 'phone', 'email', 'service', 'amount', 'transactionId', 'paymentMethod'];
    const missing = required.find(f => !data[f]);
    if (missing) {
      return sendJson(res, 400, { error: `Missing required field: ${missing}` });
    }

    const methodNames = {
      card: 'بطاقة ائتمان / دفع سريع',
      installments: 'تقسيط تابي',
      apple_pay: 'Apple Pay',
      google_pay: 'Google Pay',
    };

    const methodName = methodNames[data.paymentMethod] || data.paymentMethod;
    const serviceDisplay = data.service === 'inquiry' ? 'استفسار أو خدمة مخصصة' : data.service;

    const subject = `تأكيد دفع جديد - Over Seas - ${data.transactionId}`;

    const htmlBody = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f5f5; padding: 20px; direction: rtl; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 30px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        .header { text-align: center; border-bottom: 2px solid #4BFDB3; padding-bottom: 20px; margin-bottom: 24px; }
        .header h1 { color: #0a0a0a; font-size: 22px; margin: 0; }
        .header .sub { color: #666; font-size: 14px; margin: 4px 0 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #555; font-weight: 600; }
        .detail-value { color: #0a0a0a; font-weight: 500; }
        .total-row { background: #f8f9fa; padding: 14px 0; margin: 12px -30px -30px; padding: 16px 30px; border-radius: 0 0 16px 16px; }
        .total-row .detail-value { color: #4BFDB3; font-size: 18px; }
        .status-badge { display: inline-block; background: #4ade80; color: #0a0a0a; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; }
        .inquiry-box { background: #f0f7ff; border-radius: 8px; padding: 14px; margin: 12px 0; border-right: 4px solid #4BFDB3; }
        .inquiry-box .label { font-size: 12px; color: #666; font-weight: 600; }
        .inquiry-box .message { margin: 4px 0 0; color: #0a0a0a; }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #999; }
        .footer a { color: #4BFDB3; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛫 Over Seas</h1>
            <p class="sub">تأكيد دفع جديد</p>
        </div>
        <div class="detail-row">
            <span class="detail-label">رقم العملية</span>
            <span class="detail-value">${data.transactionId}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">العميل</span>
            <span class="detail-value">${data.name}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">رقم الهاتف</span>
            <span class="detail-value">${data.phone}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">البريد الإلكتروني</span>
            <span class="detail-value">${data.email}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">الخدمة</span>
            <span class="detail-value">${serviceDisplay}</span>
        </div>
        ${data.service === 'inquiry' && data.inquiryMessage ? `
        <div class="inquiry-box">
            <div class="label">📝 تفاصيل الاستفسار / الخدمة المخصصة</div>
            <div class="message">${data.inquiryMessage}</div>
        </div>` : ''}
        <div class="detail-row">
            <span class="detail-label">طريقة الدفع</span>
            <span class="detail-value">${methodName}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">المبلغ المدفوع</span>
            <span class="detail-value">AED ${data.amount}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">الحالة</span>
            <span class="detail-value"><span class="status-badge">✓ مكتمل</span></span>
        </div>
        <div class="total-row">
            <div class="detail-row" style="border-bottom: none; padding: 0;">
                <span class="detail-label" style="font-size: 16px;">الإجمالي</span>
                <span class="detail-value" style="font-size: 20px; color: #4BFDB3;">AED ${data.amount}</span>
            </div>
        </div>
        <div class="footer">
            <p>تم إرسال هذا البريد تلقائياً من نظام Over Seas للدفع.</p>
            <p><a href="mailto:info@overseas.ae">info@overseas.ae</a> | <a href="https://wa.me/971564630165">واتساب</a></p>
        </div>
    </div>
</body>
</html>`;

    const plainText = `
تأكيد دفع جديد - Over Seas
─────────────────────────────
رقم العملية: ${data.transactionId}
العميل: ${data.name}
الهاتف: ${data.phone}
البريد: ${data.email}
الخدمة: ${serviceDisplay}
${data.service === 'inquiry' && data.inquiryMessage ? `تفاصيل الاستفسار: ${data.inquiryMessage}\n` : ''}
طريقة الدفع: ${methodName}
المبلغ: AED ${data.amount}
الحالة: مكتمل
─────────────────────────────`;

    // Create transporter with better error handling
    const transporter = nodemailer.createTransport({
      ...EMAIL_CONFIG,
      connectionTimeout: 10000, // 10 seconds timeout
    });

    // Verify connection before sending
    try {
      await transporter.verify();
      console.log('[Email] SMTP connection verified');
    } catch (verifyErr) {
      console.error('[Email] SMTP verification failed:', verifyErr.message);
      return sendJson(res, 500, { 
        error: 'Email server connection failed',
        details: verifyErr.message 
      });
    }

    const info = await transporter.sendMail({
      from: `"Over Seas Payments" <${EMAIL_CONFIG.auth.user}>`,
      to: 'Overseastravel.contact@gmail.com', 
      replyTo: data.email,
      subject: subject,
      html: htmlBody,
      text: plainText,
    });

    console.log('✅ Email sent:', info.messageId);
    
    sendJson(res, 200, {
      success: true,
      message: 'Email sent successfully',
      transaction_id: data.transactionId,
      messageId: info.messageId,
    });

  } catch (err) {
    console.error('[Email] error:', err.message);
    console.error('[Email] stack:', err.stack);
    sendJson(res, 500, { 
      error: 'Failed to send email',
      details: err.message 
    });
  }
}

// ── ZIINA ────────────────────────────────────────────────────
async function ziinaCheckout(req, res) {
  try {
    const p = await readJsonBody(req);
    const missing = ["name", "phone", "email", "service", "amount"].find(f => !p[f]);
    if (missing) return sendJson(res, 400, { message: `Missing: ${missing}` });

    if (!ZIINA_API_KEY) {
      console.log("[Ziina] No API key — returning test_mode");
      return sendJson(res, 200, { test_mode: true });
    }

    const amountFils = Math.round(Number(p.amount) * 100);
    const payload = {
      amount: amountFils,
      currency_code: "AED",
      message: p.service || "Over Seas Payment",
      success_url: `${PUBLIC_BASE_URL}/payment.html?status=success`,
      cancel_url: `${PUBLIC_BASE_URL}/payment.html?status=cancelled`,
    };

    console.log("[Ziina][checkout] Sending:", JSON.stringify(payload));

    const ziinaRes = await fetch(`${ZIINA_API_BASE}/payment_intent`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ZIINA_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const ziinaData = await ziinaRes.json();
    console.log("[Ziina][checkout] HTTP:", ziinaRes.status, "| Response:", JSON.stringify(ziinaData));

    if (!ziinaRes.ok) {
      return sendJson(res, 502, { message: ziinaData?.message || "Ziina error. Check your API key." });
    }

    const redirectUrl = ziinaData?.redirect_url;
    if (!redirectUrl) {
      return sendJson(res, 502, { message: "Ziina did not return a redirect URL." });
    }

    return sendJson(res, 200, { web_url: redirectUrl });

  } catch (err) {
    console.error("[Ziina][checkout] error:", err.message);
    return sendJson(res, 500, { message: err.message });
  }
}

// ── TABBY ────────────────────────────────────────────────────
function tabbyHeaders() {
  return {
    "Authorization": `Bearer ${TABBY_SECRET_KEY}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

function buildTabbyPayload(p, includeRedirects = true) {
  const orderId = `OS-${Date.now()}`;
  const payload = {
    payment: {
      amount: Number(p.amount).toFixed(2),
      currency: "AED",
      description: p.service || "Over Seas Travel Service",
      buyer: {
        phone: p.phone || "",
        email: p.email || "",
        name: p.name || "",
        dob: "1990-01-01",
      },
      buyer_history: {
        registered_since: new Date().toISOString(),
        loyalty_level: 0,
        wishlist_count: 0,
        is_social_networks_connected: false,
        is_phone_number_verified: false,
        is_email_verified: false,
      },
      order: {
        tax_amount: "0.00",
        shipping_amount: "0.00",
        discount_amount: "0.00",
        updated_at: new Date().toISOString(),
        reference_id: orderId,
        items: [{
          title: p.service || "Travel Service",
          quantity: 1,
          unit_price: Number(p.amount).toFixed(2),
          discount_amount: "0.00",
          reference_id: "SERVICE-001",
          image_url: `${PUBLIC_BASE_URL}/logo/logo.png`,
          product_url: PUBLIC_BASE_URL,
          category: "Travel",
        }],
      },
      order_history: [],
      meta: { order_id: orderId, customer: p.email || "" },
    },
    lang: "ar",
    merchant_code: TABBY_MERCHANT_CODE,
  };

  if (includeRedirects) {
    payload.merchant_urls = {
      success: `${PUBLIC_BASE_URL}/payment.html?status=success`,
      cancel: `${PUBLIC_BASE_URL}/payment.html?status=cancelled`,
      failure: `${PUBLIC_BASE_URL}/payment.html?status=failed`,
    };
  }
  return payload;
}

function extractRejectionReason(data) {
  const installments = data?.configuration?.available_products?.installments;
  if (!installments || installments.length === 0) return "not_available";
  return installments[0]?.rejection_reason || "not_available";
}

async function tabbyEligibility(req, res) {
  try {
    const p = await readJsonBody(req);
    if (!p.amount || !p.buyer_email || !p.buyer_phone) {
      return sendJson(res, 400, { eligible: false, rejection_reason: "missing_fields" });
    }

    if (!hasTabbyKey()) {
      console.log("[Tabby][eligibility] No key — returning eligible:true (dev mode)");
      return sendJson(res, 200, { eligible: true });
    }

    const payload = buildTabbyPayload({
      amount: p.amount, phone: p.buyer_phone,
      email: p.buyer_email, name: p.buyer_name || "",
      service: "Eligibility Check",
    }, false);

    const tabbyRes = await fetch(`${TABBY_API_BASE}/api/v2/checkout`, {
      method: "POST", headers: tabbyHeaders(), body: JSON.stringify(payload),
    });
    const tabbyData = await tabbyRes.json();

    if (tabbyData?.status === "rejected") {
      return sendJson(res, 200, { eligible: false, rejection_reason: extractRejectionReason(tabbyData) });
    }
    return sendJson(res, 200, { eligible: true });

  } catch (err) {
    console.error("[Tabby][eligibility] error:", err.message);
    return sendJson(res, 200, { eligible: true });
  }
}

async function tabbyCheckout(req, res) {
  try {
    const p = await readJsonBody(req);
    const missing = ["name", "phone", "email", "service", "amount"].find(f => !p[f]);
    if (missing) return sendJson(res, 400, { message: `Missing: ${missing}` });

    if (!hasTabbyKey()) {
      console.log("[Tabby][checkout] No key — returning test_mode");
      return sendJson(res, 200, { test_mode: true });
    }

    const payload = buildTabbyPayload(p);
    const tabbyRes = await fetch(`${TABBY_API_BASE}/api/v2/checkout`, {
      method: "POST", headers: tabbyHeaders(), body: JSON.stringify(payload),
    });
    const tabbyData = await tabbyRes.json();

    console.log("[Tabby][checkout] HTTP:", tabbyRes.status, "| Status:", tabbyData?.status);

    if (tabbyData?.status === "rejected") {
      return sendJson(res, 200, {
        status: "rejected",
        rejection_reason: extractRejectionReason(tabbyData),
      });
    }

    const products = tabbyData?.configuration?.available_products;
    const installments = products?.installments;
    const webUrl = installments?.[0]?.web_url || tabbyData?.web_url || null;

    if (!webUrl) {
      return sendJson(res, 502, { message: "Tabby did not return a checkout URL." });
    }

    return sendJson(res, 200, { web_url: webUrl });

  } catch (err) {
    console.error("[Tabby][checkout] error:", err.message);
    return sendJson(res, 500, { message: err.message });
  }
}

// ── Static file server ───────────────────────────────────────
function serveStatic(req, res) {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
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

// ── Router ───────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    });
    res.end();
    return;
  }

  const url = req.url.split("?")[0];

  if (req.method === "POST") {
    if (url === "/api/ziina/checkout")          return ziinaCheckout(req, res);
    if (url === "/api/tabby/eligibility")       return tabbyEligibility(req, res);
    if (url === "/api/tabby/checkout")          return tabbyCheckout(req, res);
    if (url === "/api/send-payment-email")      return sendPaymentEmail(req, res);
  }

  if (req.method === "GET") return serveStatic(req, res);

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`\n🌍 Over Seas running at http://localhost:${PORT}`);
  console.log(`📧 Email notifications will be sent to: Overseastravel.contact@gmail.com`);
  console.log(ZIINA_API_KEY  ? "✅ Ziina key loaded"        : "⚠  No ZIINA_API_KEY  → demo mode");
  console.log(hasTabbyKey()  ? "✅ Tabby secret key loaded" : "⚠  No TABBY_SECRET_KEY → demo mode");
  console.log("✅ Email notification endpoint: /api/send-payment-email");
});