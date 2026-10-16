import { Hono } from "hono";
import * as d1 from "./d1.js";
import * as auth from "./auth.js";
import { readLabel, readWineList } from "./label.js";

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
  const fileKeys = await d1.cellarEventFileKeys(DB(c), cellarId);
  if (fileKeys.length) await c.env.PHOTOS.delete(fileKeys);
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
    kind: TASTING_KINDS.includes(b.kind) ? b.kind : "",
  };
}
const TASTING_KINDS = ["hjemme", "restaurant", "smagning", "andet"];
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
  const wines = await d1.listWines(DB(c), cellarId, a.user.id);
  // Until migration 0004 is applied remotely the kind column is missing; the list
  // still works then, just without the quick filters.
  const sources = await d1.wineSources(DB(c), cellarId).catch((e) => {
    console.error("wineSources failed (migration 0004 applied?)", e);
    return new Map();
  });
  return c.json(wines.map((w) => {
    const src = sources.get(w.id);
    return { ...w, kinds: src ? [...src.kinds] : [], sources: src ? [...src.sources] : [] };
  }));
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
    placements: await d1.placementsForWine(db, wa.wine.id),
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

// ============================ STORAGE =====================================
// Wine fridges (vinkøleskab, with temperature zones) and racks (vinreol). Any
// member can create one and place bottles; only its creator or the cellar
// owner can delete it.

const MAX_SHELVES = 50;
const MAX_SLOTS = 200;
const MAX_LAYERS = 3;
const MAX_ROWS = 2;

/** Validate a storage body. Returns { value } or { error }. */
function cleanStorage(b) {
  const name = str(b.name, 100);
  if (!name) return { error: "Giv den et navn" };
  const kind = b.kind === "koleskab" ? "koleskab" : "reol";
  // Each shelf is a list of layers (bottom first), each a list of rows (front
  // first) with a bottle count: [[6, 6], [4, 4]] = two layers, front and back.
  // Older clients send plain numbers (one row per shelf).
  const raw = Array.isArray(b.layouts) ? b.layouts : Array.isArray(b.shelves) ? b.shelves.map((n) => [[n]]) : [];
  if (!raw.length || raw.length > MAX_SHELVES) return { error: `Antal hylder skal være 1–${MAX_SHELVES}` };
  const layouts = [];
  for (const shelf of raw) {
    const layers = (Array.isArray(shelf) ? shelf : [[shelf]]).map((layer) =>
      (Array.isArray(layer) ? layer : [layer]).map((n) => Math.trunc(num(n) ?? 0))
    );
    if (!layers.length || layers.length > MAX_LAYERS || layers.some((l) => !l.length || l.length > MAX_ROWS)) {
      return { error: `En hylde kan have 1–${MAX_LAYERS} lag med højst ${MAX_ROWS} rækker (for og bag)` };
    }
    if (layers.flat().some((n) => n < 1 || n > MAX_SLOTS)) return { error: `Flasker pr. række skal være 1–${MAX_SLOTS}` };
    if (layers.flat().reduce((x, y) => x + y, 0) > MAX_SLOTS) return { error: `Højst ${MAX_SLOTS} flasker pr. hylde` };
    layouts.push(layers);
  }
  const shelfSlots = layouts.map((l) => l.flat().reduce((x, y) => x + y, 0));
  const zones = [];
  if (kind === "koleskab") {
    for (const z of Array.isArray(b.zones) ? b.zones : []) {
      const from = Math.trunc(num(z.from_shelf) ?? 0);
      const to = Math.trunc(num(z.to_shelf) ?? 0);
      if (from < 1 || to < from || to > shelfSlots.length) {
        return { error: `En zone skal dække hylder mellem 1 og ${shelfSlots.length}` };
      }
      const temp = num(z.temp);
      if (temp !== null && (temp < -5 || temp > 30)) return { error: "Temperaturen skal være mellem -5 og 30 °C" };
      zones.push({ name: str(z.name, 50), temp, from_shelf: from, to_shelf: to });
    }
    zones.sort((a, b) => a.from_shelf - b.from_shelf);
    for (let i = 1; i < zones.length; i++) {
      if (zones[i].from_shelf <= zones[i - 1].to_shelf) return { error: "Zonerne må ikke overlappe" };
    }
  }
  return { value: { name, kind, shelfSlots, shelfLayout: layouts.map(layoutString).join(","), note: str(b.note, 500), zones } };
}

async function storageAccess(c, id) {
  const storage = await d1.getStorage(DB(c), id);
  if (!storage) return { error: 404 };
  const a = await access(c, storage.cellar_id);
  return a.error ? a : { ...a, storage };
}
// shelf_slots text: shelves separated by ",", layers (bottom first) by "/",
// rows within a layer (front first) by "+". "6" = one row of 6; "6+6/4+4" =
// a lower layer of 6 front + 6 back and an upper layer of 4 + 4.
const layoutString = (layers) => layers.map((l) => l.join("+")).join("/");
const shelfLayouts = (s) => s.shelf_slots.split(",").map((sh) => sh.split("/").map((l) => l.split("+").map(Number)));
const shelfList = (s) => shelfLayouts(s).map((l) => l.flat().reduce((x, y) => x + y, 0));

app.get("/api/storages", async (c) => {
  const cellarId = Number(c.req.query("cellar"));
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  const zones = await d1.zonesForCellar(DB(c), cellarId);
  const rows = await d1.listStorages(DB(c), cellarId);
  return c.json(rows.map((s) => {
    const shelves = shelfList(s);
    return { ...s, shelves, layouts: shelfLayouts(s), capacity: shelves.reduce((x, y) => x + y, 0), zones: zones.filter((z) => z.storage_id === s.id) };
  }));
});

app.post("/api/storages", async (c) => {
  const b = await body(c);
  const cellarId = Number(b.cellarId);
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  const v = cleanStorage(b);
  if (v.error) return c.json({ error: v.error }, 400);
  const id = await d1.saveStorage(DB(c), { ...v.value, cellarId, userId: a.user.id });
  return c.json({ id }, 201);
});

app.get("/api/storages/:id", async (c) => {
  const sa = await storageAccess(c, Number(c.req.param("id")));
  if (sa.error) return deny(c, sa.error);
  const db = DB(c);
  return c.json({
    storage: { ...sa.storage, shelves: shelfList(sa.storage), layouts: shelfLayouts(sa.storage) },
    zones: await d1.zonesForStorage(db, sa.storage.id),
    placements: await d1.placementsForStorage(db, sa.storage.id),
    canDelete: sa.role === "owner" || sa.storage.created_by === sa.user.id,
  });
});

app.put("/api/storages/:id", async (c) => {
  const sa = await storageAccess(c, Number(c.req.param("id")));
  if (sa.error) return deny(c, sa.error);
  const v = cleanStorage(await body(c));
  if (v.error) return c.json({ error: v.error }, 400);
  const outside = await d1.placementsOutside(DB(c), sa.storage.id, v.value.shelfSlots);
  if (outside) {
    return c.json({ error: `${outside} flaske${outside === 1 ? "" : "r"} står på pladser der forsvinder — flyt eller fjern dem først` }, 409);
  }
  await d1.saveStorage(DB(c), { ...v.value, id: sa.storage.id });
  return c.json({ ok: true });
});

app.delete("/api/storages/:id", async (c) => {
  const sa = await storageAccess(c, Number(c.req.param("id")));
  if (sa.error) return deny(c, sa.error);
  if (sa.role !== "owner" && sa.storage.created_by !== sa.user.id) {
    return c.json({ error: "Kun den der oprettede den eller kælderens ejer kan slette den" }, 403);
  }
  await d1.deleteStorage(DB(c), sa.storage.id);
  return c.json({ ok: true });
});

/** Shelf/slot from a body, validated against the storage layout. */
function spot(storage, b) {
  const shelves = shelfList(storage);
  const shelf = Math.trunc(num(b.shelf) ?? 0);
  const slot = Math.trunc(num(b.slot) ?? 0);
  if (shelf < 1 || shelf > shelves.length || slot < 1 || slot > shelves[shelf - 1]) return null;
  return { shelf, slot };
}

// Put a bottle of a wine (from the same cellar) in a free spot.
app.post("/api/storages/:id/placements", async (c) => {
  const sa = await storageAccess(c, Number(c.req.param("id")));
  if (sa.error) return deny(c, sa.error);
  const b = await body(c);
  const wine = await d1.getWine(DB(c), Number(b.wineId));
  if (!wine || wine.cellar_id !== sa.storage.cellar_id) return c.json({ error: "Vælg en vin fra kælderen" }, 400);
  const pos = spot(sa.storage, b);
  if (!pos) return c.json({ error: "Ugyldig plads" }, 400);
  if (!(await d1.addPlacement(DB(c), sa.storage.id, wine.id, pos.shelf, pos.slot, sa.user.id))) {
    return c.json({ error: "Pladsen er optaget" }, 409);
  }
  return c.json({ ok: true }, 201);
});

async function placementAccess(c, id) {
  const p = await d1.getPlacement(DB(c), id);
  if (!p) return { error: 404 };
  const sa = await storageAccess(c, p.storage_id);
  return sa.error ? sa : { ...sa, placement: p };
}

// Move a bottle to another free spot in the same fridge/rack.
app.put("/api/placements/:id", async (c) => {
  const pa = await placementAccess(c, Number(c.req.param("id")));
  if (pa.error) return deny(c, pa.error);
  const pos = spot(pa.storage, await body(c));
  if (!pos) return c.json({ error: "Ugyldig plads" }, 400);
  if (!(await d1.movePlacement(DB(c), pa.placement.id, pos.shelf, pos.slot))) {
    return c.json({ error: "Pladsen er optaget" }, 409);
  }
  return c.json({ ok: true });
});

// Take a bottle out (drunk, given away, moved elsewhere).
app.delete("/api/placements/:id", async (c) => {
  const pa = await placementAccess(c, Number(c.req.param("id")));
  if (pa.error) return deny(c, pa.error);
  await d1.deletePlacement(DB(c), pa.placement.id);
  return c.json({ ok: true });
});

// ============================ TASTING EVENTS ==============================
// A smagning: place, date/time, one house or several. Wines are added by photo
// (label read via /api/scan) or picked from the cellar, each with a normal price
// and the offer price on the day. Every member keeps their own note + rating,
// stored as an ordinary tasting linked to the event.

function cleanEvent(b) {
  const planned = Math.trunc(num(b.planned_count) ?? 0);
  return {
    title: str(b.title, 150),
    place: str(b.place, 200),
    date: isoDate(b.date),
    time: /^\d{2}:\d{2}$/.test(String(b.time || "")) ? String(b.time) : "",
    kind: b.kind === "hus" ? "hus" : "blandet",
    house: b.kind === "hus" ? str(b.house, 200) : "",
    planned_count: planned > 0 && planned <= 200 ? planned : null,
    note: str(b.note, 2000),
  };
}
function cleanPrices(b) {
  const price = (v) => {
    const n = num(v);
    return n !== null && n >= 0 && n < 1e7 ? Math.round(n * 100) / 100 : null;
  };
  return {
    normal_price: price(b.normal_price),
    offer_price: price(b.offer_price),
    currency: str(b.currency, 3).toUpperCase() || "DKK",
    shop: str(b.shop, 200),
  };
}

async function eventAccess(c, id) {
  const event = await d1.getEvent(DB(c), id);
  if (!event) return { error: 404 };
  const a = await access(c, event.cellar_id);
  return a.error ? a : { ...a, event };
}
async function eventWineAccess(c, id) {
  const ew = await d1.getEventWine(DB(c), id);
  if (!ew) return { error: 404 };
  const ea = await eventAccess(c, ew.event_id);
  return ea.error ? ea : { ...ea, ew };
}

app.get("/api/events", async (c) => {
  const cellarId = Number(c.req.query("cellar"));
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  return c.json(await d1.listEvents(DB(c), cellarId));
});

app.post("/api/events", async (c) => {
  const b = await body(c);
  const cellarId = Number(b.cellarId);
  const a = await access(c, cellarId);
  if (a.error) return deny(c, a.error);
  const e = cleanEvent(b);
  if (!e.title) e.title = e.kind === "hus" && e.house ? "Smagning hos " + e.house : "Vinsmagning";
  const id = await d1.createEvent(DB(c), cellarId, a.user.id, e);
  return c.json({ id }, 201);
});

app.get("/api/events/:id", async (c) => {
  const ea = await eventAccess(c, Number(c.req.param("id")));
  if (ea.error) return deny(c, ea.error);
  const db = DB(c);
  const tastings = await d1.eventTastings(db, ea.event.id);
  const wines = (await d1.eventWines(db, ea.event.id)).map((w) => {
    const ts = tastings.filter((t) => t.wine_id === w.wine_id);
    const rated = ts.filter((t) => t.rating !== null);
    return {
      ...w,
      tastings: ts,
      avg_rating: rated.length ? Math.round((rated.reduce((x, t) => x + t.rating, 0) / rated.length) * 10) / 10 : null,
    };
  });
  const files = await d1.eventFiles(db, ea.event.id).catch(() => []);
  return c.json({
    event: ea.event,
    wines,
    files,
    me: ea.user.id,
    canManage: ea.role === "owner" || ea.event.created_by === ea.user.id,
  });
});

app.put("/api/events/:id", async (c) => {
  const ea = await eventAccess(c, Number(c.req.param("id")));
  if (ea.error) return deny(c, ea.error);
  const e = cleanEvent(await body(c));
  if (!e.title) return c.json({ error: "Giv smagningen en titel" }, 400);
  await d1.updateEvent(DB(c), ea.event.id, e);
  return c.json({ ok: true });
});

app.delete("/api/events/:id", async (c) => {
  const ea = await eventAccess(c, Number(c.req.param("id")));
  if (ea.error) return deny(c, ea.error);
  if (ea.role !== "owner" && ea.event.created_by !== ea.user.id) {
    return c.json({ error: "Kun den der oprettede smagningen eller kælderens ejer kan slette den" }, 403);
  }
  const keys = await d1.eventFileKeys(DB(c), ea.event.id).catch(() => []);
  if (keys.length) await c.env.PHOTOS.delete(keys);
  await d1.deleteEvent(DB(c), ea.event.id);
  return c.json({ ok: true });
});

// Add a wine to the tasting: an existing cellar wine ({ wineId }) or a new one
// from the scanned label ({ name, producer, ..., photoIds }), plus prices.
app.post("/api/events/:id/wines", async (c) => {
  const ea = await eventAccess(c, Number(c.req.param("id")));
  if (ea.error) return deny(c, ea.error);
  const b = await body(c);
  const db = DB(c);
  let wineId;
  if (b.wineId) {
    const wine = await d1.getWine(db, Number(b.wineId));
    if (!wine || wine.cellar_id !== ea.event.cellar_id) return c.json({ error: "Vælg en vin fra kælderen" }, 400);
    wineId = wine.id;
  } else {
    const w = cleanWine(b);
    if (!w.name && !w.producer) return c.json({ error: "Skriv i det mindste navn eller producent" }, 400);
    if (!w.name) w.name = w.producer;
    wineId = await d1.createWine(db, ea.event.cellar_id, ea.user.id, w);
    await d1.attachPhotos(db, ea.event.cellar_id, wineId, b.photoIds);
  }
  if (!(await d1.addEventWine(db, ea.event.id, wineId, ea.user.id, cleanPrices(b)))) {
    return c.json({ error: "Vinen er allerede med i smagningen" }, 409);
  }
  if (hasTasting(b.tasting)) {
    await d1.upsertEventTasting(db, ea.event.id, wineId, ea.user.id, eventTasting(ea.event, b.tasting));
  }
  return c.json({ wineId }, 201);
});

app.put("/api/event-wines/:id", async (c) => {
  const wa = await eventWineAccess(c, Number(c.req.param("id")));
  if (wa.error) return deny(c, wa.error);
  await d1.updateEventWinePrices(DB(c), wa.ew.id, cleanPrices(await body(c)));
  return c.json({ ok: true });
});

app.delete("/api/event-wines/:id", async (c) => {
  const wa = await eventWineAccess(c, Number(c.req.param("id")));
  if (wa.error) return deny(c, wa.error);
  if (wa.role !== "owner" && wa.event.created_by !== wa.user.id && wa.ew.created_by !== wa.user.id) return deny(c, 403);
  await d1.deleteEventWine(DB(c), wa.ew);
  return c.json({ ok: true });
});

/** A note taken at the event is dated and placed at the event. */
function eventTasting(event, t) {
  return { ...cleanTasting(t), date: event.date, place: event.place || event.title, kind: "smagning" };
}

// My note + rating for a wine at this tasting (one per person, editable).
app.put("/api/event-wines/:id/tasting", async (c) => {
  const wa = await eventWineAccess(c, Number(c.req.param("id")));
  if (wa.error) return deny(c, wa.error);
  const id = await d1.upsertEventTasting(DB(c), wa.event.id, wa.ew.wine_id, wa.user.id, eventTasting(wa.event, await body(c)));
  return c.json({ id });
});

// "Jeg købte": record a purchase at the offer price (or the normal price).
app.post("/api/event-wines/:id/purchase", async (c) => {
  const wa = await eventWineAccess(c, Number(c.req.param("id")));
  if (wa.error) return deny(c, wa.error);
  const b = await body(c);
  const p = cleanPurchase({
    date: wa.event.date,
    shop: wa.ew.shop || (wa.event.kind === "hus" && wa.event.house ? wa.event.house : wa.event.place || wa.event.title),
    price: wa.ew.offer_price ?? wa.ew.normal_price,
    currency: wa.ew.currency,
    quantity: b.quantity,
    note: "Købt til " + wa.event.title,
  });
  const id = await d1.createEntry(DB(c), "purchases", d1.PURCHASE_FIELDS, wa.ew.wine_id, wa.user.id, p);
  return c.json({ id }, 201);
});

// ---- the tasting's wine list (photo or PDF) -------------------------------
// Kept in R2 with the event and read with Claude into rows the user ticks off
// before they are added as wines (via POST /api/events/:id/wines).

const MAX_LIST_BYTES = 15 * 1024 * 1024;
const LIST_TYPES = { "image/jpeg": "jpg", "application/pdf": "pdf" };

app.post("/api/events/:id/files", async (c) => {
  const ea = await eventAccess(c, Number(c.req.param("id")));
  if (ea.error) return deny(c, ea.error);
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return c.json({ error: "Vælg et billede eller en PDF" }, 400);
  const type = file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "application/pdf" : file.type;
  if (!LIST_TYPES[type]) return c.json({ error: "Vinlisten skal være et billede eller en PDF" }, 400);
  if (file.size > MAX_LIST_BYTES) return c.json({ error: "Filen er for stor (højst 15 MB)" }, 400);
  const bytes = await file.arrayBuffer();
  const key = `c${ea.event.cellar_id}/ev${ea.event.id}/${crypto.randomUUID()}.${LIST_TYPES[type]}`;
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  const name = str(form.get("name") || file.name, 200);
  const id = await d1.createEventFile(DB(c), { eventId: ea.event.id, key, contentType: type, name, userId: ea.user.id });
  const out = { file: { id, content_type: type, name } };
  if (form.get("read") === "1") Object.assign(out, await readList(c, bytes, type));
  return c.json(out, 201);
});

async function readList(c, bytes, type) {
  const { rows, shop, error } = await readWineList(c.env.ANTHROPIC_API_KEY, bytes, type);
  return { rows, shop: shop || "", aiError: error };
}

async function eventFileAccess(c, id) {
  const f = await d1.getEventFile(DB(c), id);
  if (!f) return { error: 404 };
  const ea = await eventAccess(c, f.event_id);
  return ea.error ? ea : { ...ea, file: f };
}

app.get("/api/event-files/:id", async (c) => {
  const fa = await eventFileAccess(c, Number(c.req.param("id")));
  if (fa.error) return deny(c, fa.error);
  const obj = await c.env.PHOTOS.get(fa.file.r2_key);
  if (!obj) return deny(c, 404);
  const ext = LIST_TYPES[fa.file.content_type] || "bin";
  const filename = (fa.file.name || "vinliste").replace(/[^\w.\- æøåÆØÅ]/g, "_").replace(/\.(pdf|jpe?g)$/i, "") + "." + ext;
  return new Response(obj.body, {
    headers: {
      "Content-Type": fa.file.content_type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

// Read an already uploaded list again (e.g. after the first try failed).
app.post("/api/event-files/:id/read", async (c) => {
  const fa = await eventFileAccess(c, Number(c.req.param("id")));
  if (fa.error) return deny(c, fa.error);
  const obj = await c.env.PHOTOS.get(fa.file.r2_key);
  if (!obj) return deny(c, 404);
  return c.json(await readList(c, await obj.arrayBuffer(), fa.file.content_type));
});

app.delete("/api/event-files/:id", async (c) => {
  const fa = await eventFileAccess(c, Number(c.req.param("id")));
  if (fa.error) return deny(c, fa.error);
  if (fa.role !== "owner" && fa.event.created_by !== fa.user.id && fa.file.created_by !== fa.user.id) return deny(c, 403);
  await c.env.PHOTOS.delete(fa.file.r2_key);
  await d1.deleteEventFile(DB(c), fa.file.id);
  return c.json({ ok: true });
});

app.all("/api/*", (c) => deny(c, 404));

export default app;
