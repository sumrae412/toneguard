# toneguard-sync (Railway)

Replaces the Supabase backend. Tiny Node/Express + `ws` server backed by Railway-managed Postgres.

## Endpoints

| Method | Path   | Auth           | Purpose |
|--------|--------|----------------|---------|
| POST   | `/auth`  | none          | `{ hash }` → `{ token }` (HS256 JWT, 1hr) |
| GET    | `/sync`  | Bearer JWT    | Pull all rows for this user |
| POST   | `/sync`  | Bearer JWT    | Upsert one `{ data_type, payload, version }`, broadcast to WS subscribers |
| GET    | `/ws?token=...` | JWT query | WebSocket upgrade; receives `{event:"UPDATE", data_type, payload, version, updated_at}` messages |
| GET    | `/healthz` | none        | `{ ok: true }` |

## First-time deploy

1. **Create the project.** In the Railway dashboard (or CLI):
   - `railway init` in this directory, or connect this repo path via the dashboard.
2. **Add a Postgres plugin** to the project. Railway auto-injects `DATABASE_URL` into the service.
3. **Set `JWT_SECRET`** as a service variable. Generate with:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Deploy.** Railway will auto-detect Node via Nixpacks and run `npm start`.
5. **Apply the schema** (one-time):
   ```
   DATABASE_URL='<railway postgres url>' npm run db:init
   ```
6. **Grab the public URL** (e.g. `https://sync-server-production-3a24.up.railway.app`) and paste it into the 3 client constants:
   - `src/sync/sync-client.js` → `SYNC_SERVER_URL`
   - `toneguard-mcp/sync.py` → `SYNC_SERVER_URL` (or set `TONEGUARD_SYNC_URL` env var)
   - `android/app/src/main/java/com/toneguard/SyncManager.kt` → `SYNC_SERVER_URL`

## Migrating existing data from Supabase

Run once, after the Railway server is up and schema is applied, but before retiring Supabase:

```
SUPABASE_URL='https://jimjfaaaccqtcbbxsrys.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<service role key from Supabase dashboard>' \
DATABASE_URL='<railway postgres url>' \
npm run migrate:supabase
```

The service role key is in Supabase → Settings → API → `service_role` key. **Do not commit it.** It bypasses RLS, which is what we want for a one-shot export.

## Local dev

```
cp .env.example .env   # fill in DATABASE_URL (local pg) and JWT_SECRET
npm install
npm run db:init
npm run dev
```

## Scaling note

The in-memory WebSocket fan-out assumes a **single service replica**. If you ever scale to >1 replica, swap the in-process `subscribers` map for Postgres `LISTEN`/`NOTIFY` (each replica subscribes to a `sync_updates` channel; the push handler emits `NOTIFY sync_updates, '...'`). One-replica is the right default for ToneGuard's volume.

## Cost

- Railway Hobby plan: $5/month minimum, usage-based above
- Postgres plugin: included in Hobby usage
- Total for a low-traffic personal app: ~$5–7/month (vs $25 Supabase Pro)
