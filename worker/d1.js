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

export async function createWine(db, cellarId, userId, w) {
  const res = await db
    .prepare(
      `INSERT INTO wines (cellar_id, created_by, ${WINE_FIELDS.join(", ")})
       VALUES (?, ?, ${WINE_FIELDS.map(() => "?").join(", ")})`
    )
    .bind(cellarId, userId, ...WINE_FIELDS.map((f) => w[f]))
    .run();
  return res.meta.last_row_id;
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

export const TASTING_FIELDS = ["date", "rating", "notes", "aroma", "taste", "food", "place"];
export const PURCHASE_FIELDS = ["date", "shop", "url", "price", "currency", "quantity", "note"];

export async function tastingsForWine(db, wineId) {
  return all(
    db
      .prepare(
        `SELECT t.*, u.name AS user_name, u.email AS user_email
         FROM tastings t JOIN users u ON u.id = t.user_id
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
