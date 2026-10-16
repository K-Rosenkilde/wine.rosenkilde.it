"use strict";

// Shared form for a tasting event (smagning): title, place, date/time, number of
// wines, and whether it is one house or several. Returns a reader for the API body.

function eventWhen(e) {
  return fmtDate(e.date) + (e.time ? " kl. " + e.time : "");
}
function eventKindText(e) {
  return e.kind === "hus" ? "Ét hus" + (e.house ? ": " + e.house : "") : "Flere huse";
}

function renderEventForm(box, e = {}) {
  box.innerHTML = "";
  let kind = e.kind || "blandet";
  const input = (attrs, value) => {
    const n = el("input", attrs);
    n.value = value ?? "";
    return n;
  };
  const title = input({ type: "text", placeholder: "f.eks. Bourgogne-aften" }, e.title);
  const place = input({ type: "text", placeholder: "f.eks. Vinbutikken i Århus" }, e.place);
  const date = input({ type: "date" }, e.date || today());
  const time = input({ type: "time" }, e.time || "");
  const count = input({ type: "number", inputmode: "numeric", min: "1", max: "200", placeholder: "f.eks. 6" }, e.planned_count ?? "");
  const house = input({ type: "text", placeholder: "f.eks. Domaine Faiveley" }, e.house);
  const note = el("textarea", { placeholder: "f.eks. vært, pris for smagningen, tema…" });
  note.value = e.note || "";

  const houseBox = el("div", {}, [el("label", { text: "Hvilket hus / producent?" }), house]);
  const seg = el("div", { class: "tabs" });
  const btns = [["hus", "🏠 Ét hus"], ["blandet", "🍇 Flere huse"]].map(([k, t]) =>
    el("button", { type: "button", text: t, onclick: () => { kind = k; draw(); } })
  );
  btns.forEach((b) => seg.appendChild(b));
  function draw() {
    btns[0].classList.toggle("active", kind === "hus");
    btns[1].classList.toggle("active", kind === "blandet");
    houseBox.style.display = kind === "hus" ? "" : "none";
  }

  const field = (label, node, half) => el("div", { style: half ? "" : "flex-basis:100%" }, [el("label", { text: label }), node]);
  box.appendChild(el("div", { class: "row" }, [
    field("Titel", title),
    field("Hvor", place),
    field("Dato", date, true),
    field("Tidspunkt", time, true),
    field("Antal vine", count, true),
  ]));
  box.appendChild(el("label", { text: "Type smagning" }));
  box.appendChild(seg);
  box.appendChild(houseBox);
  box.appendChild(field("Note", note));
  draw();

  return () => ({
    title: title.value.trim(),
    place: place.value.trim(),
    date: date.value,
    time: time.value,
    planned_count: count.value,
    kind,
    house: house.value.trim(),
    note: note.value.trim(),
  });
}

/**
 * "🛒 Købt" / "⭐ Vil købe" for a wine at a tasting (instead of moving it by hand).
 * w: { id (event wine), wine_id, in_list, bought, offer_price }; onDone(message) after a change.
 */
function buyWantButtons(w, onDone) {
  const label = [w.name, w.vintage].filter(Boolean).join(" ");
  const box = el("div", { class: "buy-want" });
  if (w.bought) box.appendChild(el("span", { class: "small muted", text: "🛒 Købt " + w.bought + " fl." }));
  box.appendChild(el("button", { type: "button", class: "btn small" + (w.bought ? " secondary" : ""), text: w.bought ? "🛒 Købt igen…" : "🛒 Købt…", onclick: async () => {
    const q = prompt("Hvor mange flasker købte du af " + label + "?", "1");
    if (q === null) return;
    await apiSend("/api/event-wines/" + w.id + "/purchase", "POST", { quantity: q });
    onDone("🛒 Køb af " + label + " gemt" + (w.offer_price !== null && w.offer_price !== undefined ? " til tilbudsprisen" : "") + " — vinen står nu i vinlisten som købt.");
  } }));
  if (!w.bought) {
    const wanted = w.in_list === 2;
    box.appendChild(el("button", { type: "button", class: "btn small " + (wanted ? "want-on" : "secondary"), text: wanted ? "⭐ Vil købe ✓" : "⭐ Vil købe",
      title: wanted ? "Tryk for at fjerne fra vil-købe" : "Sæt på vil-købe-listen", onclick: async () => {
        await apiSend("/api/wines/" + w.wine_id + "/list", "POST", { state: wanted ? "unwant" : "want" });
        onDone(wanted ? label + " er fjernet fra vil-købe." : "⭐ " + label + " står nu i vinlisten som vil købe.");
      } }));
  }
  return box;
}
