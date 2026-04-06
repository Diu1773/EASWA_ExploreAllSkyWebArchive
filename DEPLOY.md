# EASWA Deployment Notes

This app can be deployed behind a single public URL and used from a poster QR code.

## Why the current app is deployable as-is

- The frontend already calls the API with a relative base path: `/api`.
- The backend already serves the built frontend from `frontend/dist`.
- This means the simplest production shape is one hostname, one process, one QR target.

## Recommended deployment shape

Use the root `Dockerfile` on a platform such as Railway, Render, Fly.io, or a small VPS.
This repo also includes a starter `render.yaml` for Render Blueprints.

- Build command: handled by Docker
- Start command: handled by Docker
- Public URL example: `https://easwa.example.com`
- QR code target: the same public URL
- The Docker image now listens on `${PORT:-5895}`, which matches platforms that inject a `PORT` variable.

## Required environment variables

Set these in the hosting platform:

- `EASWA_BASE_URL=https://your-public-domain`
- `EASWA_SESSION_SECRET=<long-random-secret>`

If you want Google sign-in:

- `GOOGLE_CLIENT_ID=<google-oauth-client-id>`
- `GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>`

If you use Google sign-in, register this callback URL in Google Cloud:

- `https://your-public-domain/api/auth/callback`

## Optional environment variables

- `EASWA_RECORD_REQUIRE_LOGIN=false`
  Use this if poster visitors should be able to submit records without logging in.
  Note that `/my` and `/drafts/*` still require login because they are user-specific.

- `EASWA_DB_PATH=/var/data/easwa.db`
- `EASWA_EXPORT_DIR=/var/data/submissions`
  Recommended when you attach a persistent disk on Render or another host.
  Without these, the app uses local paths under `backend/`.

- `EASWA_TRANSIT_PREVIEW_WORKERS=1`
- `EASWA_TRANSIT_FRAME_COUNT_WORKERS=1`
- `EASWA_TRANSIT_CUTOUT_MEMORY_CACHE_MAX_ITEMS=1`
- `EASWA_TRANSIT_CUTOUT_MEMORY_CACHE_MAX_BYTES=16777216`
- `EASWA_TRANSIT_CUTOUT_HOT_CACHE_MAX_ITEMS=0`
  Useful on Render free instances if the transit lab preview hits the 512 MB memory cap.
  The current code already defaults to conservative values outside local development, but these let you tighten or relax them explicitly.

- `EASWA_CORS_ORIGINS=https://your-public-domain`
  Only needed if you later split frontend and backend across different origins.
  With the current single-origin deployment, relative `/api` requests are simpler.

## Important operational note

The backend currently stores data in local files:

- SQLite database: `backend/easwa.db`
- Exported submissions: `backend/submissions/`

That is fine for a quick demo, but many hosted containers have ephemeral storage.
If you redeploy or the instance is replaced, stored records may be lost unless you attach persistent storage or move to an external database/object store.

## Render quick start

1. Push this repo to GitHub.
2. In Render, create a new Blueprint and point it at this repo.
3. Render will read `render.yaml` and create a Docker-based web service.
4. For the first trial deploy, the Blueprint sets `EASWA_RECORD_REQUIRE_LOGIN=false` so visitors can submit records without Google login.
5. If you later want Google sign-in, add these in the Render dashboard and set the callback to `https://your-domain/api/auth/callback`:
   - `EASWA_BASE_URL`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
6. If you later move off the free plan, attach a persistent disk and set:
   - `EASWA_DB_PATH=/var/data/easwa.db`
   - `EASWA_EXPORT_DIR=/var/data/submissions`

## Local production-like check

```bash
npm --prefix frontend run build
python -m uvicorn main:app --host 0.0.0.0 --port 5895 --app-dir backend
```

Then open:

- `http://localhost:5895/`
- `http://localhost:5895/api/health`

## Poster QR recommendation

Use the root URL, not a deep link, unless you are deliberately demonstrating a specific page.

- Good: `https://your-public-domain/`
- Good: `https://your-public-domain/target/WASP-43b`
- Avoid: temporary LAN IPs such as `http://192.168.x.x:5895`

For a conference poster, keep the final URL short and stable. If possible, use a custom domain or a short redirect domain that you control.
