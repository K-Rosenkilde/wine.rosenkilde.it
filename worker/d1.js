// D1 data access for the Worker. `db` is the D1 binding (env.DB).
// Users / sessions / cellars / memberships mirror games.rosenkilde.it.

const all = async (stmt) => (await stmt.all()).results || [];

// ---- users & sessions -----------------------------------------------------

export async function getUserByEmail(db, email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
}
export async function createUser(db, { email, name, hash, salt }) {
  const res = await db
    .prepare("INSERT INTO users (email, name, pw_hash, pw_salt) VALUES (?, ?, ?, ?)")
    .bind(email, name || "", hash, salt)
    .run();
  return res.meta.last_row_id;
}
export async function createSession(db, sessionId, userId, expires) {
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, userId, expires)
    .run();
}
/** Returns the user for a valid, unexpired session, else null. */
export async function userForSession(db, sessionId) {
  const row = await db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
    .bind(sessionId)
    .first();
  return row || null;
}
export async function setUserName(db, userId, name) {
  await db.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, userId).run();
}
export async function deleteSession(db, sessionId) {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

// ---- cellars & memberships ------------------------------------------------

export async function createCellar(db, name, ownerId, inviteCode) {
  const res = await db
    .prepare("INSERT INTO cellars (name, owner_id, invite_code) VALUES (?, ?, ?)")
    .bind(name, ownerId, inviteCode)
    .run();
  const cellarId = res.meta.last_row_id;
  await db
    .prepare("INSERT INTO memberships (cellar_id, user_id, role) VALUES (?, ?, 'owner')")
    .bind(cellarId, ownerId)
    .run();
  return cellarId;
}
export async function getCellar(db, id) {
  return db.prepare("SELECT * FROM cellars WHERE id = ?").bind(id).first();
}
export async function getCellarByInvite(db, code) {
  return db.prepare("SELECT * FROM cellars WHERE invite_code = ?").bind(code).first();
}
export async function setInviteCode(db, cellarId, code) {
  await db.prepare("UPDATE cellars SET invite_code = ? WHERE id = ?").bind(code, cellarId).run();
}
export async function renameCellar(db, cellarId, name) {
  await db.prepare("UPDATE cellars SET name = ? WHERE id = ?").bind(name, cellarId).run();
}
export async function deleteCellar(db, cellarId) {
  await db.prepare("DELETE FROM cellars WHERE id = ?").bind(cellarId).run();
}

/** Cellars the user belongs to, with their role, member and wine counts. */
export async function cellarsForUser(db, userId) {
  return all(
    db
      .prepare(
        `SELECT c.id, c.name, m.role,
                (SELECT COUNT(*) FROM memberships mm WHERE mm.cellar_id = c.id) AS members,
                (SELECT COUNT(*) FROM wines w WHERE w.cellar_id = c.id) AS wines
         FROM memberships m JOIN cellars c ON c.id = m.cellar_id
         WHERE m.user_id = ?
         ORDER BY c.id DESC`
      )
      .bind(userId)
  );
}
export async function getMembership(db, cellarId, userId) {
  return db
    .prepare("SELECT * FROM memberships WHERE cellar_id = ? AND user_id = ?")
    .bind(cellarId, userId)
    .first();
}
export async function addMember(db, cellarId, userId, role = "member") {
  await db
    .prepare(
      `INSERT INTO memberships (cellar_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(cellar_id, user_id) DO NOTHING`
    )
    .bind(cellarId, userId, role)
    .run();
}
export async function listMembers(db, cellarId) {
  return all(
    db
      .prepare(
        `SELECT u.id, u.name, u.email, m.role
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.cellar_id = ? ORDER BY m.role = 'owner' DESC, u.name`
      )
      .bind(cellarId)
  );
}
export async function removeMember(db, cellarId, userId) {
  await db
    .prepare("DELETE FROM memberships WHERE cellar_id = ? AND user_id = ? AND role != 'owner'")
    .bind(cellarId, userId)
    .run();
}

// ---- wines ----------------------------------------------------------------

export const WINE_FIELDS = [
  "name", "producer", "vintage", "grapes", "country", "region",
  "appellation", "color", "alcohol", "label_text",
];

/** Wine list for a cellar with cover photo, ratings and purchase summary. */
export async function listWines(db, cellarId, userId) {
  return all(
    db
      .prepare(
        `SELECT w.*,
           (SELECT p.id FROM photos p WHERE p.wine_id = w.id ORDER BY p.id LIMIT 1) AS cover_id,
           (SELECT ROUND(AVG(t.rating), 1) FROM tastings t WHERE t.wine_id = w.id AND t.rating IS NOT NULL) AS avg_rating,
           (SELECT t.rating FROM tastings t WHERE t.wine_id = w.id AND t.user_id = ? AND t.rating IS NOT NULL
              ORDER BY t.date DESC, t.id DESC LIMIT 1) AS my_rating,
           (SELECT COUNT(*) FROM tastings t WHERE t.wine_id = w.id) AS tastings,
           (SELECT MAX(t.date) FROM tastings t WHERE t.wine_id = w.id) AS last_tasted,
           (SELECT COALESCE(SUM(pu.quantity), 0) FROM purchases pu WHERE pu.wine_id = w.id) AS bought,
           (SELECT COUNT(*) FROM placements pl WHERE pl.wine_id = w.id) AS stored,
           (SELECT pu.price FROM purchases pu WHERE pu.wine_id = w.id ORDER BY pu.date DESC, pu.id DESC LIMIT 1) AS last_price,
           (SELECT pu.currency FROM purchases pu WHERE pu.wine_id = w.id ORDER BY pu.date DESC, pu.id DESC LIMIT 1) AS last_currency
         FROM wines w WHERE w.cellar_id = ?
         ORDER BY w.id DESC`
      )
      .bind(userId, cellarId)
  );
}

export async function getWine(db, id) {
  return db.prepare("SELECT * FROM wines WHERE id = ?").bind(id).first();
}

export async function createWine(db, cellarId, userId, w, inList = 1) {
  const run = (withList) =>
    db
      .prepare(
        `INSERT INTO wines (cellar_id, created_by, ${WINE_FIELDS.join(", ")}${withList ? ", in_list" : ""})
         VALUES (?, ?, ${WINE_FIELDS.map(() => "?").join(", ")}${withList ? ", ?" : ""})`
      )
      .bind(cellarId, userId, ...WINE_FIELDS.map((f) => w[f]), ...(withList ? [inList ? 1 : 0] : []))
      .run();
  let res;
  try {
    res = await run(true);
  } catch (e) {
    if (!/in_list/.test(String(e && e.message))) throw e;
    res = await run(false); // migration 0007 not applied yet
  }
  return res.meta.last_row_id;
}

/** Show a wine in the main wine list (1) or only under its tastings (0). */
export async function setInList(db, wineId, inList) {
  await db.prepare("UPDATE wines SET in_list = ? WHERE id = ?").bind(inList ? 1 : 0, wineId).run().catch((e) => {
    if (!/in_list/.test(String(e && e.message))) throw e;
  });
}
/** wine id -> in_list for a cellar (empty until migration 0007, meaning "all in the list"). */
export async function inListMap(db, cellarId) {
  const rows = await all(db.prepare("SELECT id, in_list FROM wines WHERE cellar_id = ?").bind(cellarId)).catch(() => []);
  return new Map(rows.map((r) => [r.id, r.in_list]));
}

/** Every tasting's wines for a cellar (for the list of tastings). */
export async function cellarEventWines(db, cellarId) {
  return all(
    db
      .prepare(
        `SELECT ew.id, ew.event_id, ew.wine_id, ew.position, w.name, w.producer, w.vintage, w.color,
                (SELECT ROUND(AVG(t.rating), 1) FROM tastings t WHERE t.event_id = ew.event_id AND t.wine_id = ew.wine_id AND t.rating IS NOT NULL) AS avg_rating,
                (SELECT COALESCE(SUM(p.quantity), 0) FROM purchases p WHERE p.wine_id = w.id) AS bought
         FROM event_wines ew JOIN events e ON e.id = ew.event_id JOIN wines w ON w.id = ew.wine_id
         WHERE e.cellar_id = ? ORDER BY ew.event_id, ew.position, ew.id`
      )
      .bind(cellarId)
  );
}

export async function updateWine(db, id, w) {
  await db
    .prepare(`UPDATE wines SET ${WINE_FIELDS.map((f) => f + " = ?").join(", ")} WHERE id = ?`)
    .bind(...WINE_FIELDS.map((f) => w[f]), id)
    .run();
}

export async function deleteWine(db, id) {
  await db.prepare("DELETE FROM wines WHERE id = ?").bind(id).run();
}

// ---- photos ---------------------------------------------------------------

export async function createPhoto(db, { cellarId, wineId, key, kind, userId }) {
  const res = await db
    .prepare("INSERT INTO photos (cellar_id, wine_id, r2_key, kind, created_by) VALUES (?, ?, ?, ?, ?)")
    .bind(cellarId, wineId ?? null, key, kind || "forside", userId)
    .run();
  return res.meta.last_row_id;
}
export async function getPhoto(db, id) {
  return db.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first();
}
export async function photosForWine(db, wineId) {
  return all(
    db.prepare("SELECT id, kind, created_at FROM photos WHERE wine_id = ? ORDER BY id").bind(wineId)
  );
}
/** Attach freshly scanned (unattached) photos of the same cellar to a wine. */
export async function attachPhotos(db, cellarId, wineId, photoIds) {
  const ids = (photoIds || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return;
  const stmt = db.prepare(
    "UPDATE photos SET wine_id = ? WHERE id = ? AND cellar_id = ? AND wine_id IS NULL"
  );
  await db.batch(ids.map((pid) => stmt.bind(wineId, pid, cellarId)));
}
export async function photoKeysForWine(db, wineId) {
  return (await all(db.prepare("SELECT r2_key FROM photos WHERE wine_id = ?").bind(wineId))).map((r) => r.r2_key);
}
export async function photoKeysForCellar(db, cellarId) {
  return (await all(db.prepare("SELECT r2_key FROM photos WHERE cellar_id = ?").bind(cellarId))).map((r) => r.r2_key);
}
export async function deletePhoto(db, id) {
  await db.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();
}

// ---- tastings & purchases -------------------------------------------------

export const TASTING_FIELDS = ["date", "rating", "notes", "aroma", "taste", "food", "place", "kind"];
export const PURCHASE_FIELDS = ["date", "shop", "url", "price", "currency", "quantity", "note"];

export async function tastingsForWine(db, wineId) {
  return all(
    db
      .prepare(
        `SELECT t.*, u.name AS user_name, u.email AS user_email, e.title AS event_title
         FROM tastings t JOIN users u ON u.id = t.user_id
         LEFT JOIN events e ON e.id = t.event_id
         WHERE t.wine_id = ? ORDER BY t.date DESC, t.id DESC`
      )
      .bind(wineId)
  );
}
export async function purchasesForWine(db, wineId) {
  return all(
    db
      .prepare(
        `SELECT p.*, u.name AS user_name, u.email AS user_email
         FROM purchases p JOIN users u ON u.id = p.user_id
         WHERE p.wine_id = ? ORDER BY p.date DESC, p.id DESC`
      )
      .bind(wineId)
  );
}

/** Insert into tastings/purchases. `table` is one of the two constants above. */
export async function createEntry(db, table, fields, wineId, userId, data) {
  const res = await db
    .prepare(
      `INSERT INTO ${table} (wine_id, user_id, ${fields.join(", ")})
       VALUES (?, ?, ${fields.map(() => "?").join(", ")})`
    )
    .bind(wineId, userId, ...fields.map((f) => data[f]))
    .run();
  return res.meta.last_row_id;
}
export async function getEntry(db, table, id) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
}
export async function deleteEntry(db, table, id) {
  await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
}

/** Flat rows for CSV export: one row per wine with its latest purchase + my latest tasting. */
export async function exportRows(db, cellarId) {
  return all(
    db
      .prepare(
        `SELECT w.id, w.name, w.producer, w.vintage, w.grapes, w.country, w.region, w.appellation,
                w.color, w.alcohol,
                (SELECT ROUND(AVG(t.rating), 1) FROM tastings t WHERE t.wine_id = w.id) AS avg_rating,
                (SELECT GROUP_CONCAT(t.date || ' ' || u.name || ': ' || t.notes, ' | ')
                   FROM tastings t JOIN users u ON u.id = t.user_id WHERE t.wine_id = w.id) AS tasting_notes,
                (SELECT GROUP_CONCAT(p.date || ' ' || p.shop || ' ' || COALESCE(p.price, '') || ' ' || p.currency
                   || ' x' || p.quantity, ' | ') FROM purchases p WHERE p.wine_id = w.id) AS purchases
         FROM wines w WHERE w.cellar_id = ? ORDER BY w.id`
      )
      .bind(cellarId)
  );
}

// ---- storage: wine fridges & racks ----------------------------------------

export async function listStorages(db, cellarId) {
  return all(
    db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM placements p WHERE p.storage_id = s.id) AS used
         FROM storages s WHERE s.cellar_id = ? ORDER BY s.name`
      )
      .bind(cellarId)
  );
}
export async function getStorage(db, id) {
  return db.prepare("SELECT * FROM storages WHERE id = ?").bind(id).first();
}
export async function zonesForStorage(db, storageId) {
  return all(
    db.prepare("SELECT * FROM storage_zones WHERE storage_id = ? ORDER BY from_shelf").bind(storageId)
  );
}
export async function zonesForCellar(db, cellarId) {
  return all(
    db
      .prepare(
        `SELECT z.* FROM storage_zones z JOIN storages s ON s.id = z.storage_id
         WHERE s.cellar_id = ? ORDER BY z.storage_id, z.from_shelf`
      )
      .bind(cellarId)
  );
}
export async function placementsForStorage(db, storageId) {
  return all(
    db
      .prepare(
        `SELECT p.id, p.shelf, p.slot, p.wine_id, w.name, w.producer, w.vintage, w.color,
                (SELECT ph.id FROM photos ph WHERE ph.wine_id = w.id ORDER BY ph.id LIMIT 1) AS cover_id
         FROM placements p JOIN wines w ON w.id = p.wine_id
         WHERE p.storage_id = ? ORDER BY p.shelf, p.slot`
      )
      .bind(storageId)
  );
}
export async function placementsForWine(db, wineId) {
  return all(
    db
      .prepare(
        `SELECT p.id, p.shelf, p.slot, s.id AS storage_id, s.name AS storage_name, s.kind, s.shelf_slots
         FROM placements p JOIN storages s ON s.id = p.storage_id
         WHERE p.wine_id = ? ORDER BY s.name, p.shelf, p.slot`
      )
      .bind(wineId)
  );
}

/** Insert or replace a storage with its zones. Returns the storage id. */
export async function saveStorage(db, { id, cellarId, userId, name, kind, shelfLayout, note, zones }) {
  let storageId = id;
  if (id) {
    await db
      .prepare("UPDATE storages SET name = ?, kind = ?, shelf_slots = ?, note = ? WHERE id = ?")
      .bind(name, kind, shelfLayout, note, id)
      .run();
  } else {
    const res = await db
      .prepare("INSERT INTO storages (cellar_id, name, kind, shelf_slots, note, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(cellarId, name, kind, shelfLayout, note, userId)
      .run();
    storageId = res.meta.last_row_id;
  }
  const ins = db.prepare(
    "INSERT INTO storage_zones (storage_id, name, temp, from_shelf, to_shelf) VALUES (?, ?, ?, ?, ?)"
  );
  await db.batch([
    db.prepare("DELETE FROM storage_zones WHERE storage_id = ?").bind(storageId),
    ...zones.map((z) => ins.bind(storageId, z.name, z.temp, z.from_shelf, z.to_shelf)),
  ]);
  return storageId;
}
export async function deleteStorage(db, id) {
  await db.prepare("DELETE FROM storages WHERE id = ?").bind(id).run();
}
/** Placements that would fall outside a new shelf layout. */
export async function placementsOutside(db, storageId, shelfSlots) {
  const rows = await all(db.prepare("SELECT shelf, slot FROM placements WHERE storage_id = ?").bind(storageId));
  return rows.filter((p) => p.shelf > shelfSlots.length || p.slot > shelfSlots[p.shelf - 1]).length;
}
/** Place a bottle; returns false if the spot is already taken. */
export async function addPlacement(db, storageId, wineId, shelf, slot, userId) {
  const res = await db
    .prepare(
      `INSERT INTO placements (storage_id, wine_id, shelf, slot, added_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(storage_id, shelf, slot) DO NOTHING`
    )
    .bind(storageId, wineId, shelf, slot, userId)
    .run();
  return res.meta.changes > 0;
}
export async function getPlacement(db, id) {
  return db.prepare("SELECT * FROM placements WHERE id = ?").bind(id).first();
}
export async function movePlacement(db, id, shelf, slot) {
  const res = await db
    .prepare(
      `UPDATE placements SET shelf = ?, slot = ? WHERE id = ? AND NOT EXISTS (
         SELECT 1 FROM placements o WHERE o.storage_id = placements.storage_id AND o.shelf = ? AND o.slot = ? AND o.id != ?)`
    )
    .bind(shelf, slot, id, shelf, slot, id)
    .run();
  return res.meta.changes > 0;
}
export async function deletePlacement(db, id) {
  await db.prepare("DELETE FROM placements WHERE id = ?").bind(id).run();
}

// ---- tasting events (smagninger) -------------------------------------------

export const EVENT_FIELDS = ["title", "place", "date", "time", "kind", "house", "planned_count", "note"];

export async function listEvents(db, cellarId) {
  return all(
    db
      .prepare(
        `SELECT e.*, (SELECT COUNT(*) FROM event_wines ew WHERE ew.event_id = e.id) AS wines
         FROM events e WHERE e.cellar_id = ? ORDER BY e.date DESC, e.time DESC, e.id DESC`
      )
      .bind(cellarId)
  );
}
export async function getEvent(db, id) {
  return db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
}
export async function createEvent(db, cellarId, userId, e) {
  const res = await db
    .prepare(
      `INSERT INTO events (cellar_id, created_by, ${EVENT_FIELDS.join(", ")})
       VALUES (?, ?, ${EVENT_FIELDS.map(() => "?").join(", ")})`
    )
    .bind(cellarId, userId, ...EVENT_FIELDS.map((f) => e[f]))
    .run();
  return res.meta.last_row_id;
}
export async function updateEvent(db, id, e) {
  await db
    .prepare(`UPDATE events SET ${EVENT_FIELDS.map((f) => f + " = ?").join(", ")} WHERE id = ?`)
    .bind(...EVENT_FIELDS.map((f) => e[f]), id)
    .run();
}
export async function deleteEvent(db, id) {
  await db.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
}

/** Wines poured at an event, in order, with cover photo and prices. */
export async function eventWines(db, eventId) {
  return all(
    db
      .prepare(
        `SELECT ew.*,
                w.name, w.producer, w.vintage, w.grapes, w.country, w.region, w.appellation, w.color, w.alcohol,
                (SELECT ph.id FROM photos ph WHERE ph.wine_id = w.id ORDER BY ph.id LIMIT 1) AS cover_id
         FROM event_wines ew JOIN wines w ON w.id = ew.wine_id
         WHERE ew.event_id = ? ORDER BY ew.position, ew.id`
      )
      .bind(eventId)
  );
}
export async function eventTastings(db, eventId) {
  return all(
    db
      .prepare(
        `SELECT t.*, u.name AS user_name, u.email AS user_email
         FROM tastings t JOIN users u ON u.id = t.user_id
         WHERE t.event_id = ? ORDER BY t.id`
      )
      .bind(eventId)
  );
}
export async function addEventWine(db, eventId, wineId, userId, p) {
  const pos = await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM event_wines WHERE event_id = ?").bind(eventId).first();
  const run = (withShop) =>
    db
      .prepare(
        `INSERT INTO event_wines (event_id, wine_id, position, normal_price, offer_price, currency, created_by${withShop ? ", shop" : ""})
         VALUES (?, ?, ?, ?, ?, ?, ?${withShop ? ", ?" : ""}) ON CONFLICT(event_id, wine_id) DO NOTHING`
      )
      .bind(eventId, wineId, pos.n, p.normal_price, p.offer_price, p.currency, userId, ...(withShop ? [p.shop] : []))
      .run();
  const res = await withShopFallback(run);
  return res.meta.changes > 0;
}
/** Runs with the shop column, or without it until migration 0006 is applied. */
async function withShopFallback(run) {
  try {
    return await run(true);
  } catch (e) {
    if (!/shop/.test(String(e && e.message))) throw e;
    return run(false);
  }
}
export async function getEventWine(db, id) {
  return db.prepare("SELECT * FROM event_wines WHERE id = ?").bind(id).first();
}
export async function updateEventWinePrices(db, id, p) {
  await withShopFallback((withShop) =>
    db
      .prepare(`UPDATE event_wines SET normal_price = ?, offer_price = ?, currency = ?${withShop ? ", shop = ?" : ""} WHERE id = ?`)
      .bind(p.normal_price, p.offer_price, p.currency, ...(withShop ? [p.shop] : []), id)
      .run()
  );
}
export async function deleteEventWine(db, ew) {
  // The wine stays in the cellar; only its place in this tasting goes. Notes made
  // at the event stay on the wine but are no longer linked to the event.
  await db.batch([
    db.prepare("UPDATE tastings SET event_id = NULL WHERE event_id = ? AND wine_id = ?").bind(ew.event_id, ew.wine_id),
    db.prepare("DELETE FROM event_wines WHERE id = ?").bind(ew.id),
  ]);
}
/** Create or replace the current user's note for a wine at an event. */
export async function upsertEventTasting(db, eventId, wineId, userId, t) {
  const existing = await db
    .prepare("SELECT id FROM tastings WHERE event_id = ? AND wine_id = ? AND user_id = ?")
    .bind(eventId, wineId, userId)
    .first();
  if (existing) {
    await db
      .prepare(`UPDATE tastings SET ${TASTING_FIELDS.map((f) => f + " = ?").join(", ")} WHERE id = ?`)
      .bind(...TASTING_FIELDS.map((f) => t[f]), existing.id)
      .run();
    return existing.id;
  }
  const res = await db
    .prepare(
      `INSERT INTO tastings (wine_id, user_id, event_id, ${TASTING_FIELDS.join(", ")})
       VALUES (?, ?, ?, ${TASTING_FIELDS.map(() => "?").join(", ")})`
    )
    .bind(wineId, userId, eventId, ...TASTING_FIELDS.map((f) => t[f]))
    .run();
  return res.meta.last_row_id;
}

/**
 * Per wine in a cellar: how it was met (bought / tasting kinds / poured at an
 * event) and the "hvor fra" names (shops, places, tastings) — for the list filters.
 */
export async function wineSources(db, cellarId) {
  const [tastings, purchases, poured] = await Promise.all([
    all(db.prepare(
      `SELECT t.wine_id, t.kind, t.place, e.title AS event_title
       FROM tastings t JOIN wines w ON w.id = t.wine_id LEFT JOIN events e ON e.id = t.event_id
       WHERE w.cellar_id = ?`).bind(cellarId)),
    all(db.prepare(
      `SELECT p.wine_id, p.shop FROM purchases p JOIN wines w ON w.id = p.wine_id WHERE w.cellar_id = ?`).bind(cellarId)),
    all(db.prepare(
      `SELECT ew.wine_id, e.title FROM event_wines ew JOIN events e ON e.id = ew.event_id WHERE e.cellar_id = ?`).bind(cellarId)),
  ]);
  const out = new Map();
  const get = (id) => {
    if (!out.has(id)) out.set(id, { kinds: new Set(), sources: new Set() });
    return out.get(id);
  };
  const name = (v) => String(v || "").trim();
  for (const t of tastings) {
    const o = get(t.wine_id);
    if (t.kind) o.kinds.add(t.kind);
    const n = name(t.event_title) || name(t.place);
    if (n) o.sources.add(n);
  }
  for (const p of purchases) {
    const o = get(p.wine_id);
    o.kinds.add("kobt");
    if (name(p.shop)) o.sources.add(name(p.shop));
  }
  for (const e of poured) {
    const o = get(e.wine_id);
    o.kinds.add("smagning");
    if (name(e.title)) o.sources.add(name(e.title));
  }
  return out;
}

// ---- tasting files (wine lists) ---------------------------------------------

export async function eventFiles(db, eventId) {
  return all(
    db.prepare("SELECT id, content_type, name, created_by, created_at FROM event_files WHERE event_id = ? ORDER BY id").bind(eventId)
  );
}
export async function createEventFile(db, { eventId, key, contentType, name, userId }) {
  const res = await db
    .prepare("INSERT INTO event_files (event_id, r2_key, content_type, name, created_by) VALUES (?, ?, ?, ?, ?)")
    .bind(eventId, key, contentType, name, userId)
    .run();
  return res.meta.last_row_id;
}
export async function getEventFile(db, id) {
  return db.prepare("SELECT * FROM event_files WHERE id = ?").bind(id).first();
}
export async function deleteEventFile(db, id) {
  await db.prepare("DELETE FROM event_files WHERE id = ?").bind(id).run();
}
/** R2 keys of an event's files (or a whole cellar's), for cleanup on delete. */
export async function eventFileKeys(db, eventId) {
  return (await all(db.prepare("SELECT r2_key FROM event_files WHERE event_id = ?").bind(eventId))).map((r) => r.r2_key);
}
export async function cellarEventFileKeys(db, cellarId) {
  return (
    await all(
      db.prepare("SELECT f.r2_key FROM event_files f JOIN events e ON e.id = f.event_id WHERE e.cellar_id = ?").bind(cellarId)
    ).catch(() => [])
  ).map((r) => r.r2_key);
}
