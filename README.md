# Vin-dagbog — wine.rosenkilde.it

Multi-user wine journal (Danish UI). Photograph a bottle → the photo is **saved** and Claude reads the
label and pre-fills name, producer/house, vintage, grapes, country, region, appellation, type and
alcohol. Correct the fields, add your tasting note (1–5 rating, notes, aroma, taste, food, occasion)
and — if you bought it — the purchase (date, shop/webshop + link, price, quantity).

- **Cellars (kældre)** — a shared wine list. Create one and share the invite link (`/join?code=…`)
  with family or the wine club. Every member sees all wines, but tastings and purchases belong to the
  person who added them, so each keeps their own opinion. Same model as games.rosenkilde.it leagues.
- **Photos** — kept permanently in R2 (full size ~2000px + 400px thumbnail, resized in the browser).
  Several per wine (forside / bagside / andet), only served to cellar members.
- **Vinkøleskabe & vinreoler** — define fridges/racks with a number of shelves and bottles per shelf
  (each shelf can differ, and a shelf can be one row, front + back, or 2 layers with front + back,
  e.g. 6+6 below and 4+4 on top); fridges get temperature zones (name, °C, shelf range). Tap a spot to put a
  bottle there, move it or take it out; each wine page shows where its bottles are.
- **Smagninger** — a tasting event: place, date/time, number of wines, one house or several. Add each
  wine by photo (label read like everywhere else) or from the cellar, with the normal price and the
  offer price on the day. Every member rates and notes each wine (saved as their tasting, linked to the
  event); the page ranks the wines by average rating, and "Jeg købte…" records a purchase at the offer.
- **List** — search, filter (type, country, bought / not bought), sort (newest, rating, last tasted,
  vintage, name). **Eksportér CSV** downloads the whole cellar (semicolon-separated, opens in Excel).

## Stack
One Cloudflare Worker (Hono) serving `public/` as static assets plus `/api/*`; D1 for data, R2 for photos,
the Anthropic API (`claude-opus-5-5`, vision + JSON-schema output, low effort, refusal fallback enabled)
for label reading. No build step for the frontend.

```
worker/index.js   API: auth, cellars, scan, wines, photos, tastings, purchases, CSV export
worker/d1.js      D1 queries
worker/auth.js    PBKDF2 passwords + cookie sessions (copied from games.rosenkilde.it)
worker/label.js   reads the label with Claude
migrations/       D1 schema
public/           index (list) · add (photo + new wine) · wine (details) · cellars · auth · join
```

## One-time setup (Cloudflare account klaus@rosenkilde.org)
```sh
npm install
npx wrangler login
npx wrangler d1 create wine                  # paste database_id into wrangler.toml
# R2 must be enabled once first: dash.cloudflare.com → R2 Object Storage → enable (free tier)
npx wrangler r2 bucket create wine-photos
npx wrangler secret put ANTHROPIC_API_KEY    # key from console.anthropic.com
npm run migrate                              # apply migrations to the remote D1
npm run deploy                               # also creates the wine.rosenkilde.it custom domain
```
Without `ANTHROPIC_API_KEY` everything works, except that you fill in the fields yourself (the photo is
still saved). Label reading costs roughly a few øre per photo.

Deploys are automatic: the Worker is connected to this GitHub repo (Workers & Pages → wine → Settings →
Build), so every push to `main` builds and deploys. Database migrations are not applied by the build —
run `npm run migrate` after adding a new file in `migrations/`.

## Local development
```sh
cp .dev.vars.example .dev.vars   # optional: add an API key to test label reading
npm run migrate:local
npm run dev                      # http://localhost:8787 (local D1 + R2)
```
