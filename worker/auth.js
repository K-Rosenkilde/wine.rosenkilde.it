// Authentication helpers (copied from games.rosenkilde.it): password hashing (PBKDF2 via
// Web Crypto), session tokens, and cookie parsing/serialization. Pure Web APIs,
// so this runs unchanged on Workers (and modern Node).

const PBKDF2_ITERATIONS = 100000;
const SESSION_DAYS = 30;

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}

export async function sha256hex(str) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return toHex(digest);
}

/** Derive a PBKDF2 hash. Returns hex. */
async function pbkdf2(password, saltHex) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const saltBytes = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  );
  return toHex(bits);
}

export async function hashPassword(password) {
  const salt = randomHex(16);
  const hash = await pbkdf2(password, salt);
  return { hash, salt };
}

export async function verifyPassword(password, saltHex, hashHex) {
  const computed = await pbkdf2(password, saltHex);
  // constant-time-ish comparison
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

/** A fresh session: the raw token (goes in the cookie) + its hash (stored in D1). */
export async function newSessionToken() {
  const token = randomHex(32);
  const id = await sha256hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  return { token, id, expires };
}

export function sessionCookie(token) {
  const maxAge = SESSION_DAYS * 86400;
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
export function clearCookie() {
  return `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookie(req, name) {
  const header = req.header("Cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > -1 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

export function randomInviteCode() {
  // URL-safe, human-shareable-ish.
  return randomHex(8);
}
