"use strict";

// Shared form pieces for add.html and wine.html.

const WINE_INPUTS = [
  { key: "name", label: "Vinens navn", ph: "f.eks. Barolo Cannubi" },
  { key: "producer", label: "Producent / hus", ph: "f.eks. Marchesi di Barolo" },
  { key: "vintage", label: "Årgang", type: "number", ph: "f.eks. 2019", half: true },
  { key: "color", label: "Type", select: [["", "—"], ...Object.entries(COLOR_LABELS)], half: true },
  { key: "grapes", label: "Druer", ph: "f.eks. Nebbiolo, Barbera" },
  { key: "country", label: "Land", ph: "f.eks. Italien", half: true },
  { key: "region", label: "Område", ph: "f.eks. Piemonte", half: true },
  { key: "appellation", label: "Appellation", ph: "f.eks. Barolo DOCG", half: true },
  { key: "alcohol", label: "Alkohol %", type: "number", ph: "14", half: true, step: "0.1" },
];

function field(def, value) {
  const id = "f_" + def.key;
  let input;
  if (def.select) {
    input = el("select", { id, name: def.key }, def.select.map(([v, t]) => el("option", { value: v, text: t })));
    input.value = value ?? "";
  } else if (def.textarea) {
    input = el("textarea", { id, name: def.key, placeholder: def.ph || "" });
    input.value = value ?? "";
  } else {
    input = el("input", { id, name: def.key, type: def.type || "text", placeholder: def.ph || "", step: def.step || null,
      inputmode: def.type === "number" ? "decimal" : null });
    input.value = value ?? "";
  }
  return el("div", { style: def.half ? "" : "flex-basis:100%" }, [el("label", { for: id, text: def.label }), input]);
}

/** Render the wine fields into `box` (a .row). */
function renderWineFields(box, values = {}) {
  box.innerHTML = "";
  for (const def of WINE_INPUTS) box.appendChild(field(def, values[def.key]));
}

function readFields(box, keys) {
  const out = {};
  for (const k of keys) {
    const n = box.querySelector(`[name="${k}"]`);
    if (n) out[k] = n.value.trim();
  }
  return out;
}
const readWineFields = (box) => readFields(box, WINE_INPUTS.map((d) => d.key));

/** Half-step 1–5 rating picker. Returns { node, get(), set(v) }. */
function ratingPicker(initial = null) {
  let value = initial;
  const node = el("div", { class: "rating" });
  const steps = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const buttons = steps.map((s) =>
    el("button", { type: "button", text: String(s).replace(".", ","), onclick: () => set(value === s ? null : s) })
  );
  buttons.forEach((b) => node.appendChild(b));
  function set(v) {
    value = v;
    buttons.forEach((b, i) => b.classList.toggle("on", value !== null && steps[i] <= value));
  }
  set(initial);
  return { node, get: () => value, set };
}

const TASTING_INPUTS = [
  { key: "date", label: "Dato", type: "date", half: true },
  { key: "place", label: "Hvor / anledning", ph: "f.eks. Middag hos Anne", half: true },
  { key: "notes", label: "Hvad synes du?", textarea: true, ph: "Samlet indtryk…" },
  { key: "aroma", label: "Duft", ph: "kirsebær, roser, tjære…", half: true },
  { key: "taste", label: "Smag", ph: "tanniner, syre, længde…", half: true },
  { key: "food", label: "Passer til", ph: "f.eks. lam, svampe-risotto" },
];
const PURCHASE_INPUTS = [
  { key: "date", label: "Købsdato", type: "date", half: true },
  { key: "shop", label: "Butik / webshop", ph: "f.eks. Vinbutikken, Bilka", half: true },
  { key: "price", label: "Pris pr. flaske", type: "number", ph: "199", half: true, step: "0.01" },
  { key: "currency", label: "Valuta", select: [["DKK", "DKK"], ["EUR", "EUR"], ["SEK", "SEK"], ["NOK", "NOK"], ["USD", "USD"], ["GBP", "GBP"]], half: true },
  { key: "quantity", label: "Antal flasker", type: "number", ph: "1", half: true },
  { key: "url", label: "Link til webshop", type: "url", ph: "https://…", half: true },
  { key: "note", label: "Note", ph: "f.eks. tilbud, 6 for 5" },
];

/** Render a tasting form into `box`; returns a reader function. */
function renderTastingForm(box) {
  box.innerHTML = "";
  const rp = ratingPicker();
  box.appendChild(el("div", { style: "flex-basis:100%" }, [el("label", { text: "Din vurdering (1–5)" }), rp.node]));
  for (const def of TASTING_INPUTS) box.appendChild(field(def, def.key === "date" ? today() : ""));
  return () => ({ ...readFields(box, TASTING_INPUTS.map((d) => d.key)), rating: rp.get() });
}
function renderPurchaseForm(box) {
  box.innerHTML = "";
  for (const def of PURCHASE_INPUTS) {
    box.appendChild(field(def, def.key === "date" ? today() : def.key === "currency" ? "DKK" : def.key === "quantity" ? "1" : ""));
  }
  return () => readFields(box, PURCHASE_INPUTS.map((d) => d.key));
}
