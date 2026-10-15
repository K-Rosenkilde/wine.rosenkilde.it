"use strict";

// Shared create/edit form for wine fridges (vinkøleskab) and racks (vinreol).
// renderStorageForm(box, storage?, zones?) returns a function that reads the
// form into the API body: { name, kind, shelves: [slots per shelf], note, zones }.

const ZONE_COLORS = ["#5aa9e6", "#7fb069", "#d9a441", "#e07a5f", "#b388eb", "#4ecdc4"];
const KIND_LABELS = { koleskab: "Vinkøleskab", reol: "Vinreol" };
const KIND_ICONS = { koleskab: "❄️", reol: "🪵" };

function zoneText(z) {
  const t = z.temp !== null && z.temp !== undefined ? String(z.temp).replace(".", ",") + " °C" : "";
  const shelves = z.from_shelf === z.to_shelf ? "hylde " + z.from_shelf : "hylde " + z.from_shelf + "–" + z.to_shelf;
  return [z.name, t].filter(Boolean).join(" ") + " (" + shelves + ")";
}

function renderStorageForm(box, storage, zones) {
  box.innerHTML = "";
  let kind = storage ? storage.kind : "koleskab";
  let shelves = storage ? storage.shelves.slice() : [6, 6, 6, 6, 6];
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
  const perIn = el("input", { type: "number", inputmode: "numeric", min: "1", max: "200", value: String(shelves[0] || 6) });
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
    const def = readInt(perIn, 200) || shelves[shelves.length - 1] || 6;
    shelves = Array.from({ length: n }, (_, i) => shelves[i] ?? def);
    zoneRows = zoneRows.filter((z) => z.from_shelf <= n);
    for (const z of zoneRows) {
      if (z.to_shelf === old || z.to_shelf > n) z.to_shelf = n;
    }
    draw();
  }
  countIn.addEventListener("blur", () => { if (!readInt(countIn, 50)) countIn.value = String(shelves.length); });
  perIn.addEventListener("input", () => {
    const def = readInt(perIn, 200);
    if (!def) return;
    shelves = shelves.map(() => def);
    draw();
  });

  function drawShelves() {
    shelvesBox.innerHTML = "";
    const total = shelves.reduce((a, b) => a + b, 0);
    const det = el("details", {}, [el("summary", { text: `Tilpas hver hylde (i alt ${total} flasker)` })]);
    const grid = el("div", { class: "row" });
    shelves.forEach((n, i) => {
      const inp = el("input", { type: "number", inputmode: "numeric", min: "1", max: "200", value: String(n) });
      inp.addEventListener("change", () => { shelves[i] = Math.max(1, Math.min(200, Math.trunc(Number(inp.value) || 1))); drawShelves(); det.open = true; });
      grid.appendChild(el("div", { style: "flex:1 1 90px" }, [el("label", { text: "Hylde " + (i + 1) }), inp]));
    });
    det.appendChild(grid);
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
  box.appendChild(el("div", { class: "row" }, [
    el("div", {}, [el("label", { text: "Antal hylder" }), countIn]),
    el("div", {}, [el("label", { text: "Flasker pr. hylde" }), perIn]),
  ]));
  box.appendChild(shelvesBox);
  box.appendChild(zonesWrap);
  box.appendChild(el("label", { text: "Note" }));
  box.appendChild(noteIn);
  draw();

  return () => ({
    name: nameIn.value.trim(),
    kind,
    shelves,
    note: noteIn.value.trim(),
    zones: kind === "koleskab" ? zoneRows : [],
  });
}
