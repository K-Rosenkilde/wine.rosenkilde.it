"use strict";

// Shared fetch helpers used across pages.
async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await safeJson(res)).error || res.statusText);
  return res.json();
}

async function apiSend(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v !== null && v !== undefined) {
        node.setAttribute(k, v);
      }
    }
  }
  for (const c of [].concat(children || [])) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

// ---- wine helpers ---------------------------------------------------------

const COLOR_LABELS = { "rød": "Rød", hvid: "Hvid", "rosé": "Rosé", mousserende: "Mousserende", dessert: "Dessert", orange: "Orange" };
const COLOR_DOTS = { "rød": "#9b1c31", hvid: "#e8d9a0", "rosé": "#f4a6b4", mousserende: "#f5e6a8", dessert: "#c98b2b", orange: "#e08a3c" };

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function stars(rating) {
  if (rating === null || rating === undefined) return "";
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return "★".repeat(full) + (half ? "½" : "") + " " + String(rating).replace(".", ",");
}

function money(price, currency) {
  if (price === null || price === undefined) return "";
  return Number(price).toLocaleString("da-DK", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " " + (currency || "DKK");
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)} ${y}`;
}

/** Resize an image File to a JPEG Blob whose longest side is at most `max` px. */
async function resizeImage(file, max, quality) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  const src = bmp || (await loadImg(file));
  const w = src.width, h = src.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
}
function loadImg(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

/** FormData with the full-size photo (~2000px) and a thumbnail (~400px). */
async function photoForm(file, kind) {
  const [full, thumb] = await Promise.all([resizeImage(file, 2000, 0.85), resizeImage(file, 400, 0.75)]);
  const fd = new FormData();
  fd.append("photo", full, "photo.jpg");
  fd.append("thumb", thumb, "thumb.jpg");
  if (kind) fd.append("kind", kind);
  return fd;
}

async function apiUpload(url, formData) {
  const res = await fetch(url, { method: "POST", body: formData });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
