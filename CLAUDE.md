# wine.rosenkilde.it — Vin-dagbog

Multi-user wine tasting + purchase journal with bottle photos and AI label reading. Cloudflare Worker
(Hono) + D1 (`wine`) + R2 (`wine-photos`), custom domain **wine.rosenkilde.it**, like the other
subdomain apps (games., news., go. …). See README.md for setup and layout.

## Rules
- UI text is Danish. Plain HTML/CSS/JS in `public/`, no frontend build step.
- Multi-tenant: every API route must check cellar membership (`access` / `wineAccess` / `photoAccess`
  in worker/index.js). Photos are only served through the Worker, never from a public bucket URL.
- Tastings and purchases are per user; only the author or the cellar owner may delete them.
- Auth/cellar code mirrors GamesRegistration (users/sessions/leagues/memberships) — keep them alike.
- Schema changes go in a new `migrations/000N_*.sql`; never edit applied migrations.
- Label reading: worker/label.js, model `claude-opus-5-5`, structured JSON output (no forced tool use),
  `fallbacks: "default"`. Secret `ANTHROPIC_API_KEY`.

## Open tasks
- D1 `wine` is created (id in wrangler.toml). Still to do: enable R2 in the Cloudflare dashboard,
  create bucket `wine-photos`, set secret ANTHROPIC_API_KEY, `npm run migrate`, `npm run deploy`.
- Add a "Vin" card to the rosenkilde.it front page (`rosenkilde-frontpage`) and a row in the portal's
  `apps` table.
