# DataBirdLab: Multi-Colony Support + Cloud Deployment

**Date:** 2026-04-24
**Author:** Abdulla (Cornell Lab of Ornithology)
**Status:** Design — eng review + outside voice (Codex) complete (2026-04-24). Decisions applied inline. Pending final user sign-off.

**Eng review changelog (2026-04-24):**
- ✅ Full scope retained (auth + colony CRUD UI + everything, single PR)
- ✅ Signed URLs with **request-scoped dedupe** (revised from naive per-response after Codex flagged 21k detections × 2.3k assets)
- ✅ Soft-delete colonies, child data preserved forever
- ✅ Colony filtering explicit at every endpoint **+ threaded into service-layer functions** (calibration.py, fusion.py, bayesian_fusion.py — Codex caught the bleed risk in helpers)
- ✅ Failed signed URL → `imageUrl=null` + log; partial degradation
- ✅ **Pipelines run as Cloud Run Jobs** (revised from sync-inline after Codex pointed out existing data has 2,139-tile drone surveys; sync would hold HTTP for 30+ min)
- ✅ Full test coverage (22 paths); cross-colony bleed regression test mandatory
- ✅ `min-instances=0`, accept ~15s cold start tax
- ✅ Migration **preserves primary keys exactly** + normalizes file_path strings (Codex caught path heterogeneity + ID-shift breakage)
- ✅ Frontend scope expanded: install React Query + Supabase JS, repo-wide `fetch()` sweep, kill `localhost:8000` hardcode
- ✅ Dockerfile moved to repo root (proper build context); Vite env vars baked in at build time, not runtime
- ✅ Inline fixes: `roles/iam.serviceAccountTokenCreator` on Cloud Run SA, SQLAlchemy pool tuning, `Colony.slug` immutable, `get_colony` uses `Depends(get_session)`

## Problem

DataBirdLab is hardcoded to a single study site (Boeung Sne, Cambodia). To reproduce the system for new colonies, a researcher would need to fork the repo, edit ~10+ files, redeploy, and run a separate database. We need the app to host multiple colonies in one deployment, with each colony fully isolated (its own species list, model weights, ARUs, surveys, detections, dashboard).

Second goal: move from local-only development to a live Cloud Run deployment, preserving the existing Boeung Sne data (3.8 MB SQLite + 4.2 GB of tiles/uploads + 12 MB of YOLO weights) under the new `colony_id=boeung-sne` scope.

## Goals

1. Single deployment, multiple colonies. Users switch between colonies via a dropdown in the top bar.
2. Each colony is a sealed world: separate surveys, ARUs, detections, species lists, model weights, map center, color mappings.
3. Authenticated access via Supabase Auth (any signed-in user has full CRUD on all colonies in v1).
4. Cloud Run + Supabase Postgres + GCS for static assets, targeting < $10/mo.
5. Existing Boeung Sne data migrates cleanly under `slug='boeung-sne'` with no row loss.
6. Local dev still works (SQLite + local `/static`) via a `STORAGE_BACKEND=local` switch.

## Non-goals

- Per-user colony-level access control (any authenticated user sees all colonies for v1; add a user↔colony join table later if needed).
- Alembic / formal migrations framework (this is a one-shot migration; adopt Alembic later if schema changes pile up).
- Public-read GCS bucket (Cornell's Domain Restricted Sharing org policy blocks `allUsers` IAM grants on their GCP org). Using **V4 signed URLs** instead — still simple enough for v1.
- Cross-colony comparison UI (out of scope; flat routing + context leaves room for this later).
- URL-scoped colony routes (`/colony/<slug>/dashboard`). Keep routes flat; context drives scope.
- Multi-region deployment, CDN, custom domain (defer to follow-ups).

## Architecture

```
  Browser
     │  1. Static SPA  (Cloud Run)  — serves /index.html + JS bundle
     │  2. API calls   (Cloud Run)  — Authorization: Bearer <JWT> + ?colony_slug=
     │  3. Tile images (GCS signed) — https://storage.googleapis.com/<bucket>/colonies/<slug>/...?X-Goog-Signature=...
     │
  Supabase (auth + Postgres)
```

One Cloud Run service serves both the API and the built frontend bundle. Same-origin — no CORS between frontend and API.

## Design

### 1. Data model

**New table: `Colony`**
```
id:                      int primary key
slug:                    str unique — URL/API handle (e.g. 'boeung-sne')
name:                    str — display name
description:             str (nullable)
lat, lon:                float — map center
species_color_mapping:   JSON (nullable) — replaces SystemSettings.species_color_mapping
visual_model_path:       str (nullable) — replaces SystemSettings.visual_model_path
acoustic_model_path:     str (nullable) — replaces SystemSettings.acoustic_model_path
min_confidence:          float default 0.25
tile_size:               int default 1280
created_at:              datetime
is_active:               bool default true
```

**Add `colony_id` FK to:**
- `Survey` — non-null, indexed
- `ARU` — non-null, indexed
- `CalibrationWindow` — non-null, indexed (denormalized from Survey for fast filtering)

**Unchanged (scope inherited via Survey):**
- `MediaAsset`, `VisualDetection`, `AcousticDetection`. Every existing query that touches detections already joins through `MediaAsset → Survey`, so adding `where(Survey.colony_id == X)` at that join point scopes the data.

**`SystemSettings`:**
The per-colony fields (`species_color_mapping`, `visual_model_path`, `acoustic_model_path`, `min_confidence`, `default_lat`, `default_lon`) move to `Colony`. What remains is true app-wide state (none currently); table may be deleted in the implementation if empty.

### 2. Backend API

**New endpoints (auth required):**
```
GET    /api/colonies                 → list all active colonies
GET    /api/colonies/{slug}          → single colony metadata + config
POST   /api/colonies                 → create new colony
PATCH  /api/colonies/{slug}          → update colony config
DELETE /api/colonies/{slug}          → soft delete (is_active=false)
```

**Scoping dependency:**
```python
def get_colony(
    colony_slug: str,
    session: Session = Depends(get_session),
) -> Colony:
    colony = session.exec(
        select(Colony).where(Colony.slug == colony_slug, Colony.is_active == True)
    ).one_or_none()
    if not colony:
        raise HTTPException(404, "Colony not found")
    return colony
```

`Colony.slug` is **immutable after creation** — `PATCH /api/colonies/{slug}` rejects requests that try to change the slug field. Renaming requires creating a new colony and migrating data manually.

Every colony-scoped endpoint takes `colony_slug: str` as a query param and uses this dependency to resolve it.

**Endpoints that need `colony_slug`:**
- `/api/surveys` (list, import, get, delete, status, map_data, arus)
- `/api/arus` (list, create)
- `/api/stats/*` (daily, acoustic, species, overview, species_history)
- `/api/detections/*` (visual, acoustic)
- `/api/fusion/*` (overlapping, report, bayesian)
- `/api/calibration/*` (windows, summary, features, backtest, model, predict)
- `/api/species_list`, `/api/acoustic/activity/hourly`, `/api/arus/{id}/detections`

**Service-layer scoping (added after outside-voice review):**

Endpoint-level filtering isn't enough. The fusion/calibration modules contain helper functions that query across all surveys/ARUs:

| File | Function | Current behavior | Fix |
|---|---|---|---|
| `calibration.py:202` | `rebuild_calibration_windows()` | Deletes entire `CalibrationWindow` table, rebuilds from ALL surveys | Take `colony_id` arg; only delete + rebuild this colony's rows |
| `fusion.py:68` | `find_overlapping_arus()` | Global ARU lookup | Filter by `colony_id` |
| `bayesian_fusion.py:235, 437` | Bayesian training | Iterates all completed drone surveys + all ARUs | Take `colony_id` arg; scope all queries |

**Rule for the implementation:** every function that touches `Survey`, `ARU`, `MediaAsset`, `*Detection`, or `CalibrationWindow` must take a `colony_id` (or `colony: Colony`) parameter and use it in every WHERE clause. The `test_cross_colony_isolation.py` test will catch any straggler.

**Endpoints that stay global:**
- `/api/colonies*` (discovery)
- `/api/health` (liveness probe, no auth)
- `/static/*` during local dev only (in prod, tiles come from GCS)

**Auth — Supabase Auth with ES256 JWT:**
Supabase's current signing key is ECC (P-256), so verification uses the public key from the JWKS endpoint:

```python
from jwt import PyJWKClient
import jwt

JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
_jwks_client = PyJWKClient(JWKS_URL)

def get_current_user(authorization: str = Header(...)) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    signing_key = _jwks_client.get_signing_key_from_jwt(token).key
    return jwt.decode(
        token, signing_key,
        algorithms=["ES256"],
        audience="authenticated",
        issuer=f"{SUPABASE_URL}/auth/v1",
    )
```

Dependency applied globally via FastAPI `dependencies=[Depends(get_current_user)]` on the main router. `/api/health` opts out.

**Config resolution inside pipelines:**
Drone and BirdNET pipelines currently read `SystemSettings`. They'll switch to resolving the `Colony` from the Survey being processed:
1. `survey = session.get(Survey, survey_id)` → already have survey
2. `colony = session.get(Colony, survey.colony_id)`
3. Read `colony.visual_model_path`, `colony.min_confidence`, `colony.tile_size`, etc.
4. Hardcoded fallback only if colony field is null.

**Pipeline execution model — Cloud Run Jobs (revised after outside-voice review):**

Current code uses `BackgroundTasks` + `multiprocessing.Process` to defer pipeline work. **This breaks on Cloud Run Services** (instance scale-down kills child processes) AND **synchronous-in-request also breaks** at the data scale we have (existing acoustic surveys: 55-56 audio files; drone surveys: 2,139 tiles → would hold the HTTP connection for 30+ minutes, exceeding browser/proxy timeouts).

**Real fix:** use Cloud Run **Jobs** (separate from Cloud Run Services).

```
HTTP upload (Cloud Run Service)
   │  1. Validate input + create Survey row with status='pending'
   │  2. Upload raw files to gs://databirdlab-static-ahmed/colonies/<slug>/uploads/
   │  3. Trigger Cloud Run Job:  gcloud run jobs execute pipeline-job
   │     --args="--survey-id=$ID --pipeline-type=drone"
   │  4. Return 202 Accepted with survey_id

Cloud Run Job (pipeline container, separate image)
   │  - Pulls Survey from DB
   │  - Updates status='processing'
   │  - Runs the existing drone or birdnet pipeline against GCS-staged input
   │  - Writes tiles + detections to DB + GCS
   │  - Updates status='completed' or 'failed'
   │  - Job lifecycle is managed by Cloud Run Jobs (24hr timeout, no scale-down kills)

Frontend
   │  - Polls GET /api/surveys/<id>/status until status in ('completed','failed')
   │  - Shows progress meter
```

**Two container images:**
- `databirdlab-api` (the FastAPI Cloud Run Service)
- `databirdlab-pipeline` (the Cloud Run Job; same code base, different entrypoint that calls the pipeline runner directly)

Both built from the same Dockerfile with build-arg `ENTRYPOINT` switching between `uvicorn` and the pipeline runner script.

**Survey row creation race:** to avoid the existing duplicate-on-retry bug (survey row committed before processing starts), wrap upload validation + survey row creation + job trigger in a single transaction; only commit the survey row after the Job has been successfully queued.

**Cost:** Cloud Run Jobs bills compute time, no idle cost. Estimated < $1/mo at research traffic.

**Database connection pool sizing (Supabase Session pooler):**
```python
engine = create_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=2,
    pool_pre_ping=True,  # detect stale connections
    pool_recycle=300,    # recycle every 5 min (Supabase pooler closes idle)
)
```

### 3. Frontend

**Scope reality check (from outside-voice review):** the frontend currently has NO React Query, NO Supabase JS, and many pages bypass `frontend/src/lib/api.ts` with raw `fetch()` calls — `SurveyDetailPage`, `DetectionsPage`, `InspectorPanel`, `SpeciesActivityChart` all need migration. `InspectorPanel` is hardcoded to `http://localhost:8000`. This is a repo-wide rewrite.

**New dependencies to install:**
```bash
npm install @tanstack/react-query @supabase/supabase-js
```

**`CurrentColonyContext` (new):**
React context holding `currentColony: Colony` and `setCurrentColony(slug)`. Persisted in `localStorage` so the active colony survives reloads. Bootstraps from `/api/colonies` on app mount; falls back to the first colony if the persisted slug is gone.

**New UI:**
- **Colony dropdown** in the top bar — replaces the hardcoded "Boeung Sne Monitoring" in `app-sidebar.tsx`. Shows colony name + lat/lon, "+ New colony" at the bottom of the list.
- **`NewColonyModal`** — form for `name, slug, lat, lon, description` with optional fields for species mapping / model paths / tile size. Defaults minimize required input.
- **Colony Settings page** (`/colony/settings`) — edits the active colony's config (replaces the current global Settings area that edits `SystemSettings`).
- **Auth pages** — `/login` and `/signup` custom-themed forms using `@supabase/supabase-js`. A `<ProtectedRoute>` wrapper redirects unauthenticated users to `/login`.

**`apiClient` wrapper (`frontend/src/lib/api.ts`):**
Centralizes two concerns so individual components stay clean:
1. Reads current colony slug from context, auto-appends `?colony_slug=<slug>` on every request (skip-list for `/api/colonies*` and auth-exempt paths).
2. Reads Supabase JWT from the current session, adds `Authorization: Bearer <token>`.
3. On 401, clears the session and redirects to `/login`.
4. Strips any `http://localhost:8000` base URL — uses relative paths only (resolved by Vite dev proxy in dev, same-origin in prod).

**Repo-wide fetch sweep — every page migrates:**
- `SurveyDetailPage.tsx:30, 40, 41` → use `apiClient.get('/api/surveys/${id}')`, etc.
- `DetectionsPage.tsx:28-30` → `apiClient.get('/api/detections/visual?days=365')`, etc.
- `InspectorPanel.tsx:83-85, 111` → same pattern, kill the `http://localhost:8000` hardcode
- `SpeciesActivityChart.jsx:17` → same
- Any other `fetch(` call in `frontend/src/` — grep + replace systematically

**React Query integration:**
Wrap data fetches in `useQuery({ queryKey: ['surveys', currentColony.slug], ...})`. Colony slug in the query key means switching colonies invalidates automatically.

**Hardcoded Boeung Sne strings to replace:**
- `app-sidebar.tsx:49` → `{currentColony.name}`
- `DashboardPage.tsx:328` → `{currentColony.name}`
- `SurveyDetailPage.tsx:50` → `${currentColony.name} Restricted Zone` (or drop the suffix)
- `UnifiedMap.tsx:81`, `CalibrationMap.tsx:62`, `ColonyMap.jsx:37`, `SettingsModal.jsx:6-7`, `SettingsPage.tsx:688` → `[currentColony.lat, currentColony.lon]`
- `NewSurveyModal.jsx:218` placeholder → `${currentColony.slug.toUpperCase()}_ZONE1_2026_Q1`
- `main.py:393` (backend) → colony name from DB
- `main.py:50` (form description) → generic

**Colony-switching behavior:**
On `setCurrentColony(newSlug)`:
1. Invalidate all React Query cache: `queryClient.invalidateQueries()`.
2. Navigate to `/dashboard`.
3. Map re-centers on new colony's lat/lon on re-render.

**Routing:** stays flat (`/dashboard`, `/surveys`, `/calibration`, etc.). Context drives scope. URL-based colony routes are a deferred follow-up.

### 4. Data migration — existing Boeung Sne → multi-colony schema

**Script: `backend/scripts/migrate_to_multi_colony.py`**

Runs once, end-to-end:
1. Export all rows from existing `backend/data/db.sqlite` using SQLModel with the old schema.
2. Connect to Supabase Postgres via `DATABASE_URL` (env var).
3. Create new schema with new models (`Colony` table + `colony_id` columns on Survey/ARU/CalibrationWindow).
3a. **Normalize file_path values** before insert. Current SQLite has a mix of:
    - Absolute: `/Users/abdulla/Desktop/.../backend/static/uploads/survey_12/audio/x.wav`
    - Relative: `static/uploads/survey_12/audio/x.wav`
    Strip any prefix up to and including `static/` so all paths become relative (`uploads/...` or `tiles/...`). The storage layer prepends `colonies/<slug>/` at URL-build time.
3b. **Preserve primary keys exactly.** Use explicit-id INSERT for every table (`Colony`, `ARU`, `Survey`, `MediaAsset`, `VisualDetection`, `AcousticDetection`, `CalibrationWindow`). After the bulk insert, fix each table's auto-increment sequence:
    ```sql
    SELECT setval(pg_get_serial_sequence('survey', 'id'), (SELECT MAX(id) FROM survey));
    -- repeat for every table
    ```
    This keeps Survey 12 = Survey 12 across the migration. Bookmarks (`/surveys/12`) keep working. Existing tile directory names (`survey_12/`) match.
4. Seed the `boeung-sne` colony, hydrating from the existing `SystemSettings` row:
   ```python
   Colony(
     slug='boeung-sne',
     name='Boeung Sne',
     description='Boeung Sne Protected Forest, Cambodia',
     lat=settings.default_lat,       # 11.406949
     lon=settings.default_lon,       # 105.394883
     species_color_mapping=settings.species_color_mapping,
     visual_model_path=settings.visual_model_path,
     acoustic_model_path=settings.acoustic_model_path,
     min_confidence=settings.min_confidence,
     tile_size=1280,
   )
   ```
5. Insert all `ARU`, `Survey`, `MediaAsset`, `VisualDetection`, `AcousticDetection`, `CalibrationWindow` rows, setting `colony_id` to the Boeung Sne colony's ID on the three scoped tables.
6. Enforce `colony_id NOT NULL` after backfill (post-insert ALTER).
7. Verify row-count equality for every table between SQLite export and Postgres import. Abort with a diff if any count mismatches.

Idempotent guard: if Boeung Sne colony already exists in Postgres, script aborts cleanly to avoid double-insert.

**Schema migration strategy — no Alembic:**
For this one-shot migration, the script is the migration. Future schema changes can adopt Alembic if the cadence warrants it.

**Static file migration (4.2 GB → GCS):**
Separate shell script `backend/scripts/upload_static_to_gcs.sh`:
```bash
gsutil -m rsync -r backend/static/tiles   gs://$GCS_BUCKET/colonies/boeung-sne/tiles
gsutil -m rsync -r backend/static/uploads gs://$GCS_BUCKET/colonies/boeung-sne/uploads
```

Files live under `colonies/<slug>/...` on GCS. New colonies' tiles/uploads land there automatically via the updated pipelines.

**`MediaAsset.file_path` handling:**
Existing values like `static/uploads/survey_12/audio/xxx.wav` stay unchanged in the DB. The URL builder in `storage.py` strips the `static/` prefix and prepends `https://storage.googleapis.com/<bucket>/colonies/<slug>/` at read time. No DB rewrite. Local dev (which keeps local disk paths) works identically.

**Rollback:**
Back up `backend/data/db.sqlite` before running (cp to `.sqlite.bak`). If anything goes wrong, the local app still runs against the SQLite copy; Supabase project can be reset cleanly.

### 5. Deployment

**Supabase project setup:**
- Project `databirdlab` (URL: `https://lzvcxqkhkttqqzdfonhn.supabase.co`).
- `DATABASE_URL` from Settings → Database → Connection string (URI tab, "Session pooler" recommended for Cloud Run).
- Auth: Email provider enabled. Email confirmation toggle is a deployment-time choice.
- Publishable key → baked into frontend bundle at build time (safe to expose).
- Service-role key → never exposed; not used in this design (backend verifies JWTs via JWKS, doesn't mint them).
- **Open action item:** the service-role key pasted in chat on 2026-04-24 must be rotated before deploy.

**GCS bucket:**
- Created: `gs://databirdlab-static-ahmed/` (us-central1, project `databirdlabel`).
- **Access model: V4 signed URLs** (not public IAM — blocked by Cornell's Domain Restricted Sharing org policy).
- CORS already applied — `GET, HEAD` from any origin, 1hr max-age.
- Cloud Run's runtime service account will be granted `roles/storage.objectAdmin` on this bucket. At request time, backend signs URLs with the service account's ambient credentials (no key file needed on disk).

**New backend module: `backend/app/storage.py`**
- On startup, reads `STORAGE_BACKEND` env var (`local` or `gcs`).
- `local` → current behavior via FastAPI `StaticFiles`; URLs are relative `/static/...` paths.
- `gcs` → URL builder generates V4 signed URLs with **request-scoped dedupe** (mandatory after outside-voice review noted 21k detections × 2.3k assets — naive signing would mint the same URL 10× per response):
  ```python
  # In a request-scoped cache (e.g. Starlette Request.state)
  signed_url_cache: dict[str, str | None] = {}

  def signed_url(blob_path: str) -> str | None:
      if blob_path in signed_url_cache:
          return signed_url_cache[blob_path]
      try:
          url = bucket.blob(blob_path).generate_signed_url(
              version="v4",
              expiration=timedelta(hours=1),
              method="GET",
          )
      except Exception as e:
          logger.error("signed_url_failed", path=blob_path, error=str(e))
          url = None
      signed_url_cache[blob_path] = url
      return url
  ```
  Default TTL 1 hour. Failed signing returns `null` so the rest of the response still serializes. Cache is request-scoped (no cross-user leakage); next request re-mints fresh URLs.
- Upload handler writes to GCS via `google-cloud-storage` in prod; to disk in dev.
- Tile generator (drone pipeline) writes PNGs under `colonies/<slug>/tiles/survey_<id>/...`.
- In prod, service account auth is ambient (Cloud Run metadata server) — no key file on disk.

**Dockerfile (at repo root, `Dockerfile`):**

(Per outside-voice review: `--source backend/` made backend the build context, but the Dockerfile copies `frontend/dist` which lives outside that context. Fix: build context = repo root.)

```dockerfile
FROM python:3.11-slim AS api
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY backend/ /app/backend/
COPY frontend/dist /app/backend/static/dist/
ENV PYTHONPATH=/app
EXPOSE 8080
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

Second image for the Cloud Run Job (same base, different command):
```dockerfile
FROM api AS pipeline-job
CMD ["python", "-m", "backend.scripts.run_pipeline_job"]
```

FastAPI mounts `/` → `backend/static/dist` (built SPA) as the catch-all. `/api/*` untouched.

**Frontend build — Vite env vars are BUILD-TIME, not runtime:**

(Per outside-voice review: Cloud Run env vars don't reach the already-built JS bundle.)

Bake Supabase config into the bundle at `npm run build`:
```bash
cd frontend
echo "VITE_SUPABASE_URL=https://lzvcxqkhkttqqzdfonhn.supabase.co" > .env.production
echo "VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_..." >> .env.production
npm run build  # Vite reads .env.production, embeds VITE_* into bundle
```

The Cloud Run service sees only backend env vars (`DATABASE_URL`, `STORAGE_BACKEND`, `GCS_BUCKET`). Supabase URL + publishable key live in the JS bundle.

**Cloud Run env vars:**
```
DATABASE_URL               postgresql://postgres.lzvcxqkhkttqqzdfonhn:<password>@...pooler.supabase.com:5432/postgres
SUPABASE_URL               https://lzvcxqkhkttqqzdfonhn.supabase.co
SUPABASE_PUBLISHABLE_KEY   sb_publishable_...  (bake into frontend build only, not backend)
STORAGE_BACKEND            gcs
GCS_BUCKET                 databirdlab-static
```

Cloud Run service account gets:
- `roles/storage.objectAdmin` on `gs://databirdlab-static-ahmed`
- **`roles/iam.serviceAccountTokenCreator` on itself** (required for `generate_signed_url()` to mint V4 signatures using ambient credentials — without it, signing fails with `you need a private key to sign credentials`).

No key file mounted.

**Deploy steps (production cutover):**
1. Rotate exposed Supabase secret key.
2. Grab `DATABASE_URL` from Supabase dashboard.
3. ✅ GCS bucket `databirdlab-static-ahmed` created, CORS applied. (Public-read blocked by org policy — using signed URLs instead.)
4. Run `migrate_to_multi_colony.py` locally, targeting Supabase Postgres.
5. Run `upload_static_to_gcs.sh` (~20–40 min for 4.2 GB on home internet).
6. Verify row counts in Supabase UI match local SQLite exports.
7. `npm run build` in `frontend/` (Vite outputs to `frontend/dist/`).
8. Deploy with gen2 + extended timeout:
   ```bash
   gcloud run deploy databirdlab \
     --source backend/ \
     --region us-central1 \
     --execution-environment gen2 \
     --timeout=3600 \
     --allow-unauthenticated \
     --min-instances 0 \
     --max-instances 2 \
     --memory 2Gi \
     --cpu 2 \
     --service-account databirdlab-runtime@databirdlabel.iam.gserviceaccount.com \
     --set-env-vars "..."
   ```
   Memory bumped to 2Gi (TensorFlow + YOLO model + BirdNET model). CPU 2 for sync pipeline throughput.
9. Smoke test: sign up, log in, see Boeung Sne dropdown entry, open a historical survey, confirm tiles render from `storage.googleapis.com`.

### 6. Cost estimate

| Service | Usage | Monthly cost |
|---|---|---|
| Cloud Run | scale-to-zero, ~1M req/mo | $0–3 |
| GCS storage | 4.2 GB + growth | $0.10–0.50 |
| GCS egress | low research traffic | $0–2 |
| Supabase | free tier (500 MB DB, 1 GB storage) | $0 |
| **Total** | | **$1–6/mo** |

Under the $10/mo advisor cap. `--max-instances 2` bounds runaway cost.

## Testing strategy

Full coverage of the test diagram below. 22 paths to close.

### Backend unit tests

**`tests/test_colony.py`:**
- `test_colony_create_with_unique_slug` — duplicate slug rejected
- `test_colony_slug_immutable` — PATCH attempting slug change rejected
- `test_get_colony_returns_404_for_missing_slug`
- `test_get_colony_returns_404_for_soft_deleted_slug` — `is_active=False` filtered out
- `test_colony_id_not_null_on_survey` — schema constraint enforced
- `test_colony_id_not_null_on_aru`
- `test_colony_id_not_null_on_calibrationwindow`

**`tests/test_cross_colony_isolation.py` — CRITICAL REGRESSION** (per the IRON RULE):
- Setup: create Colony A + Colony B, populate each with surveys, ARUs, detections (visual + acoustic), calibration windows.
- For every endpoint that takes `colony_slug`, assert: response includes Colony A data, response excludes Colony B data, and vice versa.
- Parametrize over all ~20 endpoints. Single test file, ~30 lines of fixture + a `pytest.mark.parametrize` over endpoint URLs.

**`tests/test_auth.py`:**
- `test_unauth_request_returns_401` — every `/api/*` except `/api/health`
- `test_expired_jwt_returns_401`
- `test_wrong_audience_returns_401`
- `test_tampered_signature_returns_401`
- `test_valid_jwt_passes` — happy path

**`tests/test_storage.py`:**
- `test_local_mode_returns_relative_url`
- `test_gcs_mode_signs_url` — mock `blob.generate_signed_url`
- `test_gcs_signing_failure_returns_null_and_logs` — failure path
- `test_strips_static_prefix_correctly` — `static/uploads/x.wav` → `colonies/<slug>/uploads/x.wav`

**`tests/test_migration.py`:**
- Fixture: pre-populated SQLite with old schema (Boeung Sne data shape).
- Run `migrate_to_multi_colony.py` against it, target ephemeral Postgres (testcontainers or in-memory).
- Assert: row counts match between source and dest for all 6 tables.
- Assert: every Survey/ARU/CalibrationWindow has `colony_id` set to the Boeung Sne colony's id.
- Assert: 2nd run aborts cleanly (idempotency).
- Assert: file_path strings preserved unchanged.

### Frontend e2e

**Playwright test `frontend/e2e/colony-switch.spec.ts`:**
- Sign up → log in
- Create Colony A, upload trivial survey, see detection on dashboard
- Create Colony B, switch to it, dashboard is empty
- Switch back to Colony A, dashboard shows the detection

### Deploy smoke test (manual, post-cutover)

Sign up → log in → see Boeung Sne in dropdown → open historical survey → confirm tiles render from `storage.googleapis.com/...?X-Goog-Signature=...` → switch (after creating a 2nd colony) → confirm isolation → upload a small test survey → confirm sync pipeline completes within request → verify detections appear.

## NOT in scope (explicitly deferred)

| Item | Why deferred |
|---|---|
| Per-user colony access control | All authenticated users see all colonies for v1; add user↔colony join table later if collaborators come on |
| Alembic / formal migrations | One-shot migration; adopt Alembic when schema changes pile up |
| URL-scoped colony routes (`/colony/<slug>/...`) | Context-driven routing is simpler; add when shareable links matter |
| Cross-colony comparison UI | Single-colony dashboard first; comparison is a follow-up product question |
| Cloud Run Jobs / Cloud Tasks for pipelines | Sync inside request works for v1's traffic; revisit if uploads exceed 60min limit or concurrency becomes a problem |
| Hard delete for colonies | Soft delete is reversible; permanent delete only if storage cost matters |
| Signed URL caching / batch minting | Per-request signing acceptable for v1 traffic; revisit if map load > 1s |
| Tile prefetch warm-up on cold start | Accept ~15s cold start; revisit if user complaints |
| Custom domain / SSL | `*.run.app` works fine; map a domain later |
| Multi-region deployment | us-central1 only; revisit if non-US researchers join |
| Public API for external consumers | All endpoints behind auth; expose if needed |

## What already exists (reused, not rebuilt)

| Concern | Existing code | Reuse strategy |
|---|---|---|
| Per-colony config skeleton | `SystemSettings` (singleton) — already holds lat/lon, model paths, color mapping | Convert from singleton to per-row Colony; migrate values into Boeung Sne row |
| FastAPI `Depends()` pattern | `get_session` already used | `get_colony` follows the same idiom |
| SQLModel ORM | Already used for all models | Add `Colony` + FK columns, no ORM swap |
| React Query | Implied from invalidation pattern | Reuse for cache invalidation on colony switch |
| Settings page UI | `SettingsPage.tsx` (already exists, ~1271 lines) | Convert into Colony Settings page |
| Background processing pattern | `BackgroundTasks` + `multiprocessing.Process` | **Replace** with sync inline execution (see Pipeline execution model) |
| File serving | `StaticFiles("static")` mount | **Wrap** behind storage abstraction (`local` mode keeps current behavior) |
| Pytest infrastructure | `tests/test_bayesian_fusion.py`, `test_calibration.py` | Add new test files in same style |

## Failure modes (per critical new codepath)

| Codepath | Failure mode | Test? | Error handling? | User-visible? |
|---|---|---|---|---|
| `get_current_user` JWT verification | Expired/tampered/wrong-audience token | ✅ test_auth.py | ✅ raises 401 | ✅ frontend redirects to /login |
| `get_colony` slug resolution | Slug doesn't exist or soft-deleted | ✅ test_colony.py | ✅ raises 404 | ✅ frontend can show "colony not found" |
| `storage.signed_url()` | GCS API down, IAM perms missing, network blip | ✅ test_storage.py | ✅ returns null + logs | ✅ map shows placeholder image |
| Sync pipeline execution | Cloud Run timeout (>60min), OOM, model load failure | ⚠️ smoke test only | ⚠️ Survey.status=failed | ⚠️ frontend shows error in survey list |
| Migration row-count mismatch | SQLite→Postgres copy loses rows | ✅ test_migration.py | ✅ aborts with diff | N/A (script, not request path) |
| Colony filter forgotten on new endpoint | Future endpoint serves cross-colony data | ✅ test_cross_colony_isolation.py covers all endpoints | N/A (preventive test) | ✅ regression test catches before merge |
| Cloud Run cold start during user activity | First request after idle takes ~15s | ❌ no test | ❌ no handling | ⚠️ user sees long spinner once per quiet period |

**Critical gaps remaining:** Cloud Run cold start UX has no test and no graceful handling. Acceptable for v1 (low traffic, research tool); revisit if users complain.

## Worktree parallelization strategy

| Lane | Steps | Modules touched | Depends on |
|---|---|---|---|
| **A — Schema + migration** | (1) Add Colony model + FKs, (2) write migration script + tests | `backend/app/models.py`, `backend/scripts/`, `backend/tests/test_migration.py`, `backend/tests/test_colony.py` | — |
| **B — Auth** | (3) JWT verification + dependency, (4) auth tests | `backend/app/auth.py` (new), `backend/app/main.py` (router-level dep), `backend/tests/test_auth.py`, `backend/requirements.txt` | — |
| **C — Storage abstraction** | (4) `backend/app/storage.py`, (10) wire upload paths | `backend/app/storage.py` (new), `backend/app/main.py` (upload), pipelines, `backend/tests/test_storage.py` | — |
| **D — Backend scoping** | (2) `get_colony` dep, thread `colony_slug` through endpoints | `backend/app/main.py` (most endpoints), `backend/tests/test_cross_colony_isolation.py` | A (needs Colony model) |
| **E — Frontend context + apiClient** | (5) `CurrentColonyContext`, `apiClient`, `<ProtectedRoute>` | `frontend/src/contexts/`, `frontend/src/lib/api.ts`, `frontend/src/router.tsx` | A + B (needs Colony shape + auth) |
| **F — Frontend UI** | (6) Colony dropdown, NewColonyModal, Colony Settings, Login, Signup | `frontend/src/components/`, `frontend/src/pages/` | E |
| **G — Hardcoded sweep** | (7) Replace all Boeung Sne literals | ~10 frontend files + `main.py:393, 50` | E |
| **H — Deploy infra** | (9) Dockerfile, deploy script, IAM bindings | `backend/Dockerfile` (new), deploy commands documented | C |
| **I — Cutover** | (10) Run migration, rsync static, deploy, smoke test | One-time ops | A + B + C + D + E + F + G + H |

**Parallel lanes (no shared module dirs):** A + B + C launch simultaneously in worktrees.

**Sequential after A merges:** D launches (scoping needs Colony model in main).

**Sequential after A + B merge:** E launches (context needs both Colony shape + auth session).

**Sequential after E merges:** F + G launch in parallel (different file dirs).

**Sequential after C merges:** H (deploy infra needs storage module).

**Conflict flag:** Lanes D and B both touch `backend/app/main.py` (router-level dep + endpoint scoping). Coordinate or merge B first, then D.

## Open questions / follow-ups

- **Per-user colony access control** — v1 lets any authenticated user see everything. If shared with external collaborators, add a `user_colony_access` table.
- **Tile prefetch / batch signed URLs** — current plan signs URLs one-by-one on the serializer. If map rendering gets slow due to many small sign operations, batch-mint and cache them in a request-scoped map.
- **Alembic adoption** — if schema changes pile up, introduce Alembic.
- **URL-scoped colony routes** (`/colony/<slug>/dashboard`) — enables shareable colony-specific links. Deferred.
- **Model weights per-colony in GCS** — currently `visual_model_path` on Colony can point at a local path or GCS URL. First new colony will clarify which pattern.
- **Email confirmation on/off** — decide at deploy based on demo vs real-use posture.

## New Python dependencies

Add to `backend/requirements.txt`:
```
PyJWT[crypto]==2.10.1          # JWT verification (ES256 from Supabase JWKS)
google-cloud-storage==2.18.2   # GCS signed URLs + uploads
psycopg2-binary==2.9.10        # Postgres driver for SQLAlchemy
supabase==2.12.0               # Optional: helper for auth flows; not strictly required if backend only verifies JWTs
```

`supabase` Python client is **optional** for the backend — JWT verification only needs `PyJWT` + JWKS endpoint. The frontend uses `@supabase/supabase-js` for the auth flow.

## Implementation plan (high-level phases)

This list is a sketch; detailed steps go in `docs/superpowers/plans/2026-04-24-multi-colony-implementation.md` (next after spec sign-off).

1. **Schema + model changes** — add `Colony` model, add FKs (Survey/ARU/CalibrationWindow), update SQLModel imports.
2. **Backend scoping** — add `get_colony` dependency, thread `colony_slug` through every endpoint, **plus thread `colony_id` into every service-layer function in calibration.py, fusion.py, bayesian_fusion.py**.
3. **Auth** — add Supabase JWT verification via JWKS (PyJWT[crypto]), apply global dependency.
4. **Storage abstraction** — `backend/app/storage.py` module with request-scoped signed-URL dedupe, wire upload paths + URL generation through it.
5. **Pipeline-as-Cloud-Run-Job** — extract pipeline runners into `backend/scripts/run_pipeline_job.py`, add 2nd Dockerfile target (`pipeline-job`), wire upload endpoint to trigger Job via `gcloud run jobs execute` (or the Python `google-cloud-run` SDK).
6. **Frontend foundation** — install React Query + Supabase JS, build `apiClient` + `CurrentColonyContext` + `<ProtectedRoute>`, **sweep every raw `fetch()` call across all pages and components**.
7. **Frontend UI** — colony dropdown, `NewColonyModal`, Colony Settings page, `/login` + `/signup` custom-themed.
8. **Hardcoded-string sweep** — replace all Boeung Sne literals.
9. **Migration script** — `backend/scripts/migrate_to_multi_colony.py` with explicit-id INSERTs + sequence-fix + path normalization + tests against fixture SQLite.
10. **Deploy infra** — Dockerfile at repo root (multi-stage, both api + pipeline-job targets), build frontend with Vite env vars, deploy Cloud Run Service + Cloud Run Job, IAM bindings (`roles/iam.serviceAccountTokenCreator` on runtime SA).
11. **Cutover** — rotate exposed secrets, run migration, rsync static to GCS (`gsutil -m rsync -r`), deploy both Cloud Run resources, smoke-test.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 8 issues (5 contradicted eng review; all resolved) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 7 issues raised, 7 resolved, 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** 8 findings. Cross-model tensions on pipeline execution model, signed URL caching, service-layer scoping, frontend scope, migration ID/path strategy, Dockerfile context, and Vite env-var timing. **5 contradicted my eng review and were correct** — spec amended accordingly.
- **CROSS-MODEL:** Codex caught the bigger blast-radius issues (pipeline scale, signed URL repetition, service-layer bleed). Claude eng review caught the procedural / IAM / test-coverage gaps (token creator role, regression tests, pool sizing). Both passes were value-additive.
- **UNRESOLVED:** 0
- **VERDICT:** **ENG CLEARED — ready to implement.** No required reviews remain. Optional reviews (CEO, Design, DX) skipped since the work is infra/backend-heavy with low UX surface area.
