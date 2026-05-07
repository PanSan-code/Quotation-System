# Quote System on Cloudflare

This project is now structured for a fully Cloudflare-based deployment:

- `frontend/`: customer page and admin page for Cloudflare Pages
- `backend/`: Cloudflare Workers API with D1 for quote data and R2 for image storage

## Architecture

- Frontend: Cloudflare Pages
- API: Cloudflare Workers
- Database: Cloudflare D1
- Image storage: Cloudflare R2

The public flow is unchanged:

1. Customer submits a product link, images, remarks, shipping method, and estimated weight.
2. The Worker stores images in R2 and creates a D1 inquiry record.
3. The customer checks the quote with the generated inquiry code.
4. Admin opens the static admin page and updates the quote through the Worker API.

## Project layout

- [frontend/index.html](</C:/Users/13646/Documents/New project/frontend/index.html>): customer page
- [frontend/admin.html](</C:/Users/13646/Documents/New project/frontend/admin.html>): admin page
- [frontend/config.js](</C:/Users/13646/Documents/New project/frontend/config.js>): frontend API base URL
- [backend/src/worker.js](</C:/Users/13646/Documents/New project/backend/src/worker.js>): Worker API
- [backend/schema.sql](</C:/Users/13646/Documents/New project/backend/schema.sql>): D1 schema
- [backend/wrangler.toml](</C:/Users/13646/Documents/New project/backend/wrangler.toml>): Worker config

## Backend setup

1. Install dependencies:

```powershell
cd backend
cmd /c npm install
```

2. Create a D1 database.

```powershell
cmd /c npx wrangler d1 create quote-system
```

3. Put the returned D1 `database_id` into [backend/wrangler.toml](</C:/Users/13646/Documents/New project/backend/wrangler.toml>).

4. Create an R2 bucket and set the bucket name in `wrangler.toml`.

5. Apply the schema:

```powershell
cmd /c npx wrangler d1 execute quote-system --file=./schema.sql
```

6. Create `backend/.dev.vars` from [backend/.dev.vars.example](</C:/Users/13646/Documents/New project/backend/.dev.vars.example>) and set `ADMIN_TOKEN`.

7. Start local Worker development:

```powershell
cmd /c npm run dev
```

## Frontend setup

Set [frontend/config.js](</C:/Users/13646/Documents/New project/frontend/config.js>) to your Worker address:

```js
window.APP_CONFIG = {
  apiBaseUrl: "https://quote-system-api.your-subdomain.workers.dev"
};
```

For local development, point it at the local Wrangler URL, usually:

```js
window.APP_CONFIG = {
  apiBaseUrl: "http://127.0.0.1:8787"
};
```

Then deploy the `frontend/` directory to Cloudflare Pages.

## Worker bindings

`backend/wrangler.toml` expects:

- `DB`: D1 binding
- `QUOTE_IMAGES`: R2 bucket binding
- `ALLOWED_ORIGINS`: comma-separated list of allowed frontend origins
- `MAX_IMAGES`: maximum uploaded images per inquiry

Secret values go into `.dev.vars` locally and `wrangler secret put` in production:

```powershell
cmd /c npx wrangler secret put ADMIN_TOKEN
```

## Image access

Images are stored in R2 and served back through the Worker at:

```text
/files/<r2-object-key>
```

This means you do not need a separate public R2 domain for the current implementation.

## API summary

- `GET /health`
- `POST /api/inquiries`
- `GET /api/inquiries/:code`
- `GET /api/admin/inquiries`
- `GET /api/admin/inquiries/:code`
- `PUT /api/admin/inquiries/:code/quote`

Admin routes require:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

## Notes

- The frontend still uploads images as base64 strings to keep the browser code simple and compatible with the existing UI.
- If you later want larger uploads, we should switch the image flow to multipart uploads or direct signed upload URLs.
