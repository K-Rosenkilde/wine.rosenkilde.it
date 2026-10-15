"use strict";

// Shared create/edit form for wine fridges (vinkøleskab) and racks (vinreol).
// renderStorageForm(box, storage?, zones?) returns a function that reads the
// form into the API body: { name, kind, layouts: [shelf layers], note, zones }
// (see parseShelfLayouts in app.js for the layout shape).

const ZONE_COLORS = ["#5aa9e6", "#7fb069", "#d9a441", "#e07a5f", "#b388eb", "#4ecdc4"];
const KIND_LABELS = { koleskab: "Vinkøleskab", reol: "Vinreol" };
const KIND_ICONS = { koleskab: "❄️", reol: "🪵" };

function zoneText(z) {
  const t = z.temp !== null && z.temp !== undefined ? String(z.temp).replace(".", ",") + " °C" : "";
  const shelves = z.from_shelf === z.to_shelf ? "hylde " + z.from_shelf : "hylde " + z.from_shelf + "–" + z.to_shelf;
  return [z.name, t].filter(Boolean).join(" ") + " (" + shelves + ")";
}

// Shelf types offered in the form. `fields` are the row labels in storage order
// (bottom layer first, front first); `shape` turns their counts into layers.
const SHELF_TYPES = {
  enkel: { label: "Én række", fields: ["Flasker"], shape: (c) => [[c[0]]], defaults: [6] },
  forbag: { label: "Én række, for og bag", fields: ["Foran", "Bagved"], shape: (c) => [[c[0], c[1]]], defaults: [6, 6] },
  tolag: {
    label: "2 lag, for og bag",
    fields: ["Nederst foran", "Nederst bagved", "Øverst foran", "Øverst bagved"],
    shape: (c) => [[c[0], c[1]], [c[2], c[3]]],
    defaults: [6, 6, 4, 4],
  },
};
function shelfType(layers) {
  if (layers.length === 1) return layers[0].length === 1 ? "enkel" : "forbag";
  return "tolag";
}
const copyLayers = (layers) => layers.map((l) => l.slice());
const shelfTotal = (layers) => layers.flat().reduce((a, b) => a + b, 0);

/** Type picker + bottle counts for one shelf layout. onChange(layers) on every valid edit. */
function layoutEditor(layers, onChange) {
  let type = shelfType(layers);
  let counts = layers.flat();
  const node = el("div", { class: "layout-editor" });
  const select = el("select", {}, Object.entries(SHELF_TYPES).map(([k, t]) => el("option", { value: k, text: t.label })));
  select.value = type;
  const fieldsRow = el("div", { class: "row" });
  select.onchange = () => {
    type = select.value;
    const d = SHELF_TYPES[type].defaults;
    counts = d.map((v, i) => (i === 0 && counts[0] ? counts[0] : v));
    drawFields();
    onChange(SHELF_TYPES[type].shape(counts));
  };
  function drawFields() {
    fieldsRow.innerHTML = "";
    SHELF_TYPES[type].fields.forEach((label, i) => {
      const inp = el("input", { type: "number", inputmode: "numeric", min: "1", max: "200" });
      inp.value = String(counts[i] ?? SHELF_TYPES[type].defaults[i]);
      inp.addEventListener("input", () => {
        const n = Math.trunc(Number(inp.value));
        if (inp.value.trim() === "" || n < 1 || n > 200) return;
        counts[i] = n;
        onChange(SHELF_TYPES[type].shape(counts));
      });
      fieldsRow.appendChild(el("div", { style: "flex:1 1 70px" }, [el("label", { text: label }), inp]));
    });
  }
  drawFields();
  node.appendChild(select);
  node.appendChild(fieldsRow);
  return node;
}

function renderStorageForm(box, storage, zones) {
  box.innerHTML = "";
  let kind = storage ? storage.kind : "koleskab";
  // shelves: one layout (list of layers) per shelf, top shelf first.
  let shelves = storage ? storage.layouts.map(copyLayers) : Array.from({ length: 5 }, () => [[6]]);
  let template = copyLayers(shelves[shelves.length - 1]);
  let zoneRows = zones && zones.length
    ? zones.map((z) => ({ ...z }))
    : storage ? [] : [{ name: "", temp: 12, from_shelf: 1, to_shelf: shelves.length }];

  const nameIn = el("input", { type: "text", placeholder: "f.eks. Køkkenets vinkøleskab", value: storage ? storage.name : "" });
  const kindSeg = el("div", { class: "tabs" });
  const kindBtns = Object.entries(KIND_LABELS).map(([k, label]) =>
    el("button", { type: "button", text: KIND_ICONS[k] + " " + label, onclick: () => { kind = k; draw(); } })
  );
  kindBtns.forEach((b) => kindSeg.appendChild(b));
  const countIn = el("input", { type: "number", inputmode: "numeric", min: "1", max: "50", value: String(shelves.length) });
  // The layout for all shelves; "Tilpas hver hylde" can change single shelves.
  const templateBox = el("div", {}, [layoutEditor(template, (layers) => {
    template = layers;
    shelves = shelves.map(() => copyLayers(layers));
    drawShelves();
  })]);
  const shelvesBox = el("div");
  const zonesWrap = el("div");
  const noteIn = el("input", { type: "text", placeholder: "f.eks. står i bryggerset", value: storage ? storage.note || "" : "" });

  // A number field while typing: "" or out of range is ignored until it is valid,
  // so the field can be cleared and retyped (and is never rewritten under the cursor).
  const readInt = (input, max) => {
    const n = Math.trunc(Number(input.value));
    return input.value.trim() !== "" && n >= 1 && n <= max ? n : null;
  };

  // Changing the shelf count keeps any per-shelf counts already set. A zone that
  // reached the bottom shelf keeps reaching it; zones beyond a smaller count shrink.
  // Applied after a short pause (or on leaving the field), so typing "20" never
  // passes through a 2-shelf layout that would cut the zones short.
  let countTimer;
  countIn.addEventListener("input", () => { clearTimeout(countTimer); countTimer = setTimeout(applyCount, 600); });
  countIn.addEventListener("change", () => { clearTimeout(countTimer); applyCount(); });
  function applyCount() {
    const n = readInt(countIn, 50);
    if (!n || n === shelves.length) return;
    const old = shelves.length;
    shelves = Array.from({ length: n }, (_, i) => shelves[i] ?? copyLayers(template));
    zoneRows = zoneRows.filter((z) => z.from_shelf <= n);
    for (const z of zoneRows) {
      if (z.to_shelf === old || z.to_shelf > n) z.to_shelf = n;
    }
    draw();
  }
  countIn.addEventListener("blur", () => { if (!readInt(countIn, 50)) countIn.value = String(shelves.length); });

  function drawShelves() {
    const wasOpen = shelvesBox.querySelector("details")?.open;
    shelvesBox.innerHTML = "";
    const totalText = () => `Tilpas hver hylde (i alt ${shelves.reduce((a, l) => a + shelfTotal(l), 0)} flasker)`;
    const summary = el("summary", { text: totalText() });
    const det = el("details", {}, [summary]);
    det.open = !!wasOpen;
    shelves.forEach((layers, i) => {
      det.appendChild(el("div", { class: "shelf-edit" }, [
        el("div", { class: "small", style: "font-weight:700", text: "Hylde " + (i + 1) }),
        layoutEditor(layers, (l) => { shelves[i] = l; summary.textContent = totalText(); }),
      ]));
    });
    shelvesBox.appendChild(det);
  }

  function drawZones() {
    zonesWrap.innerHTML = "";
    if (kind !== "koleskab") return;
    zonesWrap.appendChild(el("h3", { text: "🌡️ Temperaturzoner", style: "font-size:.95rem;margin:18px 0 4px" }));
    zonesWrap.appendChild(el("div", { class: "small muted", text: "Hylde 1 er den øverste. Zoner må ikke overlappe." }));
    const options = (sel) => shelves.map((_, i) => el("option", { value: String(i + 1), text: String(i + 1), selected: i + 1 === sel ? "" : null }));
    zoneRows.forEach((z, i) => {
      const nameZ = el("input", { type: "text", placeholder: "f.eks. Rødvin", value: z.name || "" });
      const tempZ = el("input", { type: "number", inputmode: "decimal", step: "0.5", placeholder: "°C", value: z.temp ?? "" });
      const fromZ = el("select", {}, options(z.from_shelf));
      const toZ = el("select", {}, options(z.to_shelf));
      nameZ.oninput = () => (z.name = nameZ.value);
      tempZ.oninput = () => (z.temp = tempZ.value);
      fromZ.onchange = () => (z.from_shelf = Number(fromZ.value));
      toZ.onchange = () => (z.to_shelf = Number(toZ.value));
      zonesWrap.appendChild(el("div", { class: "zone-row", style: "border-left-color:" + ZONE_COLORS[i % ZONE_COLORS.length] }, [
        el("div", { class: "row" }, [
          el("div", { style: "flex:2 1 140px" }, [el("label", { text: "Zone" }), nameZ]),
          el("div", { style: "flex:1 1 80px" }, [el("label", { text: "Temperatur °C" }), tempZ]),
        ]),
        el("div", { class: "row", style: "align-items:flex-end" }, [
          el("div", { style: "flex:1 1 70px" }, [el("label", { text: "Fra hylde" }), fromZ]),
          el("div", { style: "flex:1 1 70px" }, [el("label", { text: "Til hylde" }), toZ]),
          el("button", { type: "button", class: "btn small danger", style: "flex:0 0 auto", text: "Fjern",
            onclick: () => { zoneRows.splice(i, 1); drawZones(); } }),
        ]),
      ]));
    });
    zonesWrap.appendChild(el("button", { type: "button", class: "btn small secondary", style: "margin-top:10px", text: "+ Tilføj zone",
      onclick: () => {
        const last = zoneRows[zoneRows.length - 1];
        const from = Math.min(shelves.length, last ? last.to_shelf + 1 : 1);
        zoneRows.push({ name: "", temp: "", from_shelf: from, to_shelf: shelves.length });
        drawZones();
      } }));
  }

  function draw() {
    kindBtns.forEach((b, i) => b.classList.toggle("active", Object.keys(KIND_LABELS)[i] === kind));
    drawShelves();
    drawZones();
  }

  box.appendChild(el("label", { text: "Navn" }));
  box.appendChild(nameIn);
  box.appendChild(el("label", { text: "Type" }));
  box.appendChild(kindSeg);
  box.appendChild(el("label", { text: "Antal hylder" }));
  box.appendChild(countIn);
  box.appendChild(el("label", { text: "Hyldetype (for alle hylder)" }));
  box.appendChild(templateBox);
  box.appendChild(shelvesBox);
  box.appendChild(zonesWrap);
  box.appendChild(el("label", { text: "Note" }));
  box.appendChild(noteIn);
  draw();

  return () => ({
    name: nameIn.value.trim(),
    kind,
    layouts: shelves,
    note: noteIn.value.trim(),
    zones: kind === "koleskab" ? zoneRows : [],
  });
}
