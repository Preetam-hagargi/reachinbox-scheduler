# ReachInbox Full-Stack Email Job Scheduler

## Assignment scope

Build a production-grade email scheduler service and dashboard that accepts email scheduling requests through an API, stores them durably, sends them at the requested times through Ethereal Email SMTP, and lets authenticated users view scheduled and sent emails. Scheduled and sent emails must be searchable through Elasticsearch. The dashboard must support Google login and connecting Slack for rate-limit notifications.

Match the provided Figma design closely. No Figma URL or assets were included in the supplied specification; use any subsequently provided design reference before building the frontend.

## Required technologies

- **Backend:** Node.js, TypeScript, Express.js.
- **Frontend:** React.js, TypeScript, Tailwind CSS.
- **Relational persistence:** PostgreSQL.
- **Queue and scheduling:** BullMQ with Redis, using delayed jobs.
- **Email search/indexing:** Elasticsearch.
- **SMTP:** Ethereal Email.
- **Authentication:** real Google OAuth.
- **Notifications:** real Slack OAuth and Slack messages when a sender's hourly limit is reached.
- Redis and PostgreSQL may be run with Docker; Docker is recommended, not mandatory.

Use PostgreSQL (not MySQL) and React (not Next.js) as this project's concrete choices. Choose an ORM/query builder and other implementation details simply and only as needed to satisfy the specification.

## Non-negotiable constraints

- Absolutely no cron scheduling: no OS cron, Node cron library, `agenda`, or equivalent cron mechanism.
- Use BullMQ delayed jobs backed by Redis for scheduled email delivery.
- Persist job/email state in PostgreSQL and queue state in Redis so restarts retain future work and state.
- Ensure duplicate queue deliveries, retries, and concurrent workers do not send the same email more than once. Use durable idempotency state around sending.
- Use Ethereal Email SMTP to send emails from multiple senders.
- Use Elasticsearch to index emails and provide search over scheduled and sent emails.
- Implement real Google OAuth and real Slack OAuth; do not replace either with mocks.
- On an hourly limit hit, retain and reschedule/delay jobs into the next available hour window; do not drop them or permanently fail them.
- Rate-limit coordination must use Redis or PostgreSQL-backed shared state, never only process memory.
- When Slack is not connected, a rate-limit event must not crash processing. A later Slack connection must enable notifications without redeployment.
- Do not add product features beyond the supplied assignment without explicit direction.

## Backend requirements

- Provide an Express API to schedule emails and serve the dashboard's required data.
- Persist email recipients, subject/body, sender association, requested/scheduled times, status, and sent/failed details as needed to support the required flows and idempotency.
- Accept multiple senders. Store/configure sender details safely and use Ethereal SMTP for delivery.
- Enqueue schedule requests as BullMQ delayed jobs in Redis.
- Implement workers that deliver emails at their scheduled time and persist status transitions and outcomes.
- Expose a live BullMQ dashboard for real-time queue visibility.
- Implement real Google OAuth login; return the user's name, email, and avatar to the UI, maintain an authenticated session, and support logout.
- Implement Slack OAuth's dashboard connection flow; persist the authorized token or webhook per user/tenant and support disconnect/reconnect.
- Send an actual Slack message when a sender's hourly limit is reached. If no Slack connection exists, skip notification safely; use newly connected credentials without redeployment.
- Index scheduled and sent emails in Elasticsearch and expose email search backed by that index.
- Document configuration and operational behavior in README, including the selected minimum inter-send delay and hourly limit enforcement/trade-offs.

## Frontend requirements

- Build a React, TypeScript, Tailwind dashboard that closely follows the supplied Figma design.
- Implement real Google login. After login, redirect to the dashboard. Show the user's name, email, and avatar in the header and provide logout.
- Provide Scheduled Emails and Sent Emails sections/tabs and a primary Compose New Email action.
- Compose form fields: subject, body, CSV/text lead file upload, detected email-address count, start time, delay between emails, hourly limit, and Schedule action calling the backend API.
- Scheduled list/table columns: email, subject, scheduled time, status.
- Sent list/table columns: email, subject, sent time, status (`sent` or `failed`).
- Include loading and empty states and basic error messages/toasts.
- Use reusable UI components and TypeScript types/interfaces for component props and API responses; avoid duplicated UI logic.
- Provide an email search interface backed by the required Elasticsearch API/index.
- Provide Connect Slack and disconnect/reconnect UI for the real Slack OAuth flow.

## Rate limiting and concurrency requirements

- Configure BullMQ worker concurrency through environment/configuration; ensure parallel job processing is safe.
- Enforce a configurable minimum delay between individual sends to mimic provider throttling. The exact value is a configuration/documentation choice; document the chosen default and allow configuration.
- Enforce a configurable emails-per-hour limit, globally or per sender/tenant. Because multiple senders are required, prefer per-sender limits unless the detailed design establishes a suitable tenant scope.
- Store counters/coordination in Redis or PostgreSQL so limits remain correct across workers and instances.
- When a sender reaches the hourly limit, leave affected jobs durable and reschedule them into the next available hour window, preserving order as much as practical.
- Trigger a real Slack notification at the point the hourly sender limit is reached; avoid repeated noisy notifications for every deferred job in the same limit event/window.
- Define and document behavior under load, including worker concurrency, delay, hourly window accounting, and ordering trade-offs.

## Persistence and idempotency requirements

- PostgreSQL is the durable source of truth for emails, user/integration data, and delivery outcomes.
- Redis/BullMQ must retain delayed jobs across API/worker restarts; startup/recovery must not rebuild the queue in a way that duplicates or loses work.
- Persist a stable unique identifier/idempotency key for each scheduled email and enforce uniqueness durably.
- Make send processing safe under retries, restarts, and concurrent workers. Record a durable sending/sent state and coordinate the SMTP side effect so an already-sent message is not sent again.
- Store final `sent` or `failed` outcomes and timestamps for the dashboard.

## Elasticsearch requirement

- Index scheduled and sent email records in Elasticsearch so the records are searchable.
- Keep PostgreSQL authoritative; treat Elasticsearch as a search index and define how records are indexed/updated as email status changes and how index failures are retried or repaired.
- The dashboard search capability must call the backend and return Elasticsearch-backed results.

## Google OAuth requirement

- Implement an actual Google OAuth authorization flow, with server-side validation/callback handling.
- Establish the authenticated user session needed by dashboard APIs, return name/email/avatar, redirect to the dashboard after login, and provide logout.
- Configure client credentials and callback URLs outside source code.

## Slack OAuth and notification requirement

- Implement an actual Slack OAuth authorize/callback flow initiated by Connect Slack in the dashboard.
- Persist per-user or per-tenant Slack authorization details securely and support disconnect/reconnect.
- When a sender's hourly limit is reached, send a verifiable Slack message through the real Slack integration. Do not count a log entry as a notification.
- Missing Slack authorization is a normal optional state and must not fail email scheduling or sending. New connections should work without restarting/redeploying the app.

## 1000+ scheduled emails behavior

- Support 1000 or more emails scheduled for approximately the same time without loading all work into a single in-memory timer/list.
- Store each email durably and represent each scheduled send as persistent BullMQ/Redis work, with configurable worker concurrency.
- Process work in bounded parallelism and enforce the minimum inter-send delay and shared hourly quota. If the quota is exhausted, delay/reschedule excess jobs to the next available window without losing jobs or permanently failing them.
- Preserve per-sender order as much as practical while allowing independent senders to progress. Keep dashboard state and queue visibility useful during a large backlog.
- Document that the system handles the workload through durable queued jobs and throttled workers; the assignment does not require actually sending thousands of test emails through Ethereal.

## Proposed project structure

```text
.
├── AGENTS.md
├── README.md
├── .env.example
├── docker-compose.yml
├── package.json
├── backend/
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── config/
│   │   ├── db/
│   │   ├── routes/
│   │   ├── middleware/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── emails/
│   │   │   ├── slack/
│   │   │   └── search/
│   │   ├── queue/
│   │   ├── workers/
│   │   ├── integrations/
│   │   │   ├── elasticsearch/
│   │   │   └── ethereal/
│   │   └── dashboard/
│   └── migrations/
└── frontend/
    ├── src/
    │   ├── app/
    │   ├── components/
    │   ├── features/
    │   │   ├── auth/
    │   │   ├── compose/
    │   │   ├── scheduled-emails/
    │   │   ├── sent-emails/
    │   │   ├── search/
    │   │   └── slack/
    │   ├── lib/
    │   └── types/
    └── ...
```

Keep this architecture as a simple single backend API plus worker process and React dashboard. Share a backend codebase/configuration between API and worker entry points. Do not create unnecessary services or packages.

## Proposed implementation roadmap

1. Translate the assignment/Figma into acceptance criteria and document environment configuration; establish the simple backend/frontend workspace and local service configuration.
2. Implement PostgreSQL schema/migrations and Express API foundations, including Google OAuth/session and email scheduling/list endpoints.
3. Add Redis/BullMQ delayed scheduling, durable worker processing, idempotency, configurable concurrency, minimum delay, and shared hourly rate limiting/rescheduling.
4. Integrate Ethereal SMTP and real Slack OAuth/notifications; add Elasticsearch indexing and search plus the live BullMQ dashboard.
5. Build the React/Tailwind Google login, dashboard, compose/file parsing, scheduled/sent lists, search, and Slack connection flows to match Figma.
6. Document setup, environment variables, delay and rate limit behavior, 1000+ backlog behavior, restart recovery, idempotency, and integration verification.

## Development guardrails

- This document describes the assignment and proposed structure. Do not implement application code, create application folders, or install dependencies until the user explicitly approves moving to implementation.
- Do not introduce features outside the assignment scope.
