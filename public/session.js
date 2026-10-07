"use strict";

/**
 * Client auth + cellar context (adapted from games.rosenkilde.it).
 * - Session.onReady(cb, opts) waits for auth (+ a selected cellar) then runs cb,
 *   redirecting to /auth (not logged in) or /cellars (no cellar) as needed.
 * - Session.cellarId / role / user / cellarName describe the current context.
 * - Renders a slim context bar (cellar · user · log out) at the top of the page.
 */
const Session = {
  user: null,
  cellarId: null,
  role: null,
  cellarName: "",
  cellar: null,

  async init(opts = {}) {
    const requireCellar = opts.requireCellar !== false;

    const me = await fetch("/api/auth/me").then((r) => r.json()).catch(() => ({ user: null }));
    if (!me.user) {
      location.href = "/auth?next=" + encodeURIComponent(location.pathname + location.search);
      return false;
    }
    this.user = me.user;

    if (requireCellar) {
      const fromUrl = Number(new URLSearchParams(location.search).get("cellar"));
      const cid = fromUrl || Number(localStorage.getItem("cellarId")) || 0;
      if (!cid) {
        location.href = "/cellars";
        return false;
      }
      const res = await fetch("/api/cellars/" + cid);
      if (!res.ok) {
        localStorage.removeItem("cellarId");
        location.href = "/cellars";
        return false;
      }
      this.cellar = await res.json();
      this.cellarId = this.cellar.id;
      this.role = this.cellar.role;
      this.cellarName = this.cellar.name;
      localStorage.setItem("cellarId", String(this.cellarId));
    }

    this.renderBar(requireCellar);
    return true;
  },

  onReady(cb, opts) {
    this.init(opts).then((ok) => ok && cb());
  },

  isOwner() {
    return this.role === "owner";
  },

  /** cellar query string, e.g. for /api/wines?<this> */
  q(extra) {
    return "cellar=" + this.cellarId + (extra ? "&" + extra : "");
  },

  async logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("cellarId");
    location.href = "/auth";
  },

  renderBar(hasCellar) {
    const left = el("div");
    if (hasCellar) {
      left.appendChild(el("a", { href: "/cellars", title: "Skift kælder" }, ["⇄ ", el("strong", { text: this.cellarName })]));
      if (this.role) left.appendChild(el("span", { class: "ctx-role", text: this.role === "owner" ? "ejer" : "medlem" }));
    } else {
      left.appendChild(el("strong", { text: "🍷 Vin-dagbog" }));
    }
    const out = el("button", { type: "button", class: "linkbtn", text: "Log ud", onclick: () => this.logout() });
    const right = el("div", {}, [el("span", { class: "muted", text: this.user.name || this.user.email }), out]);
    document.body.insertBefore(el("div", { class: "ctxbar" }, [left, right]), document.body.firstChild);
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

window.Session = Session;
