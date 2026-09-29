# ReachInbox Email Scheduler

ReachInbox Email Scheduler is a TypeScript/Express API and React/Tailwind dashboard. PostgreSQL stores users, tenants, senders, and email records; BullMQ and Redis persist delayed work; the worker sends through Ethereal SMTP; Elasticsearch powers email search. Google OAuth authenticates users, while Slack OAuth connects a workspace for real hourly-limit alerts.

## Prerequisites

- Node.js 20 or newer and npm
- Docker Desktop (for PostgreSQL, Redis, and Elasticsearch)

## Setup

1. Copy `.env.example` to `.env` for Docker Compose, and to `backend/.env` for the backend and Prisma CLI. Adjust local values if needed.
2. Install workspace dependencies from the repository root:

   ```sh
   npm install
   ```

3. Start PostgreSQL, Redis, and Elasticsearch (Redis and Elasticsearch use named persistent volumes):

   ```sh
   docker compose up -d
   ```

4. Apply the Prisma migration from the repository root:

   ```sh
   npm run db:deploy --workspace backend
   ```

5. Build the backend and start the API, worker, and frontend in separate terminals:

   ```sh
   npm run build --workspace backend
   npm run dev --workspace backend
   npm run worker --workspace backend
   npm run dev --workspace frontend
   ```

The API listens on `http://localhost:3000`; `GET /health` returns `{"status":"ok"}`. The frontend is available at `http://localhost:5173`.

## Environment variables

Use the matching placeholders in `.env.example` and `backend/.env.example`. Configure `DATABASE_URL`, `REDIS_URL`, and `ELASTICSEARCH_URL` for the local services. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and `SMTP_FROM_NAME` for Ethereal delivery. Google login requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `SESSION_SECRET`. Slack connect/notifications require `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, and a persistent 64-hex-character `SLACK_TOKEN_ENCRYPTION_KEY`. `FRONTEND_URL` and `PORT` select the UI origin and API port. `WORKER_CONCURRENCY`, `MIN_EMAIL_DELAY_MS`, and `MAX_EMAILS_PER_HOUR_PER_SENDER` configure worker parallelism and shared sending limits. `BULL_BOARD_ADMIN_EMAIL` enables the read-only queue dashboard for one authenticated account. `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` configure the local Compose database. Do not commit `.env` files or real credentials.

## Google OAuth login

Create an OAuth client in Google Cloud Console with application type **Web application**. Add `http://localhost:3000/auth/google/callback` as an authorized redirect URI. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `backend/.env`. Set `SESSION_SECRET` to a private random string of at least 32 characters; `SESSION_TTL_SECONDS` defaults to 604800 (7 days). Do not commit real values.

Start the backend and frontend, then open `http://localhost:5173` and select **Continue with Google**. The backend keeps OAuth state in Redis for 10 minutes and consumes it once, exchanges the code server-side, and reads the verified Google profile from OpenID Connect UserInfo. User records are matched by Google subject; an existing email-only user can be linked if it has no Google subject. A conflicting linked Google identity is rejected. New users reuse the configured `SEARCH_TENANT_ID` tenant if it exists, otherwise the existing development tenant, or create `ReachInbox Development` when no tenant exists.

The backend stores an opaque session in Redis and sends a signed, HTTP-only, SameSite=Lax cookie; it is Secure in production. Google access tokens are not persisted. `GET /auth/me` returns the safe user profile and tenant, or `401 {"authenticated":false}` when signed out. `POST /auth/logout` invalidates the Redis session and clears the cookie. Dashboard, email, search, Slack connection, and queue-dashboard routes require the existing authenticated session; Bull Board also requires the configured admin email. `/health` and OAuth entry/callback routes are public by design.

Slack OAuth uses the signed-in user's identity and tenant. The OAuth state is stored in Redis for ten minutes and consumed once; Slack credentials and webhook details are encrypted before being stored in PostgreSQL. Rate-limit notifications use the connected tenant webhook and a Redis key to deduplicate notifications per sender and UTC hour.

## Database commands

Run from the repository root:

```sh
npm run db:validate --workspace backend
npm run db:generate --workspace backend
npm run db:migrate --workspace backend
npm run db:deploy --workspace backend
npm run db:studio --workspace backend
```

`db:migrate` creates/applies a development migration. `db:deploy` applies committed migrations in non-development environments. Prisma reads `DATABASE_URL` from `.env` (see `.env.example`).

## BullMQ scheduling

The `email-jobs` queue stores delayed BullMQ jobs in Redis. Its payload contains only the `EmailJob` ID. The worker loads the database row and checks the per-sender distributed send gate before atomically claiming it by changing `SCHEDULED` to `SENDING`, then sends it through Ethereal SMTP. A successful send changes the record to `SENT`; an SMTP/configuration error changes it to `FAILED`. Worker concurrency is set by `WORKER_CONCURRENCY` (default `5`). `REDIS_URL` configures the Redis connection.

## BullMQ queue dashboard

The live, read-only Bull Board UI is mounted at `http://localhost:3000/admin/queues`. It uses the existing `email-jobs` BullMQ queue and Redis connection, so it shows the real queue states and jobs. The dashboard is read-only; enqueueing, retrying, removing, promoting, pausing, and resuming jobs from the UI are disabled so queue actions cannot bypass the database status guard or sender rate-limit logic.

Set `BULL_BOARD_ADMIN_EMAIL` in `backend/.env` to the exact Google account email allowed to access the dashboard. The route requires the existing signed-in Google session and compares that session's database email with the configured admin email (case-insensitive). Unauthenticated requests receive `401`, authenticated non-admins receive `403`, and an unset admin email disables access with `503`. No default administrator is built into the code. Sign in through the frontend first, then open the **Queue Monitor** link in the sidebar; other signed-in users can see the link but receive `403`.

The dashboard uses Bull Board's Express adapter compatible with this Express 4 application and BullMQ v5. It formats displayed job payloads to expose only `emailJobId`, hides job return values, and does not display the Redis connection URL or credentials. Do not add secrets to BullMQ job payloads or logs.

The queue service is available to backend code as `scheduleEmailJob(emailJobId, scheduledAt)`. It checks that the database row exists, remains `SCHEDULED`, and has the same scheduled time before enqueueing. To verify it without a frontend/API route, create a valid `EmailJob` row (for example, using Prisma Studio), build the backend, then run:

```sh
npm run enqueue:email --workspace backend -- <emailJobId> <scheduledAt-ISO-8601>
```

BullMQ stores delayed jobs in Redis. Docker Compose enables Redis append-only persistence and a named data volume, so queued delayed jobs survive process restarts. The worker and API are separate processes; start the worker with `npm run worker --workspace backend` after building. No cron or in-memory interval scheduler is used.

## Per-sender send limits

`MIN_EMAIL_DELAY_MS` (default `2000`) and `MAX_EMAILS_PER_HOUR_PER_SENDER` (default `200`) control sending. A single atomic Redis Lua script coordinates each sender across all worker processes/instances. It uses fixed UTC hour windows, and stores sender-specific quota counters and the next permitted send time in namespaced Redis keys. The delay is measured between distributed send-slot reservations; in normal operation this spaces SMTP attempts by at least the configured interval. A slot remains consumed if SMTP fails or a database claim loses a race, favoring conservative throttling over exceeding a provider limit.

When a sender has no slot available, the active BullMQ job is moved back to the delayed set until the earliest permitted time. The same BullMQ job ID is retained, the EmailJob stays `SCHEDULED`, and no new duplicate queue job is added. A fixed-window quota resets at the next UTC hour. Concurrent jobs for one sender can be admitted in an order influenced by BullMQ scheduling; independent senders have independent counters and pacing. With 1000+ simultaneous jobs, Redis holds the durable jobs, `WORKER_CONCURRENCY` bounds active processing, the sender delay paces sends, and excess jobs remain delayed through the quota window rather than failing. Ordering is best-effort, not strict FIFO across concurrent workers.

For local verification, temporarily set `MIN_EMAIL_DELAY_MS=2000` and `MAX_EMAILS_PER_HOUR_PER_SENDER=2` in `backend/.env`, then restart the worker. Enqueue four fresh scheduled EmailJobs for one sender at about the same time. The first two should send; the remaining jobs should still show `SCHEDULED` and remain delayed in BullMQ until the next UTC hour. Check records in Prisma Studio and queue states with `npm run worker --workspace backend` logs or a BullMQ queue inspection. Use a second sender to confirm its sends are independent. Restore the intended values and restart the worker after the check. No test-only hour-window override is provided, so verifying the quota rollover requires waiting for the next UTC hour.

## Restart recovery and duplicate protection

No in-memory schedule is reconstructed at startup. A delayed job stays in BullMQ/Redis when the worker is stopped; a worker started later reconnects to the same `email-jobs` queue, and BullMQ makes jobs whose delay has elapsed processable. The existing Redis AOF setting and named volume preserve Redis queue data across container restarts. Do not remove the `redis_data` volume when restarting the stack.

The enqueue service assigns the stable BullMQ job ID `email-<EmailJob ID>` and refuses to enqueue database records that are not `SCHEDULED`. The PostgreSQL conditional update from `SCHEDULED` to `SENDING` is the final duplicate guard; processing an already `SENT`, `FAILED`, or `SENDING` record does not send it again. No database scan/re-enqueue loop or retry policy has been added.

### Manual restart checks

Use a fresh test EmailJob with a related sender and a scheduled time at least one minute in the future. Keep PostgreSQL and Redis running while restarting only the worker.

**Test A — restart before the scheduled time:** enqueue the record with `npm run enqueue:email --workspace backend -- <emailJobId> <scheduledAt-ISO-8601>`, then stop the worker with Ctrl+C. Confirm the delayed queue still contains a job:

```powershell
docker compose exec redis redis-cli ZCARD bull:email-jobs:delayed
```

Start the worker again with `npm run worker --workspace backend` before the scheduled time. At the scheduled time, confirm the database record becomes `SENT` with `sentAt` populated and inspect the Ethereal preview URL in the worker log.

**Test B — restart after the scheduled time:** enqueue another fresh record, keep the worker stopped until after its scheduled time, then start the worker. Do not enqueue it again. BullMQ should make the persisted delayed job processable, and the record should become `SENT`.

**Test C — repeated enqueue after success:** run the enqueue command again for a `SENT` EmailJob. The queue service should reject it because its database status is no longer `SCHEDULED`. For duplicate BullMQ delivery, the worker also checks the database status before sending and uses a conditional atomic claim.

### SMTP crash window

SMTP and PostgreSQL do not share a transaction. If the worker crashes after SMTP accepts a message but before PostgreSQL records `SENT`, the database remains `SENDING`. BullMQ may redeliver a stalled job, but the worker will skip `SENDING` and will not send again. This protects against a duplicate but leaves the final delivery outcome unknown; if the crash happened before SMTP accepted the message, it also means the message may not have been delivered. The implementation does not automatically reset or re-enqueue stale `SENDING` rows, because doing so could duplicate an email that Ethereal already accepted. Reconcile such a record against Ethereal before any manual reset.

## Ethereal SMTP verification

Set `SMTP_HOST=smtp.ethereal.email`, `SMTP_PORT=587`, `SMTP_USER`, and `SMTP_PASSWORD` in `backend/.env` using the credentials for your Ethereal test account. Port 587 uses STARTTLS; port 465 uses implicit TLS. SMTP configuration is checked when a job is about to send, so the worker can start before SMTP credentials are provided. `SMTP_FROM_EMAIL` and `SMTP_FROM_NAME` are optional fallbacks; the database `Sender.email` and `Sender.displayName` take precedence.

To send a test job, make sure PostgreSQL and Redis are running and the schema migration is applied. Create an `EmailJob` in `SCHEDULED` state with a related sender, a recipient address you can check in Ethereal, and a future `scheduledAt`. Then:

```sh
npm run build --workspace backend
npm run enqueue:email --workspace backend -- <emailJobId> <scheduledAt-ISO-8601>
npm run worker --workspace backend
```

The worker transitions the record through `SENDING` and then to `SENT` with `sentAt` on success. On an SMTP/configuration failure, it records `FAILED`, clears `sentAt`, and stores a sanitized failure message. The worker log includes the SMTP message ID and, when returned by Ethereal, a preview URL. SMTP credentials and password values are redacted from saved failure messages.

## Elasticsearch indexing and search

Docker Compose starts a single-node Elasticsearch 8.17.4 service at `http://localhost:9200`, with security disabled for local development and data in the `elasticsearch_data` named volume. Set `ELASTICSEARCH_URL` in `backend/.env` if it runs elsewhere. The backend uses the official Elasticsearch Node.js client and the `email-jobs` index. Index creation is idempotent; its mapping stores IDs/status as keywords, recipient email as text plus a keyword subfield, subject/body as searchable text, and timestamps as dates.

Search derives the tenant from the authenticated Redis session; it does not accept a tenant ID from the browser. With the API running and a Google session established:

```powershell
Invoke-RestMethod 'http://localhost:3000/emails/search?q=example.com&page=1&limit=20'
Invoke-RestMethod 'http://localhost:3000/emails/search?q=launch&status=SENT&limit=20'
```

`q` searches recipient email, subject, body, and status. Optional filters are `status` (`SCHEDULED`, `SENDING`, `SENT`, `FAILED`) and tenant-scoped `senderId`. Pagination defaults to page 1 / 20 records, caps `limit` at 100, and caps the searchable result window at 10,000 records.

When an EmailJob is enqueued, the service best-effort indexes its PostgreSQL row. The worker best-effort reindexes after the database records `SENT` or `FAILED`. Indexing errors are logged and do not alter PostgreSQL status or fail SMTP delivery. The index can lag PostgreSQL while Elasticsearch is unavailable; PostgreSQL remains authoritative. After Elasticsearch recovers, build and run this idempotent backfill (document IDs are EmailJob IDs, so repeated runs update documents):

```powershell
npm run build --workspace backend
npm run search:index --workspace backend
```

The backfill reads PostgreSQL in batches and does not modify database rows. EmailJobs inserted directly in PostgreSQL/Prisma Studio are indexed by this command. Reindex after a temporary Elasticsearch outage to repair missed updates.

## Slack OAuth and hourly-limit notifications

Configure these in `backend/.env`:

- `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` from the Slack app.
- `SLACK_REDIRECT_URI=http://localhost:3000/slack/oauth/callback` (add this exact redirect URL to the Slack app).
- `SLACK_TOKEN_ENCRYPTION_KEY`: a persistent 32-byte key encoded as 64 hex characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it private and back it up; changing it makes stored Slack credentials unreadable.

In Slack API settings, enable OAuth, register the callback URL above, and request the `incoming-webhook` scope. Slack will ask which channel receives the notification. OAuth state is generated randomly, stored one-time in Redis with a 10-minute expiry, and tied to the authenticated user/tenant. Access tokens and webhook URLs are AES-256-GCM encrypted in PostgreSQL.

Start the API and frontend, sign in, then use **Connect Slack** from the dashboard. Slack returns to `/slack/oauth/callback` and redirects to the dashboard; the dashboard reloads connection status from `/slack/status`. The authenticated `DELETE /slack/connection` endpoint removes the current user's stored connection. The dashboard provides **Disconnect** and **Reconnect workspace** actions; no credential is returned to the browser.

The worker sends a real incoming-webhook message only when Redis reports the sender's hourly quota is exhausted. Minimum-delay throttling does not notify. An atomic Redis `SET NX` key scoped by sender and UTC hour suppresses concurrent duplicate notifications; the key is not created when Slack is disconnected. After a webhook attempt the key is retained for that hour, including ambiguous failures, to avoid duplicate posts; a failed notification may therefore not be retried until a later UTC hour. Notification errors are logged without failing the email job. With the local test limit `MAX_EMAILS_PER_HOUR_PER_SENDER=2`, schedule at least four emails for one sender: after two sends, the third job triggers the Slack message and stays scheduled/delayed with subsequent excess jobs. Check the queue and database to verify they were retained.

## Build and type-check

```sh
npm run build
npm run typecheck
```

## Phase 2 data model

Prisma manages PostgreSQL schema through `backend/prisma/schema.prisma` and committed migrations under `backend/prisma/migrations/`. The models cover tenants, authenticated users, tenant senders, and scheduled/sent email records with tenant-scoped idempotency keys.

## Dashboard and batch scheduling

The React dashboard uses the current Google session for all email data. `GET /auth/me` supplies the account and workspace. Authenticated email APIs are:

- `GET /api/dashboard/overview` — PostgreSQL status counts, recent and upcoming email rows, Redis sender quota usage, and server rate-limit bounds.
- `GET /emails/senders` — senders in the authenticated tenant and the configured minimum delay/hourly ceiling.
- `GET /emails/scheduled` and `GET /emails/sent` — tenant-scoped paged records from PostgreSQL.
- `GET /emails/search?q=...` — Elasticsearch search filtered by the authenticated tenant.
- `POST /emails/schedule` — batch email creation and BullMQ enqueue.

The schedule request requires a UUID `Idempotency-Key` header and includes `senderId`, `recipients`, `subject`, `body`, ISO `startAt`, `delaySeconds`, and `hourlyLimit`. It accepts up to 5,000 valid unique recipients. The backend verifies the sender belongs to the session tenant, stores one `EmailJob` per recipient, spaces each requested `scheduledAt` by the selected delay, and uses the existing delayed queue service. Retries with the same key reuse the same recipient records and BullMQ job IDs. Reusing the key with changed content returns `409`. The configured `MIN_EMAIL_DELAY_MS` is a hard lower bound and `MAX_EMAILS_PER_HOUR_PER_SENDER` is a hard ceiling; UI campaign values cannot weaken either.

The chosen per-campaign delay and hourly cap are persisted on each email row. The Redis send gate continues to enforce the shared sender-wide configured cap, and it also tracks each batch/sender hourly cap, so concurrent workers coordinate both limits. When a campaign cap is reached, its remaining jobs stay delayed in BullMQ until the next UTC hour. When queueing fails after some records are committed, the API returns an error and the client may retry with the same idempotency key to finish enqueueing safely.

CSV/TXT parsing runs in the browser only to validate addresses, deduplicate them, and show counts; the file is not uploaded or sent. Only parsed email addresses and the message/schedule inputs are submitted to the authenticated API. The interface contains loading, empty, and error states and does not fabricate email, sender, capacity, or Slack data. The dashboard is responsive and uses a light editorial visual system; the provided Figma URL was not accessible to the implementation viewer.
