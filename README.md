# Bare Roots × Couture House — Content Portal

One private link for Bare Roots (Iisha & Sabrina) and Couture House (Fred & Azaiah).

- **Drop Off** — the client taps, picks photos/videos from her phone, done. Raw footage goes straight to secure storage (no size games, no email, no WeTransfer).
- **Footage** (studio) — every drop-off as a group with thumbnails. Download, mark used, archive to free space.
- **Content / Ready to Post** — the studio publishes finished posts with caption, hashtags, CTA, cover, and a per-platform posting plan. The client downloads, copies, posts, ticks it off, and taps **Approve** or **Request a change** (one round, five business days, then auto-approved — exactly as the agreement says).
- **Calendar** — "this week" checklist + month view, Instagram / TikTok / Facebook.
- **Ideas** — a shared corkboard. Pin, reply, heart, attach a reference clip, "Make this content".
- **Activity** — what's new, with unread badges. No email needed.

Raw footage and finished deliverables live in separate folders in the bucket (`raw/`, `deliverables/`, `ideas/`) and separate collections in the metadata store — they never mix.

Everything runs on free tiers: **Netlify** (hosting + functions + Blobs) and **Backblaze B2** (10 GB storage, no card needed). Uploads and downloads go browser ↔ B2 directly via presigned URLs, so Netlify bandwidth stays near zero.

---

## 1. First-time setup (about 15 minutes)

### A. Backblaze B2 — storage

1. Create a free account at backblaze.com/cloud-storage (no credit card).
2. **Buckets → Create a Bucket**
   - Name: `bareroots-portal` (bucket names are global; add a suffix if taken)
   - Files in bucket: **Private**
   - Leave encryption/object lock off.
3. On the bucket card note the **Endpoint** — e.g. `s3.us-east-005.backblazeb2.com`.
4. **Application Keys → Add a New Application Key**
   - Name: `bareroots-portal`
   - Access: **Read and Write**
   - Allow access to: **All** (needed so the setup script can write the CORS rule; you can tighten later)
   - Copy the **keyID** and **applicationKey** immediately — the key is shown once.

### B. Project `.env`

```bash
cp .env.example .env
```

Fill in:

| Variable | Value |
|---|---|
| `CLIENT_PIN` | 4–8 digits for Iisha & Sabrina |
| `STUDIO_PIN` | 4–8 digits for Fred & Azaiah (must differ) |
| `SESSION_SECRET` | long random string — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `B2_KEY_ID`, `B2_APP_KEY` | from step A4 |
| `B2_BUCKET` | from step A2 |
| `B2_ENDPOINT` | `https://` + the endpoint from A3 |
| `PORTAL_ORIGINS` | `http://localhost:8888,http://localhost:5173,https://<your-site>.netlify.app` |

Then:

```bash
npm install
npm run check:env     # catches typos, weak secret, same PINs
npm run setup:b2      # writes the CORS rule and does a real upload/download round-trip
```

If `setup:b2` can't write CORS (key is bucket-restricted), it prints the rule to paste in **Bucket Settings → CORS Rules**. Choosing "Share everything in this bucket with every origin" is also fine — the bucket is private, so files are still only reachable with a signed link.

### C. Netlify

1. Push this folder to GitHub, **Add new site → Import from Git**. Build settings are read from `netlify.toml` (build `npm run build`, publish `dist`, functions `netlify/functions`).
2. **Site configuration → Environment variables** — add every variable from `.env` (`CLIENT_PIN`, `STUDIO_PIN`, `SESSION_SECRET`, `B2_*`, `PORTAL_ORIGINS`, optionally `META_STORE`, `MAX_UPLOAD_MB`, `STORAGE_BUDGET_GB`).
3. Deploy. Open `https://<site>.netlify.app/api/health` — you want `"ok": true`.
4. If you change the site name, add the new URL to `PORTAL_ORIGINS` and run `npm run setup:b2` again (CORS is per-origin).

Share the one link with Iisha and Sabrina plus the **client PIN**. Tell them to "Add to Home Screen" on iPhone — it opens like an app.

---

## 2. Running it locally

Two ways:

```bash
npm run dev:local
```
Zero accounts needed. Runs a fake S3 on :4569, the real functions on :8888 with JSON-file metadata, and Vite on :5173. PINs `1234` (client) / `9999` (studio). Good for UI work.

```bash
npm run dev:full      # = netlify dev
```
Uses your `.env` → real Backblaze bucket, local sandbox of Netlify Blobs. Needs the Netlify CLI (`npm i -g netlify-cli`). This is the one to use before the first deploy.

---

## 3. How it's built

```
index.html, src/            Vite + React 18 + TypeScript, hand-written CSS (no Tailwind, no UI kit)
  views/Gate                PIN + "who's here" → signed session token in localStorage
  views/DropOff             client upload (two at a time, 3 retries, poster generated in-browser)
  views/Ready               deliverables grid + DeliverableDetail sheet
  views/CalendarView        week checklist + month grid, Eastern time
  views/Ideas               corkboard, comments, hearts, attachments, status
  views/ActivityView        feed + unread tracking
  views/studio/Footage      raw library, multi-select download / mark used / archive, storage meter
  views/studio/Composer     build a post: files, caption, hashtags, CTA, plan per platform, sources
netlify/functions/          Netlify Functions v2 (Request → Response), esbuild bundled
  auth.ts                   POST /api/auth — PIN → role, rate limited
  state.ts                  GET /api/state — everything, role-filtered, + poster preview URLs; auto-approval sweep
  upload.ts                 POST /api/upload/presign, /complete — presigned PUT to B2, then verify with HEAD
  raw.ts                    batches, labels, status, archive (deletes objects), download/play URLs
  deliverables.ts           CRUD, publish/unpublish, approve, changes, posted, file labels, download URLs
  ideas.ts                  CRUD, comments, hearts, attachments
  preview.ts                inline URL for any visible object
  health.ts                 setup aid
  _lib/store.ts             metadata collections — Netlify Blobs (compare-and-set) | B2 JSON | local files
  _lib/s3.ts                B2 via the S3 API; checksum headers disabled (B2 rejects them)
  _lib/auth.ts              HMAC session tokens, 180 days, renewed on every load
  _lib/business.ts          5 business days, America/New_York
shared/types.ts             the data model, shared by both sides
scripts/setup-b2.mjs        CORS + round-trip test
scripts/check-env.mjs       .env sanity
scripts/dev-local.mjs       the no-accounts dev server
```

**Roles.** The PIN decides the role. Client: upload raw, see published content, approve / request changes, mark posted, pin ideas, comment. Studio: everything, plus drafts, publish, delete, archive, idea status, and private studio notes. The client never receives drafts or studio notes from the API — it's filtered server-side, not hidden in the UI.

**Storage layout.** `raw/<batchId>/<fileId>-<name>`, `deliverables/<deliverableId>/<fileId>-<name>`, `ideas/<ideaId>/…`, plus `<key>.poster.jpg` thumbnails the browser makes before uploading (so even a 2 GB .MOV gets a thumbnail without any server-side video processing).

**Metadata.** Five JSON documents (batches, raw, deliverables, ideas, activity) in Netlify Blobs with strong consistency and `onlyIfMatch` compare-and-set — two people acting at once can't overwrite each other. Set `META_STORE=b2` to keep them in the bucket instead (no CAS, fine for four people).

**Approval clock.** Publish → `autoApproveAt = +5 business days`. A change request clears it; redelivering restarts it. The sweep runs lazily on every state load, so there is no cron to maintain.

---

## 4. Keeping it free

- **Backblaze**: 10 GB free, downloads free up to 3× stored. The studio sees a storage meter; **Archive** on used footage deletes the originals and keeps the record. Download before archiving.
- **Netlify** free plan is credit-based (300/month). Uploads/downloads never touch Netlify; functions are tiny JSON calls. Expect single-digit credit use.
- **Netlify Blobs** is included on all plans.
- Single-file upload cap is 5 GB on B2's single-request API (`MAX_UPLOAD_MB`, default 4000). Longer footage: trim or split.

## 5. Later (not built, on purpose)

- Kie.ai generation hooks (studio-side) — add when the time comes.
- Email/SMS notifications — the activity feed covers it for now; Resend's free tier is a 20-minute add.
- Multipart resumable uploads if anyone regularly sends >2 GB files on bad Wi-Fi.
- More clients: the whole thing is per-client by design — fork the repo, new bucket, new PINs, new logo.

---

## 6. Checks run before handoff (Oct 16, 2026 — final pass)

- `npm run typecheck` and `npm run build` clean.
- 52 API assertions (auth + lockout, presign/PUT/HEAD/complete, role filtering, hashtag normalisation, approval clock, change→republish→approve, posted marks, ideas, archive deleting objects, both-sides delete, orphan recovery, admin endpoint guards, path traversal).
- 31-step real-browser workflow, client on a phone viewport and studio on desktop, through the actual UI: gate → tour → drop-off with thumbnails → pin idea + comment → studio marks used → composer (main + cover upload, caption, hashtags, suggested times, source footage, preview) → publish → client downloads, copies caption, marks posted, requests a change → studio delivers the fix → client approves → client deletes via preview → guide on/off → studio archives. Zero page errors.
- Live site: health ok, CORS fixed via `/api/admin/cors`, real uploads verified from both roles against the production bucket.
- Layout checked at 390, 430, 768, 1024 and 1920 px wide — no horizontal overflow anywhere.
