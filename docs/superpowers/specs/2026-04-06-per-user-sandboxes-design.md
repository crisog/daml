# Per-User Sandboxes via Cloudflare Containers

**Date:** 2026-04-06
**Status:** Draft

## Overview

Replace the single shared Canton sandbox with per-user dedicated sandboxes running as Cloudflare Containers. Each authenticated user gets their own isolated Canton sandbox instance with full lifecycle management. Access is gated behind Better Auth with a global capacity limit.

## Architecture

**Approach:** Coordinator DO + Container (two-layer)

```
┌─────────┐     ┌──────────────────────────────────────┐
│ Browser  │────▶│  Cloudflare Worker (TanStack Start)   │
└─────────┘     │                                        │
                │  - Serves frontend (React)              │
                │  - Better Auth (/api/auth/*)             │
                │  - Sandbox proxy (/api/v2/*, /compile)   │
                └──────┬────────────┬───────────────────┘
                       │            │
                  D1 + Drizzle   DO Namespace
                  (users, sessions)  │
                       │            ▼
                       │   ┌──────────────────┐
                       │   │  GatekeeperDO     │
                       │   │  (single global)  │
                       │   │  - Capacity gate   │
                       │   └──────────────────┘
                       │            │
                       │            ▼
                       │   ┌──────────────────┐
                       │   │  SessionDO        │
                       │   │  (per user)       │
                       │   │  - Tracks state   │
                       │   │  - Proxies reqs   │
                       │   │  - Usage metrics  │
                       │   └────────┬──────────┘
                       │            │
                       │            ▼
                       │   ┌──────────────────┐
                       │   │  SandboxContainer │
                       │   │  (per user)       │
                       │   │  Canton sandbox   │
                       │   │  + compile svc    │
                       │   └──────────────────┘
                       │
                       ▼
                ┌─────────────┐
                │  Cloudflare  │
                │  D1 (SQLite) │
                └─────────────┘
```

### Request flow

1. Browser sends request to Worker.
2. Worker checks auth via Better Auth session cookie.
3. For playground API routes (`/api/v2/*`, `/compile`), Worker calls `gatekeeper.acquire(userId)`.
4. If not granted, return 503 with "sandboxes at capacity" message.
5. If granted, Worker gets the user's Session DO stub via `env.SESSION.getByName(userId)`.
6. Session DO ensures the Container is running, proxies the request to `env.SANDBOX.getByName(userId)`.
7. Container forwards to Canton (port 7575) or compile service (port 8081) via the Go reverse proxy.
8. Response flows back the same path.

## Authentication Layer

### Stack

- **Better Auth** with `tanstackStartCookies()` plugin
- **Drizzle + D1** adapter for user/session storage
- **GitHub OAuth** as primary provider, email/password as fallback

### Auth configuration (`src/lib/auth.ts`)

- Better Auth instance with D1 adapter via Drizzle
- `tanstackStartCookies()` plugin (must be last in plugin array)
- GitHub OAuth provider configured via Worker secrets

### Route handler (`src/routes/api/auth/$.ts`)

- Catch-all route delegating GET and POST to `auth.handler(request)`

### Route protection

- Pathless layout route `_protected.tsx` wraps the playground
- `beforeLoad` calls `getSession()`, redirects to `/login` if unauthenticated
- Docs pages remain public, only the interactive playground requires auth

### Server functions (`src/lib/auth.functions.ts`)

- `getSession()`: returns session or null
- `ensureSession()`: returns session or throws

### D1 schema

- Better Auth default tables: `user`, `session`, `account`, `verification`
- No custom tables needed yet (billing deferred)

## Session Durable Object

One instance per authenticated user, addressed by `env.SESSION.getByName(userId)`. The DO name IS the userId, so the Session DO derives its user identity from `this.ctx.id` without needing it passed on each request.

### Responsibilities

- Track container state (stopped, starting, running, error)
- Proxy HTTP requests to the Container DO
- Record usage metadata in DO SQLite storage
- Handle container lifecycle: start on first request, restart on failure

### State (DO SQLite)

- `container_status`: enum (stopped, starting, running, error)
- `started_at`: timestamp of last container start
- `last_activity_at`: timestamp of last proxied request
- `request_count`: total requests proxied this session
- `error_log`: last error message if container failed

### RPC interface (called by Worker)

- `proxy(request: Request): Response` - main entry point. Starts container if needed, proxies request.
- `status(): { containerStatus, startedAt, lastActivityAt, requestCount }` - for UI status display.
- `stop(): void` - manual shutdown (for future admin/billing use).

### Container restart logic

1. Receive request from Worker.
2. If container not running, call `this.env.SANDBOX.getByName(userId).startAndWaitForPorts()`.
3. Update `container_status` to `running`, record `started_at`.
4. Proxy request to container via `containerStub.fetch(request)`.
5. Update `last_activity_at` on each request.
6. If proxy fails, update status to `error`, attempt one restart, return error to user if restart also fails.

### Idle timeout

The Container DO handles idle timeout via `sleepAfter`. The Session DO does not implement its own timer. When the container sleeps and a new request arrives, `proxy()` detects the stopped state and restarts it.

## Container Durable Object

Thin wrapper around the existing `sandbox/Dockerfile`.

### Configuration

- Extends `Container` from `@cloudflare/containers`
- `defaultPort: 8081` (Go compile service as single entry point)
- `sleepAfter: '5m'` (container sleeps after 5 minutes of no requests)
- Instance type: `standard-1` (4 GiB memory, 1/2 vCPU)

### Port routing

The container runs two services: Canton JSON API on port 7575 and compile service on port 8081. Cloudflare Containers only route to `defaultPort`.

Solution: modify the Go compile service (`sandbox/compile-service/main.go`) to reverse-proxy `/api/v2/*` requests to `localhost:7575`. This makes port 8081 the single entry point. The compile service already knows the Canton sandbox URL.

### Dockerfile

No changes to the existing multi-stage build. The image runs as-is inside a Cloudflare Container.

### Wrangler container config

```jsonc
"containers": [{
  "class_name": "SandboxContainer",
  "image": "./sandbox",
  "max_instances": 50,
  "instance_type": "standard-1"
}]
```

## Global Rate Limit (GatekeeperDO)

A single `GatekeeperDO` instance addressed by `env.GATEKEEPER.getByName("global")`.

### State (in-memory, backed by DO SQLite)

- `activeContainers: Map<string, { userId: string, startedAt: number }>` - tracks who has a running container
- `maxAllowed: number` - configurable cap, loaded from SQLite on init

### RPC interface

- `acquire(userId: string): { granted: boolean, position?: number }` - atomically check + increment. Returns `granted: false` with queue position if at capacity. Idempotent per userId (same user requesting twice does not consume a second slot).
- `release(userId: string): void` - decrement when container stops.
- `status(): { active: number, max: number }` - for admin/UI display.
- `setMax(n: number): void` - update cap at runtime.

### Integration

1. Worker authenticates user, calls `gatekeeper.acquire(userId)`.
2. If not granted, return 503 with capacity message.
3. If granted, proceed to Session DO.
4. When container stops (via `onStop` hook), Session DO calls `gatekeeper.release(userId)`.

### Reconciliation

A DO alarm runs every 10 minutes to cross-check the active map against actual container states, pruning stale entries from crashed containers that never called `release`.

## Frontend Changes

### Route restructuring

Current:
- `/` - playground

New:
- `/` - docs landing (public)
- `/login` - login page (public)
- `/_protected` - pathless layout with auth check
- `/_protected/playground` - interactive playground (auth required)
- `/docs/*` - content pages remain public

### Login page (`src/routes/login.tsx`)

- "Sign in with GitHub" button using `authClient.signIn.social({ provider: "github" })`
- Email/password form as secondary option
- Redirect to `/playground` on success
- Consistent with existing site design

### Sandbox loading state

- On playground load, call `Session DO status()` via a server function
- If container is stopped/starting, show "Starting your sandbox..." with a spinner
- Poll status every 2 seconds until running, then render the editor
- If container already running (returning user), render immediately

### Capacity handling

- If `gatekeeper.acquire()` returns `granted: false`, show: "All sandboxes are in use. Please try again in a few minutes."
- Display `active/max` count
- Auto-retry every 15 seconds with visible countdown

### No changes to

- Monaco editor, Daml parser, playground UI components, example files
- These all talk to the same `/api/v2/*` and `/compile` endpoints, just routed per-user now

## Wrangler Configuration

```jsonc
{
  "name": "daml-playground",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
  "routes": [{ "pattern": "daml.run/*", "zone_name": "daml.run" }],

  "d1_databases": [{
    "binding": "DB",
    "database_name": "daml-playground-db",
    "database_id": "<generated>"
  }],

  "containers": [{
    "class_name": "SandboxContainer",
    "image": "./sandbox",
    "max_instances": 50,
    "instance_type": "standard-1"
  }],

  "durable_objects": {
    "bindings": [
      { "name": "SESSION", "class_name": "SessionDO" },
      { "name": "SANDBOX", "class_name": "SandboxContainer" },
      { "name": "GATEKEEPER", "class_name": "GatekeeperDO" }
    ]
  },

  "migrations": [{
    "tag": "v1",
    "new_sqlite_classes": ["SessionDO", "SandboxContainer", "GatekeeperDO"]
  }]
}
```

## New Files

| File | Purpose |
|------|---------|
| `src/server/do/session-do.ts` | Session Durable Object class |
| `src/server/do/gatekeeper-do.ts` | Global rate limit DO class |
| `src/server/do/sandbox-container.ts` | Container class extending `Container` |
| `src/lib/auth.ts` | Better Auth config with D1 adapter |
| `src/lib/auth-client.ts` | Client-side auth helpers |
| `src/lib/auth.functions.ts` | Server functions (getSession, ensureSession) |
| `src/routes/api/auth/$.ts` | Auth catch-all route handler |
| `src/routes/login.tsx` | Login page |
| `src/routes/_protected.tsx` | Auth-gated layout |
| `src/routes/_protected/playground.tsx` | Playground (moved from index) |
| `src/db/schema.ts` | Drizzle schema for D1 |

## Dockerfile Change

Modify `sandbox/compile-service/main.go` to reverse-proxy `/api/v2/*` to `localhost:7575`, making port 8081 the single entry point for the container.

## CI/CD Changes (`.github/workflows/deploy-docs.yml`)

- Requires Docker in CI for `wrangler deploy` to build and push the container image
- Add D1 database creation step on first deploy
- Add Worker secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_SECRET`

## Environment Secrets (via `wrangler secret put`)

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `BETTER_AUTH_SECRET`

## Key Design Decisions

1. **Two-layer DO architecture** (Session DO + Container DO) over direct container access. Provides a coordination layer for state tracking, error recovery, and future billing hooks.
2. **Go reverse proxy** over adding nginx/Caddy to the container. Fewer processes, simpler image, the compile service already knows the sandbox URL.
3. **GatekeeperDO** over D1 counter. Single-threaded DO eliminates race conditions on capacity checks.
4. **`sleepAfter: '5m'`** delegates idle management to the platform. No custom timers.
5. **`standard-1` instance type** (4 GiB) provides headroom over the observed 1.6 GiB baseline for JVM compilation spikes.
6. **No free tier.** All playground access requires authentication.
7. **Billing deferred.** Auth gates access; payment integration is a separate future effort.

## Open Questions

- Exact cold start time for the sandbox container (JVM boot + Canton init). May be 20-30 seconds. Need to measure and determine if a "warming" UX is sufficient or if pre-warming strategies are needed.
- GitHub OAuth app registration details (callback URL, scopes).
- Whether `max_instances: 50` is the right starting cap.
