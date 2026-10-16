# wine.rosenkilde.it — Vin-dagbog

Multi-user wine tasting + purchase journal with bottle photos and AI label reading. Cloudflare Worker
(Hono) + D1 (`wine`) + R2 (`wine-photos`), custom domain **wine.rosenkilde.it**, like the other
subdomain apps (games., news., go. …). See README.md for setup and layout.

## Rules
- UI text is Danish. Plain HTML/CSS/JS in `public/`, no frontend build step.
- Multi-tenant: every API route must check cellar membership (`access` / `wineAccess` / `photoAccess`
  in worker/index.js). Photos are only served through the Worker, never from a public bucket URL.
- Tastings and purchases are per user; only the author or the cellar owner may delete them.
- Wines created at a tasting have `in_list = 0` (shown only under their tastings) until bought or moved;
  `/api/wines` hides them unless `?all=1` (use that when matching/deduplicating).
- Auth/cellar code mirrors GamesRegistration (users/sessions/leagues/memberships) — keep them alike.
- Schema changes go in a new `migrations/000N_*.sql`; never edit applied migrations.
- Label + wine-list reading: worker/label.js (`readLabel`, `readWineList` for photo/PDF lists), model
  `claude-opus-5-5`, structured JSON output (no forced tool use), `fallbacks: "default"`. Secret `ANTHROPIC_API_KEY`.

## Deployment
- Cloudflare Worker `wine`, git-connected (Workers Builds): every push to `main` deploys
  (deploy command `npx wrangler deploy`). Custom domain wine.rosenkilde.it.
- Migrations are NOT applied by the build. After adding `migrations/000N_*.sql`, Klaus runs
  `npm run migrate` locally (or pastes the SQL into the D1 console in the dashboard).

## Open tasks
- Setup done (D1 `wine`, R2 `wine-photos`, secret ANTHROPIC_API_KEY). Remote migrations applied: 0001–0004.
- Migrations 0005_event_files.sql (wine list on a tasting) and 0006_event_wine_shop.sql (shop per
  tasting wine) and 0007_wine_in_list.sql (tasting wines kept out of the wine list) must be applied
  remotely, if not done yet.
- `npm run migrate` on Klaus's PC often fails with Cloudflare error 7403 (expired wrangler login):
  fix with `npx wrangler logout` + `npx wrangler login`, or paste the SQL into the D1 console plus
  `INSERT INTO d1_migrations (name) VALUES ('000N_name.sql');`.
- Add a "Vin" card to the rosenkilde.it front page (`rosenkilde-frontpage`) and a row in the portal's
  `apps` table.
