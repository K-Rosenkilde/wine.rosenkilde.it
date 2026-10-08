import { Hono } from "hono";
import * as d1 from "./d1.js";
import * as auth from "./auth.js";
import { readLabel } from "./label.js";

const app = new Hono();
const DB = (c) => c.env.DB;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// --- auth middleware: attach the current user (or null) to every /api request -
app.use("/api/*", async (c, next) => {
  let user = null;
  const token = auth.readCookie(c.req, "session");
  if (token) user = await d1.userForSession(DB(c), await auth.sha256hex(token));
  c.set("user", user);
  await next();
});

const pubUser = (u) => (u ? { id: u.id, name: u.name, email: u.email } : null);

/** Membership + role for the current user in a cellar, or an error code. */
async function access(c, cellarId) {
  const user = c.get("user");
  if (!user) return { error: 401 };
  if (!Number.isInteger(cellarId)) return { error: 400 };
  const m = await d1.getMembership(DB(c), cellarId, user.id);
  if (!m) return { error: 403 };
  return { user, role: m.role };
}
/** Resolve a wine and the current user's access to its cellar. */
async function wineAccess(c, wineId) {
  const wine = await d1.getWine(DB(c), wineId);
  if (!wine) return { error: 404 };
  const a = await access(c, wine.cellar_id);
  return a.error ? a : { ...a, wine };
}
function deny(c, code) {
  const msg = { 401: "Du er ikke logget ind", 403: "Ingen adgang", 404: "Findes ikke" }[code] || "Ugyldig forespørgsel";
  return c.json({ error: msg }, code);
}
const body = (c) => c.req.json().catch(() => ({}));

// ============================ AUTH ========================================

app.post("/api/auth/signup", async (c) => {
  const { email, password, name } = await body(c);
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return c.json({ error: "Ugyldig e-mail" }, 400);
  if (String(password || "").length < 6) return c.json({ error: "Adgangskoden skal være mindst 6 tegn" }, 400);
  if (await d1.getUserByEmail(DB(c), e)) return c.json({ error: "Der findes allerede en konto med den e-mail" }, 409);

  const { hash, salt } = await auth.hashPassword(password);
  const n = String(name || "").trim();
  const userId = await d1.createUser(DB(c), { email: e, name: n, hash, salt });
  const { token, id, expires } = await auth.newSessionToken();
  await d1.createSession(DB(c), id, userId, expires);
  c.header("Set-Cookie", auth.sessionCookie(token));
  return c.json({ user: { id: userId, name: n, email: e } }, 201);
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await body(c);
  const user = await d1.getUserByEmail(DB(c), String(email || "").trim().toLowerCase());
  if (!user || !(await auth.verifyPassword(String(password || ""), user.pw_salt, user.pw_hash))) {
    return c.json({ error: "Forkert e-mail eller adgangskode" }, 401);
  }
  const { token, id, expires } = await auth.newSessionToken();
  await d1.createSession(DB(c), id, user.id, expires);
  c.header("Set-Cookie", auth.sessionCookie(token));
  return c.json({ user: pubUser(user) });
});

app.post("/api/auth/logout", async (c) => {
  const token = auth.readCookie(c.req, "session");
  if (token) await d1.deleteSession(DB(c), await auth.sha256hex(token));
  c.header("Set-Cookie", auth.clearCookie());
  return c.json({ ok: true });
});

app.get("/api/auth/me", (c) => c.json({ user: pubUser(c.get("user")) }));

// Change your own display name.
app.put("/api/auth/me", async (c) => {
  const user = c.get("user");
  if (!user) return deny(c, 401);
  const n = String((await body(c)).name || "").trim().slice(0, 100);
  if (!n) return c.json({ error: "Skriv et navn" }, 400);
  await d1.setUserName(DB(c), user.id, n);
  return c.json({ user: { ...pubUser(user), name: n } });
});

// ============================ CELLARS =====================================

app.get("/api/cellars", async (c) => {
  const user = c.get("user");
  if (!user) return deny(c, 401);
  return c.json(await d1.cellarsForUser(DB(c), user.id));
});

app.post("/api/cellars", async (c) => {
  const user = c.get("user");
  if (!user) return deny(c, 401);
  const n = String((await body(c)).name || "").trim();
  if (!n) return c.json({ error: "Giv kælderen et navn" }, 400);
  const id = await d1.createCellar(DB(c), n, user.id, auth.randomInviteCode());
  return c.json({ id }, 201);
});

app.get("/api/cellars/:id", async (c) => {
  const cellarId = Number(c.req.param("id"));
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  const cellar = await d1.getCellar(DB(c), cellarId);
  const out = { id: cellar.id, name: cellar.name, role: a.role, members: await d1.listMembers(DB(c), cellarId) };
  if (a.role === "owner") out.inviteCode = cellar.invite_code;
  return c.json(out);
});

// Rename a cellar (owner only).
app.put("/api/cellars/:id", async (c) => {
  const cellarId = Number(c.req.param("id"));
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  if (a.role !== "owner") return c.json({ error: "Kun ejeren kan omdøbe kælderen" }, 403);
  const n = String((await body(c)).name || "").trim().slice(0, 100);
  if (!n) return c.json({ error: "Giv kælderen et navn" }, 400);
  await d1.renameCellar(DB(c), cellarId, n);
  return c.json({ ok: true, name: n });
});

app.post("/api/cellars/:id/invite/regenerate", async (c) => {
  const cellarId = Number(c.req.param("id"));
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  if (a.role !== "owner") return deny(c, 403);
  const code = auth.randomInviteCode();
  await d1.setInviteCode(DB(c), cellarId, code);
  return c.json({ inviteCode: code });
});

app.post("/api/cellars/:id/members/remove", async (c) => {
  const cellarId = Number(c.req.param("id"));
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  const userId = Number((await body(c)).userId);
  // The owner can remove anyone; a member can leave on their own.
  if (a.role !== "owner" && userId !== a.user.id) return deny(c, 403);
  await d1.removeMember(DB(c), cellarId, userId);
  return c.json({ ok: true });
});

app.delete("/api/cellars/:id", async (c) => {
  const cellarId = Number(c.req.param("id"));
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  if (a.role !== "owner") return deny(c, 403);
  await deleteObjects(c, await d1.photoKeysForCellar(DB(c), cellarId));
  await d1.deleteCellar(DB(c), cellarId);
  return c.json({ ok: true });
});

app.post("/api/join", async (c) => {
  const user = c.get("user");
  if (!user) return deny(c, 401);
  const cellar = await d1.getCellarByInvite(DB(c), String((await body(c)).code || "").trim());
  if (!cellar) return c.json({ error: "Invitationen er ugyldig eller udløbet" }, 404);
  await d1.addMember(DB(c), cellar.id, user.id, "member");
  return c.json({ cellarId: cellar.id, name: cellar.name });
});

// ============================ PHOTOS ======================================
// Bottle pictures are kept permanently in R2: `<key>` (full size, ~2000px) and
// `<key>.thumb` (~400px). Both are resized in the browser before upload.

async function storePhoto(c, cellarId, wineId, form) {
  const photo = form.get("photo");
  const thumb = form.get("thumb");
  if (!(photo instanceof File) || !photo.size) return { error: "Mangler billede" };
  if (photo.size > MAX_PHOTO_BYTES) return { error: "Billedet er for stort" };
  const buf = await photo.arrayBuffer();
  const key = `c${cellarId}/${crypto.randomUUID()}.jpg`;
  const meta = { httpMetadata: { contentType: "image/jpeg" } };
  await c.env.PHOTOS.put(key, buf, meta);
  if (thumb instanceof File && thumb.size && thumb.size <= MAX_PHOTO_BYTES) {
    await c.env.PHOTOS.put(key + ".thumb", await thumb.arrayBuffer(), meta);
  }
  const kind = ["forside", "bagside", "andet"].includes(form.get("kind")) ? form.get("kind") : "forside";
  const id = await d1.createPhoto(DB(c), { cellarId, wineId, key, kind, userId: c.get("user").id });
  return { id, buf };
}

async function deleteObjects(c, keys) {
  const all = keys.flatMap((k) => [k, k + ".thumb"]);
  for (let i = 0; i < all.length; i += 1000) await c.env.PHOTOS.delete(all.slice(i, i + 1000));
}

// Scan: save the photo (not yet attached to a wine) and let Claude read the label.
app.post("/api/scan", async (c) => {
  const cellarId = Number(c.req.query("cellar"));
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  const stored = await storePhoto(c, cellarId, null, await c.req.formData());
  if (stored.error) return c.json({ error: stored.error }, 400);
  const { draft, error } = await readLabel(c.env.ANTHROPIC_API_KEY, stored.buf);
  return c.json({ photoId: stored.id, draft, aiError: error });
});

// Add another picture to an existing wine.
app.post("/api/wines/:id/photos", async (c) => {
  const wa = await wineAccess(c, Number(c.req.param("id")));
  if (wa.error) return deny(c, wa.error);
  const stored = await storePhoto(c, wa.wine.cellar_id, wa.wine.id, await c.req.formData());
  if (stored.error) return c.json({ error: stored.error }, 400);
  return c.json({ id: stored.id }, 201);
});

async function photoAccess(c, id) {
  const photo = await d1.getPhoto(DB(c), id);
  if (!photo) return { error: 404 };
  const a = await access(c, photo.cellar_id);
  return a.error ? a : { ...a, photo };
}

app.get("/api/photos/:id", async (c) => {
  const pa = await photoAccess(c, Number(c.req.param("id")));
  if (pa.error) return deny(c, pa.error);
  const wantThumb = c.req.query("size") === "thumb";
  let obj = wantThumb ? await c.env.PHOTOS.get(pa.photo.r2_key + ".thumb") : null;
  if (!obj) obj = await c.env.PHOTOS.get(pa.photo.r2_key);
  if (!obj) return deny(c, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "image/jpeg",
      // Private: only for logged-in members, but immutable per id.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

app.delete("/api/photos/:id", async (c) => {
  const pa = await photoAccess(c, Number(c.req.param("id")));
  if (pa.error) return deny(c, pa.error);
  await deleteObjects(c, [pa.photo.r2_key]);
  await d1.deletePhoto(DB(c), pa.photo.id);
  return c.json({ ok: true });
});

// ============================ WINES =======================================

const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const num = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v); // accept Danish decimal comma
  return Number.isFinite(n) ? n : null;
};
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : new Date().toISOString().slice(0, 10));
const COLORS = ["rød", "hvid", "rosé", "mousserende", "dessert", "orange"];

function cleanWine(b) {
  const vintage = num(b.vintage);
  return {
    name: str(b.name, 200),
    producer: str(b.producer, 200),
    vintage: vintage && vintage >= 1800 && vintage <= 2100 ? Math.trunc(vintage) : null,
    grapes: str(b.grapes),
    country: str(b.country, 100),
    region: str(b.region, 100),
    appellation: str(b.appellation, 200),
    color: COLORS.includes(b.color) ? b.color : "",
    alcohol: num(b.alcohol),
    label_text: str(b.label_text, 4000),
  };
}
function cleanTasting(b) {
  const r = num(b.rating);
  return {
    date: isoDate(b.date),
    rating: r === null ? null : Math.min(5, Math.max(0.5, Math.round(r * 2) / 2)),
    notes: str(b.notes, 4000),
    aroma: str(b.aroma, 1000),
    taste: str(b.taste, 1000),
    food: str(b.food, 1000),
    place: str(b.place, 200),
  };
}
function cleanPurchase(b) {
  const q = Math.trunc(num(b.quantity) ?? 1);
  return {
    date: isoDate(b.date),
    shop: str(b.shop, 200),
    url: /^https?:\/\//i.test(str(b.url)) ? str(b.url, 1000) : "",
    price: num(b.price),
    currency: str(b.currency, 3).toUpperCase() || "DKK",
    quantity: q > 0 ? q : 1,
    note: str(b.note, 1000),
  };
}
const hasTasting = (t) => t && (num(t.rating) !== null || str(t.notes) || str(t.aroma) || str(t.taste));
const hasPurchase = (p) => p && (str(p.shop) || str(p.url) || num(p.price) !== null);

app.get("/api/wines", async (c) => {
  const cellarId = Number(c.req.query("cellar"));
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  return c.json(await d1.listWines(DB(c), cellarId, a.user.id));
});

// Create a wine, attach scanned photos and optionally a first tasting / purchase.
app.post("/api/wines", async (c) => {
  const b = await body(c);
  const cellarId = Number(b.cellarId);
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  const w = cleanWine(b);
  if (!w.name && !w.producer) return c.json({ error: "Skriv i det mindste navn eller producent" }, 400);
  if (!w.name) w.name = w.producer;

  const id = await d1.createWine(DB(c), cellarId, a.user.id, w);
  await d1.attachPhotos(DB(c), cellarId, id, b.photoIds);
  if (hasTasting(b.tasting)) {
    await d1.createEntry(DB(c), "tastings", d1.TASTING_FIELDS, id, a.user.id, cleanTasting(b.tasting));
  }
  if (hasPurchase(b.purchase)) {
    await d1.createEntry(DB(c), "purchases", d1.PURCHASE_FIELDS, id, a.user.id, cleanPurchase(b.purchase));
  }
  return c.json({ id }, 201);
});

app.get("/api/wines/:id", async (c) => {
  const wa = await wineAccess(c, Number(c.req.param("id")));
  if (wa.error) return deny(c, wa.error);
  const db = DB(c);
  return c.json({
    wine: wa.wine,
    role: wa.role,
    me: wa.user.id,
    photos: await d1.photosForWine(db, wa.wine.id),
    tastings: await d1.tastingsForWine(db, wa.wine.id),
    purchases: await d1.purchasesForWine(db, wa.wine.id),
  });
});

app.put("/api/wines/:id", async (c) => {
  const wa = await wineAccess(c, Number(c.req.param("id")));
  if (wa.error) return deny(c, wa.error);
  const w = cleanWine(await body(c));
  if (!w.name) return c.json({ error: "Vinen skal have et navn" }, 400);
  await d1.updateWine(DB(c), wa.wine.id, w);
  return c.json({ ok: true });
});

app.delete("/api/wines/:id", async (c) => {
  const wa = await wineAccess(c, Number(c.req.param("id")));
  if (wa.error) return deny(c, wa.error);
  if (wa.role !== "owner" && wa.wine.created_by !== wa.user.id) {
    return c.json({ error: "Kun den der oprettede vinen eller kælderens ejer kan slette den" }, 403);
  }
  await deleteObjects(c, await d1.photoKeysForWine(DB(c), wa.wine.id));
  await d1.deleteWine(DB(c), wa.wine.id);
  return c.json({ ok: true });
});

// ---- tastings & purchases (each member adds their own) -------------------

for (const [table, fields, clean] of [
  ["tastings", d1.TASTING_FIELDS, cleanTasting],
  ["purchases", d1.PURCHASE_FIELDS, cleanPurchase],
]) {
  app.post(`/api/wines/:id/${table}`, async (c) => {
    const wa = await wineAccess(c, Number(c.req.param("id")));
    if (wa.error) return deny(c, wa.error);
    const id = await d1.createEntry(DB(c), table, fields, wa.wine.id, wa.user.id, clean(await body(c)));
    return c.json({ id }, 201);
  });

  app.delete(`/api/${table}/:id`, async (c) => {
    const entry = await d1.getEntry(DB(c), table, Number(c.req.param("id")));
    if (!entry) return deny(c, 404);
    const wa = await wineAccess(c, entry.wine_id);
    if (wa.error) return deny(c, wa.error);
    if (entry.user_id !== wa.user.id && wa.role !== "owner") return deny(c, 403);
    await d1.deleteEntry(DB(c), table, entry.id);
    return c.json({ ok: true });
  });
}

// ---- CSV export -----------------------------------------------------------

app.get("/api/export.csv", async (c) => {
  const cellarId = Number(c.req.query("cellar"));
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  const rows = await d1.exportRows(DB(c), cellarId);
  const cols = ["id", "name", "producer", "vintage", "grapes", "country", "region", "appellation",
    "color", "alcohol", "avg_rating", "tasting_notes", "purchases"];
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // Semicolon-separated with BOM so Danish Excel opens it directly.
  const csv = "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((k) => cell(r[k])).join(";"))].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vin-${cellarId}.csv"`,
    },
  });
});

app.all("/api/*", (c) => deny(c, 404));

export default app;
