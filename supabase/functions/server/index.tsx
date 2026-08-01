import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";

const app = new Hono();

app.use("*", logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

app.get("/make-server-fd15274a/health", (c) => c.json({ status: "ok" }));

// ── Email via Resend ──────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("Email service not configured (missing RESEND_API_KEY).");
  const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN");
  // onboarding@resend.dev only works for the Resend account owner's email (sandbox restriction).
  // Set RESEND_FROM_DOMAIN env var (e.g. "lifelink.com") to send to any address.
  const from = fromDomain
    ? `LifeLink <noreply@${fromDomain}>`
    : "LifeLink <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as any).message ?? (err as any).name ?? "Email delivery failed.";
    // Resend sandbox restriction: "onboarding@resend.dev" only delivers to verified owner email
    if (msg.includes("verified") || msg.includes("domain") || res.status === 403) {
      throw new Error(
        "Email could not be delivered. The email service is in sandbox mode and can only send to the account owner's address. Please contact the administrator to configure a verified sending domain."
      );
    }
    throw new Error(msg);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────
app.post("/make-server-fd15274a/auth/register", async (c) => {
  const body = await c.req.json();
  const { email, password, ...profileData } = body;
  if (!email || !password) return c.json({ error: "Email and password are required" }, 400);

  const emailKey = `auth:${email.toLowerCase().trim()}`;
  const existing = await kv.get(emailKey);
  if (existing) return c.json({ error: "An account with this email already exists" }, 409);

  const id = crypto.randomUUID();
  const encoded = btoa(unescape(encodeURIComponent(password)));
  const profile = { ...profileData, id, email: email.toLowerCase().trim(), createdAt: new Date().toISOString() };

  await kv.set(`profile:${id}`, profile);
  await kv.set(emailKey, { profileId: id, password: encoded });

  // Welcome email
  const isDonor = profile.role === "donor";
  await sendEmail(profile.email, "Welcome to LifeLink 🩸", `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#c0152a">Welcome to LifeLink, ${profile.firstName}!</h2>
      <p>Your ${isDonor ? "donor" : "requester"} account has been created.</p>
      <p><strong>Blood Group:</strong> ${profile.bloodGroup}</p>
      ${isDonor
        ? `<p>You'll receive an email whenever a taker posts a request that matches your blood group. Log in to browse live requests and respond.</p>`
        : `<p>Your blood request has been posted. You'll receive an email as soon as a compatible donor responds with their contact details.</p>`}
      <p style="color:#888;font-size:13px;margin-top:32px">LifeLink — Every drop saves a life.</p>
    </div>
  `);

  return c.json({ profile });
});

// ── Email Verification (registration) ────────────────────────────────────
app.post("/make-server-fd15274a/auth/send-verification", async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: "Email required" }, 400);
  const emailKey = `auth:${email.toLowerCase().trim()}`;
  const existing: any = await kv.get(emailKey);
  if (existing) return c.json({ error: "An account with this email already exists. Please log in instead." }, 409);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 15 * 60 * 1000;
  await kv.set(`verify:${email.toLowerCase().trim()}`, { code, expiresAt });

  try {
    await sendEmail(email, "LifeLink — Verify Your Email", `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#bf0e26">Verify Your Email</h2>
        <p>Welcome to LifeLink! Use the code below to verify your email address and complete registration:</p>
        <div style="background:#fff0f0;border:1px solid #f5c6cb;border-radius:8px;padding:24px;margin:20px 0;text-align:center">
          <p style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#bf0e26;margin:0">${code}</p>
        </div>
        <p style="color:#555">This code expires in <strong>15 minutes</strong>. If you did not request this, please ignore this email.</p>
        <p style="color:#888;font-size:13px;margin-top:32px">LifeLink — Every drop saves a life.</p>
      </div>
    `);
  } catch (e: any) {
    // Clean up the stored code so the user can retry after fixing the issue
    await kv.del(`verify:${email.toLowerCase().trim()}`);
    return c.json({ error: e.message ?? "Failed to send verification email." }, 500);
  }
  return c.json({ success: true });
});

app.post("/make-server-fd15274a/auth/verify-email-code", async (c) => {
  const { email, code } = await c.req.json();
  if (!email || !code) return c.json({ error: "Email and code required" }, 400);
  const record: any = await kv.get(`verify:${email.toLowerCase().trim()}`);
  if (!record) return c.json({ error: "No verification request found. Please request a new code." }, 400);
  if (Date.now() > record.expiresAt) {
    await kv.del(`verify:${email.toLowerCase().trim()}`);
    return c.json({ error: "Code has expired. Please request a new one." }, 400);
  }
  if (record.code !== String(code).trim()) return c.json({ error: "Incorrect code. Please check your email." }, 400);
  return c.json({ success: true });
});

// ── Forgot / Reset Password ───────────────────────────────────────────────
app.post("/make-server-fd15274a/auth/forgot-password", async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: "Email required" }, 400);
  const emailKey = `auth:${email.toLowerCase().trim()}`;
  const auth: any = await kv.get(emailKey);
  if (!auth) return c.json({ error: "No account found with this email address." }, 404);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
  await kv.set(`recovery:${email.toLowerCase().trim()}`, { code, expiresAt });

  try {
    await sendEmail(email, "LifeLink — Password Reset Code", `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#c0152a">Password Reset Request</h2>
        <p>We received a request to reset your LifeLink password. Use the code below:</p>
        <div style="background:#fff0f0;border:1px solid #f5c6cb;border-radius:8px;padding:24px;margin:20px 0;text-align:center">
          <p style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#c0152a;margin:0">${code}</p>
        </div>
        <p style="color:#555">This code expires in <strong>15 minutes</strong>. If you did not request a password reset, please ignore this email.</p>
        <p style="color:#888;font-size:13px;margin-top:32px">LifeLink — Every drop saves a life.</p>
      </div>
    `);
  } catch (e: any) {
    await kv.del(`recovery:${email.toLowerCase().trim()}`);
    return c.json({ error: e.message ?? "Failed to send reset email." }, 500);
  }
  return c.json({ success: true });
});

app.post("/make-server-fd15274a/auth/verify-recovery-code", async (c) => {
  const { email, code } = await c.req.json();
  if (!email || !code) return c.json({ error: "Email and code required" }, 400);
  const recovery: any = await kv.get(`recovery:${email.toLowerCase().trim()}`);
  if (!recovery) return c.json({ error: "No reset request found. Please request a new code." }, 400);
  if (Date.now() > recovery.expiresAt) {
    await kv.del(`recovery:${email.toLowerCase().trim()}`);
    return c.json({ error: "Code has expired. Please request a new one." }, 400);
  }
  if (recovery.code !== String(code).trim()) return c.json({ error: "Incorrect code. Please check your email and try again." }, 400);
  return c.json({ success: true });
});

app.post("/make-server-fd15274a/auth/reset-password", async (c) => {
  const { email, code, newPassword } = await c.req.json();
  if (!email || !code || !newPassword) return c.json({ error: "All fields required" }, 400);
  const recovery: any = await kv.get(`recovery:${email.toLowerCase().trim()}`);
  if (!recovery) return c.json({ error: "No reset request found. Please request a new code." }, 400);
  if (Date.now() > recovery.expiresAt) {
    await kv.del(`recovery:${email.toLowerCase().trim()}`);
    return c.json({ error: "Code has expired. Please request a new one." }, 400);
  }
  if (recovery.code !== code) return c.json({ error: "Incorrect code. Please check your email." }, 400);
  if (newPassword.length < 6) return c.json({ error: "Password must be at least 6 characters." }, 400);

  const emailKey = `auth:${email.toLowerCase().trim()}`;
  const auth: any = await kv.get(emailKey);
  if (!auth) return c.json({ error: "Account not found." }, 404);

  const encoded = btoa(unescape(encodeURIComponent(newPassword)));
  await kv.set(emailKey, { ...auth, password: encoded });
  await kv.del(`recovery:${email.toLowerCase().trim()}`);
  return c.json({ success: true });
});

// ── Public Stats ──────────────────────────────────────────────────────────
app.get("/make-server-fd15274a/stats/public", async (c) => {
  const [profiles, requests] = await Promise.all([
    kv.getByPrefix("profile:"),
    kv.getByPrefix("request:"),
  ]);
  const validProfiles = profiles.filter((p: any) => p?.id && p?.city);
  const validRequests = requests.filter((r: any) => r?.id && r?.takerId);
  const cities = new Set(validProfiles.map((p: any) => p.city?.toLowerCase().trim()).filter(Boolean));
  return c.json({
    totalUsers: validProfiles.length,
    fulfilledRequests: validRequests.filter((r: any) => r.status === "fulfilled").length,
    cities: cities.size,
  });
});

app.get("/make-server-fd15274a/auth/check-email", async (c) => {
  const email = c.req.query("email");
  if (!email) return c.json({ error: "Email required" }, 400);
  const existing = await kv.get(`auth:${email.toLowerCase().trim()}`);
  return c.json({ taken: !!existing });
});

app.post("/make-server-fd15274a/auth/login", async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: "Email and password are required" }, 400);

  const emailKey = `auth:${email.toLowerCase().trim()}`;
  let auth: any = await kv.get(emailKey);
  if (!auth) {
    // Fallback: find profile by email field (accounts created before auth system)
    const allProfiles = await kv.getByPrefix("profile:");
    const matched: any = allProfiles.find((p: any) => p?.email?.toLowerCase().trim() === email.toLowerCase().trim());
    if (!matched) return c.json({ error: "No account found with this email" }, 404);
    // Auto-migrate: create auth record with the supplied password so login succeeds transparently
    const encodedSafeMigrate = btoa(unescape(encodeURIComponent(password)));
    auth = { profileId: matched.id, password: encodedSafeMigrate };
    await kv.set(emailKey, auth);
  }

  const encodedSafe = btoa(unescape(encodeURIComponent(password)));
  const encodedLegacy = btoa(password);
  if (auth.password !== encodedSafe && auth.password !== encodedLegacy) {
    return c.json({ error: "Incorrect password" }, 401);
  }

  const profile = await kv.get(`profile:${auth.profileId}`);
  if (!profile) return c.json({ error: "Profile not found" }, 404);

  return c.json({ profile });
});

// ── Profiles ──────────────────────────────────────────────────────────────
app.post("/make-server-fd15274a/profiles", async (c) => {
  const body = await c.req.json();
  const id = body.id ?? crypto.randomUUID();
  const profile = { ...body, id, createdAt: body.createdAt ?? new Date().toISOString() };
  await kv.set(`profile:${id}`, profile);
  return c.json({ profile });
});

app.get("/make-server-fd15274a/profiles/:id", async (c) => {
  const id = c.req.param("id");
  const profile: any = await kv.get(`profile:${id}`);
  if (!profile) return c.json({ error: "Not found" }, 404);

  // Backfill donationCount from history for profiles created before this field existed
  if (!profile.donationCount) {
    const history = await kv.getByPrefix(`history:${id}:`);
    const count = history.filter((h: any) => h.donorId === id).length;
    if (count > 0) {
      const updated = { ...profile, donationCount: count };
      await kv.set(`profile:${id}`, updated);
      return c.json({ profile: updated });
    }
  }

  return c.json({ profile });
});

app.put("/make-server-fd15274a/profiles/:id", async (c) => {
  const body = await c.req.json();
  const profile: any = await kv.get(`profile:${c.req.param("id")}`);
  if (!profile) return c.json({ error: "Not found" }, 404);
  const allowed = [
    "firstName", "lastName", "phone", "altPhone",
    "address", "city", "state",
    "medicalConditions", "availableTodonate",
  ];
  const patch: any = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }
  const updated = { ...profile, ...patch };
  await kv.set(`profile:${c.req.param("id")}`, updated);
  return c.json({ profile: updated });
});

app.put("/make-server-fd15274a/profiles/:id/password", async (c) => {
  const { currentPassword, newPassword } = await c.req.json();
  const profile: any = await kv.get(`profile:${c.req.param("id")}`);
  if (!profile) return c.json({ error: "Not found" }, 404);
  const auth: any = await kv.get(`auth:${profile.email}`);
  if (!auth) return c.json({ error: "Auth record not found" }, 404);
  const encodedSafe = btoa(unescape(encodeURIComponent(currentPassword)));
  const encodedLegacy = btoa(currentPassword);
  if (auth.password !== encodedSafe && auth.password !== encodedLegacy) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }
  const newEncoded = btoa(unescape(encodeURIComponent(newPassword)));
  await kv.set(`auth:${profile.email}`, { ...auth, password: newEncoded });
  return c.json({ success: true });
});

// ── Blood Requests ────────────────────────────────────────────────────────
app.post("/make-server-fd15274a/requests", async (c) => {
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const request = { ...body, id, status: "open", createdAt: new Date().toISOString(), responseCount: 0 };
  await kv.set(`request:${id}`, request);
  return c.json({ request });
});

app.get("/make-server-fd15274a/requests", async (c) => {
  const all = await kv.getByPrefix("request:");
  const requests = all.filter((r: any) => r && r.id && r.takerId);
  requests.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ requests });
});

app.get("/make-server-fd15274a/requests/:id", async (c) => {
  const request = await kv.get(`request:${c.req.param("id")}`);
  if (!request) return c.json({ error: "Not found" }, 404);
  return c.json({ request });
});

app.put("/make-server-fd15274a/requests/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await kv.get(`request:${id}`);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const updated = { ...existing, ...await c.req.json() };
  await kv.set(`request:${id}`, updated);
  return c.json({ request: updated });
});

// ── Donor Responses ───────────────────────────────────────────────────────
app.post("/make-server-fd15274a/requests/:requestId/respond", async (c) => {
  const requestId = c.req.param("requestId");
  const body = await c.req.json();
  const responseId = crypto.randomUUID();

  const existing: any[] = await kv.getByPrefix(`response:${requestId}:`);
  if (existing.some((r: any) => r.donorId === body.donorId)) {
    return c.json({ error: "Already responded" }, 409);
  }

  // Fetch request upfront so we can store takerName on the response
  const request: any = await kv.get(`request:${requestId}`);

  const response = {
    id: responseId, requestId,
    donorId: body.donorId, donorName: body.donorName,
    donorBloodGroup: body.donorBloodGroup, donorPhone: body.donorPhone,
    donorEmail: body.donorEmail, donorCity: body.donorCity,
    takerId: request?.takerId ?? "",
    takerName: request?.takerName ?? "",
    message: body.message ?? "", status: "pending",
    createdAt: new Date().toISOString(),
  };

  await kv.set(`response:${requestId}:${responseId}`, response);

  // Update responseCount
  // (request already fetched above)
  if (request) {
    await kv.set(`request:${requestId}`, { ...request, responseCount: (request.responseCount ?? 0) + 1 });

    // Email the taker
    const takerProfile: any = await kv.get(`profile:${request.takerId}`);
    if (takerProfile?.email) {
      await sendEmail(
        takerProfile.email,
        `🩸 A donor has responded to your blood request`,
        `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#c0152a">Good news, ${takerProfile.firstName}!</h2>
          <p><strong>${body.donorName}</strong> (Blood Group: <strong>${body.donorBloodGroup}</strong>) has offered to donate blood for your request.</p>
          <div style="background:#fff0f0;border:1px solid #f5c6cb;border-radius:8px;padding:16px;margin:20px 0">
            <p style="margin:0 0 8px"><strong>Donor Contact Details</strong></p>
            <p style="margin:0 0 4px">📞 <a href="tel:${body.donorPhone}">${body.donorPhone}</a></p>
            <p style="margin:0 0 4px">✉️ <a href="mailto:${body.donorEmail}">${body.donorEmail}</a></p>
            <p style="margin:0">📍 ${body.donorCity}</p>
          </div>
          ${body.message ? `<p><strong>Message from donor:</strong> "${body.message}"</p>` : ""}
          <p>Please reach out to them as soon as possible. Log in to LifeLink to see all responses.</p>
          <p style="color:#888;font-size:13px;margin-top:32px">LifeLink — Every drop saves a life.</p>
        </div>
        `
      );
    }
  }

  return c.json({ response });
});

app.get("/make-server-fd15274a/requests/:requestId/responses", async (c) => {
  const responses = await kv.getByPrefix(`response:${c.req.param("requestId")}:`);
  responses.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ responses });
});

app.get("/make-server-fd15274a/donors/:donorId/responses", async (c) => {
  const all = await kv.getByPrefix("response:");
  const mine = all.filter((r: any) => r && r.donorId === c.req.param("donorId"));
  mine.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ responses: mine });
});

app.get("/make-server-fd15274a/takers/:takerId/requests", async (c) => {
  const all = await kv.getByPrefix("request:");
  const mine = all.filter((r: any) => r && r.takerId === c.req.param("takerId"));
  mine.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ requests: mine });
});

// Response count for a taker (used for badge polling)
app.get("/make-server-fd15274a/takers/:takerId/response-count", async (c) => {
  const takerId = c.req.param("takerId");
  const allRequests = await kv.getByPrefix("request:");
  const myRequests = allRequests.filter((r: any) => r && r.takerId === takerId);
  let count = 0;
  for (const req of myRequests) {
    const responses = await kv.getByPrefix(`response:${req.id}:`);
    count += responses.length;
  }
  return c.json({ count });
});

// ── Cancel a request ─────────────────────────────────────────────────────
// Called by the requester when they no longer need blood
app.post("/make-server-fd15274a/requests/:requestId/cancel", async (c) => {
  const requestId = c.req.param("requestId");
  const { takerId } = await c.req.json();

  const request: any = await kv.get(`request:${requestId}`);
  if (!request) return c.json({ error: "Request not found" }, 404);
  if (request.takerId !== takerId) return c.json({ error: "Unauthorized" }, 403);
  if (request.status !== "open") return c.json({ error: "Only open requests can be cancelled" }, 400);

  await kv.set(`request:${requestId}`, { ...request, status: "closed", closedAt: new Date().toISOString() });
  return c.json({ success: true });
});

// ── Fulfill a request ────────────────────────────────────────────────────
// Called by taker when donation is confirmed complete
app.post("/make-server-fd15274a/requests/:requestId/fulfill", async (c) => {
  const requestId = c.req.param("requestId");
  const { responseId, notes } = await c.req.json();

  const request: any = await kv.get(`request:${requestId}`);
  if (!request) return c.json({ error: "Request not found" }, 404);

  const response: any = await kv.get(`response:${requestId}:${responseId}`);
  if (!response) return c.json({ error: "Response not found" }, 404);

  // Mark request fulfilled
  await kv.set(`request:${requestId}`, { ...request, status: "fulfilled", fulfilledAt: new Date().toISOString(), fulfilledByResponseId: responseId });

  // Mark response accepted
  await kv.set(`response:${requestId}:${responseId}`, { ...response, status: "accepted" });

  // Build shared history record
  const historyId = crypto.randomUUID();
  const record = {
    id: historyId,
    requestId,
    responseId,
    donorId: response.donorId,
    donorName: response.donorName,
    donorBloodGroup: response.donorBloodGroup,
    donorPhone: response.donorPhone,
    donorEmail: response.donorEmail,
    donorCity: response.donorCity,
    takerId: request.takerId,
    takerName: request.takerName,
    bloodGroup: request.bloodGroup,
    hospital: request.hospital,
    city: request.city,
    unitsRequired: request.unitsRequired,
    urgency: request.urgency,
    notes: notes ?? "",
    completedAt: new Date().toISOString(),
    requestCreatedAt: request.createdAt,
  };

  // Write history for both parties
  await kv.set(`history:${request.takerId}:${historyId}`, { ...record, role: "taker" });
  await kv.set(`history:${response.donorId}:${historyId}`, { ...record, role: "donor" });

  // Update donor's lastDonationDate and donationCount in their profile
  const donorProfileToUpdate: any = await kv.get(`profile:${response.donorId}`);
  if (donorProfileToUpdate) {
    await kv.set(`profile:${response.donorId}`, {
      ...donorProfileToUpdate,
      lastDonationDate: record.completedAt,
      donationCount: (donorProfileToUpdate.donationCount ?? 0) + 1,
    });
  }

  // Email the donor to thank them
  const donorProfile: any = await kv.get(`profile:${response.donorId}`);
  if (donorProfile?.email) {
    await sendEmail(
      donorProfile.email,
      "🩸 Your donation has been confirmed — Thank you!",
      `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#c0152a">Thank you, ${response.donorName}!</h2>
        <p><strong>${request.takerName}</strong> has confirmed that your blood donation was completed successfully.</p>
        <div style="background:#fff0f0;border:1px solid #f5c6cb;border-radius:8px;padding:16px;margin:20px 0">
          <p style="margin:0 0 6px"><strong>Donation Details</strong></p>
          <p style="margin:0 0 4px">Blood Group: <strong>${request.bloodGroup}</strong></p>
          <p style="margin:0 0 4px">Hospital: ${request.hospital}</p>
          <p style="margin:0 0 4px">Units: ${request.unitsRequired}</p>
          ${notes ? `<p style="margin:8px 0 0">Note from recipient: "${notes}"</p>` : ""}
        </div>
        <p>Your generosity saved a life. This donation has been recorded in your history on LifeLink.</p>
        <p style="color:#888;font-size:13px;margin-top:32px">LifeLink — Every drop saves a life.</p>
      </div>
      `
    );
  }

  return c.json({ record });
});

// ── Chat ─────────────────────────────────────────────────────────────────
app.get("/make-server-fd15274a/chat/:requestId", async (c) => {
  const messages = await kv.getByPrefix(`chat:${c.req.param("requestId")}:`);
  messages.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return c.json({ messages });
});

app.post("/make-server-fd15274a/chat/:requestId", async (c) => {
  const requestId = c.req.param("requestId");
  const { senderId, senderName, text } = await c.req.json();
  if (!text?.trim()) return c.json({ error: "Message cannot be empty" }, 400);
  const id = crypto.randomUUID();
  const message = { id, requestId, senderId, senderName, text: text.trim(), createdAt: new Date().toISOString() };
  await kv.set(`chat:${requestId}:${id}`, message);
  return c.json({ message });
});

// ── Ratings ───────────────────────────────────────────────────────────────
app.get("/make-server-fd15274a/ratings/:donorId", async (c) => {
  const ratings = await kv.getByPrefix(`rating:${c.req.param("donorId")}:`);
  ratings.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ ratings });
});

app.post("/make-server-fd15274a/ratings/:donorId", async (c) => {
  const donorId = c.req.param("donorId");
  const { requestId, takerId, takerName, stars, note } = await c.req.json();
  if (!stars || stars < 1 || stars > 5) return c.json({ error: "Stars must be 1–5" }, 400);

  // Prevent duplicate rating for same request
  const existing = await kv.getByPrefix(`rating:${donorId}:`);
  if (existing.some((r: any) => r.requestId === requestId)) {
    return c.json({ error: "Already rated" }, 409);
  }

  const id = crypto.randomUUID();
  const rating = { id, donorId, requestId, takerId, takerName, stars, note: note ?? "", createdAt: new Date().toISOString() };
  await kv.set(`rating:${donorId}:${id}`, rating);

  // Recompute and store average rating on donor profile
  const allRatings = [...existing, rating];
  const avg = allRatings.reduce((sum: number, r: any) => sum + r.stars, 0) / allRatings.length;
  const donorProfile: any = await kv.get(`profile:${donorId}`);
  if (donorProfile) {
    await kv.set(`profile:${donorId}`, { ...donorProfile, ratingAvg: Math.round(avg * 10) / 10, ratingCount: allRatings.length });
  }

  return c.json({ rating });
});

// ── History ───────────────────────────────────────────────────────────────
app.get("/make-server-fd15274a/history/:userId", async (c) => {
  const records = await kv.getByPrefix(`history:${c.req.param("userId")}:`);
  records.sort((a: any, b: any) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  return c.json({ records });
});

// ── Admin ─────────────────────────────────────────────────────────────────
const ADMIN_DEFAULT_USER = "admin";
const ADMIN_DEFAULT_PASS = "lifelink@admin";

async function getAdminCredentials() {
  const stored = await kv.get("admin:credentials");
  return stored ?? { username: ADMIN_DEFAULT_USER, password: ADMIN_DEFAULT_PASS };
}

app.post("/make-server-fd15274a/admin/login", async (c) => {
  const { username, password } = await c.req.json();
  const creds = await getAdminCredentials();
  if (username === creds.username && password === creds.password) {
    return c.json({ success: true });
  }
  return c.json({ error: "Invalid credentials" }, 401);
});

app.put("/make-server-fd15274a/admin/credentials", async (c) => {
  const { currentPassword, newUsername, newPassword } = await c.req.json();
  const creds = await getAdminCredentials();
  if (currentPassword !== creds.password) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }
  await kv.set("admin:credentials", {
    username: newUsername || creds.username,
    password: newPassword || creds.password,
  });
  return c.json({ success: true });
});

app.get("/make-server-fd15274a/admin/stats", async (c) => {
  const [profiles, requests, responses] = await Promise.all([
    kv.getByPrefix("profile:"),
    kv.getByPrefix("request:"),
    kv.getByPrefix("response:"),
  ]);
  const validProfiles = profiles.filter((p: any) => p?.id);
  const validRequests = requests.filter((r: any) => r?.id && r?.takerId);
  const validResponses = responses.filter((r: any) => r?.id && r?.donorId);
  return c.json({
    totalUsers: validProfiles.length,
    totalDonors: validProfiles.filter((p: any) => p.role === "donor").length,
    totalTakers: validProfiles.filter((p: any) => p.role === "taker").length,
    openRequests: validRequests.filter((r: any) => r.status === "open").length,
    fulfilledRequests: validRequests.filter((r: any) => r.status === "fulfilled").length,
    totalRequests: validRequests.length,
    totalResponses: validResponses.length,
  });
});

app.get("/make-server-fd15274a/admin/users", async (c) => {
  const profiles = await kv.getByPrefix("profile:");
  const valid = profiles.filter((p: any) => p?.id);
  valid.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ users: valid });
});

app.delete("/make-server-fd15274a/admin/users/:id", async (c) => {
  const id = c.req.param("id");
  let profile: any = await kv.get(`profile:${id}`);
  if (!profile) {
    // Fallback: scan all profiles to find by id field
    const all = await kv.getByPrefix("profile:");
    profile = all.find((p: any) => p?.id === id);
  }
  if (!profile) return c.json({ error: "Not found" }, 404);
  await kv.del(`profile:${id}`);
  if (profile.email) await kv.del(`auth:${profile.email.toLowerCase().trim()}`);
  return c.json({ success: true });
});

app.get("/make-server-fd15274a/admin/requests", async (c) => {
  const all = await kv.getByPrefix("request:");
  const valid = all.filter((r: any) => r?.id && r?.takerId);
  valid.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ requests: valid });
});

app.put("/make-server-fd15274a/admin/requests/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await kv.get(`request:${id}`);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json();
  const updated = { ...existing, ...body };
  await kv.set(`request:${id}`, updated);
  return c.json({ request: updated });
});

app.delete("/make-server-fd15274a/admin/requests/:id", async (c) => {
  const id = c.req.param("id");
  await kv.del(`request:${id}`);
  return c.json({ success: true });
});

app.get("/make-server-fd15274a/admin/responses", async (c) => {
  const all = await kv.getByPrefix("response:");
  const valid = all.filter((r: any) => r?.id && r?.donorId);
  valid.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ responses: valid });
});

Deno.serve(app.fetch);
