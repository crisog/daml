# Per-User Sandboxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each authenticated user their own isolated Canton sandbox running as a Cloudflare Container, coordinated by Durable Objects, with auth via Better Auth and data in D1.

**Architecture:** Two-layer DO design. A Worker (TanStack Start) authenticates via Better Auth, checks capacity with a global GatekeeperDO, then proxies sandbox requests through a per-user SessionDO to a per-user SandboxContainer. D1 via Drizzle stores auth data.

**Tech Stack:** TanStack Start, Better Auth, Drizzle ORM, Cloudflare D1, Cloudflare Containers, Cloudflare Durable Objects, Go (compile service reverse proxy)

---

## File Structure

```
src/
  db/
    schema.ts                    # Drizzle schema for Better Auth tables
  lib/
    auth.ts                      # Better Auth server config (D1 adapter, providers)
    auth-client.ts               # Better Auth client SDK instance
    auth.functions.ts            # Server functions: getSession, ensureSession
    playground/
      canton.ts                  # (modify) Remove hardcoded userId, accept base URL
      compiler.ts                # (no changes)
      types.ts                   # (no changes)
  server/
    do/
      gatekeeper-do.ts           # Global rate limit Durable Object
      session-do.ts              # Per-user session coordinator DO
      sandbox-container.ts       # Container class wrapping the sandbox image
  routes/
    __root.tsx                   # (no changes)
    index.lazy.tsx               # (modify) Redirect to /docs or /playground
    login.tsx                    # Login page with GitHub OAuth + email/password
    _protected.tsx               # Auth-gated pathless layout
    _protected/
      playground.tsx             # Playground moved here, with loading/capacity UI
    api/
      auth/
        $.ts                     # Better Auth catch-all handler
      sandbox/
        $.ts                     # Sandbox proxy route (Worker -> SessionDO)
sandbox/
  compile-service/
    main.go                      # (modify) Add reverse proxy for /api/v2/*
wrangler.jsonc                   # (modify) Add D1, DOs, Containers config
.github/workflows/
  deploy-docs.yml                # (modify) Add Docker, D1 setup, secrets
```

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Better Auth, Drizzle, and Cloudflare Containers packages**

```bash
cd /Users/crisog/Code/Canton/daml-playground
npm install better-auth drizzle-orm @cloudflare/containers
npm install -D drizzle-kit
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/crisog/Code/Canton/daml-playground
node -e "require('better-auth'); console.log('better-auth OK')"
node -e "require('drizzle-orm'); console.log('drizzle-orm OK')"
```

Expected: Both print OK.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add better-auth, drizzle-orm, cloudflare containers deps"
```

---

### Task 2: D1 database schema with Drizzle

**Files:**
- Create: `src/db/schema.ts`

- [ ] **Step 1: Create the Drizzle schema for Better Auth tables**

Create `src/db/schema.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: add drizzle schema for better-auth D1 tables"
```

---

### Task 3: Better Auth server configuration

**Files:**
- Create: `src/lib/auth.ts`

- [ ] **Step 1: Create the Better Auth server instance**

Create `src/lib/auth.ts`:

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

export function createAuth(d1: D1Database) {
  const db = drizzle(d1, { schema });

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
    },
    plugins: [tanstackStartCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

Note: `createAuth` is a factory that takes the D1 binding because Cloudflare Workers provide bindings at runtime, not at module scope. The Worker's `env.DB` is passed in at request time.

- [ ] **Step 2: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat: add better-auth server config with D1 adapter"
```

---

### Task 4: Better Auth client SDK

**Files:**
- Create: `src/lib/auth-client.ts`

- [ ] **Step 1: Create the client-side auth helper**

Create `src/lib/auth-client.ts`:

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "",
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/auth-client.ts
git commit -m "feat: add better-auth client SDK"
```

---

### Task 5: Auth server functions

**Files:**
- Create: `src/lib/auth.functions.ts`

- [ ] **Step 1: Create getSession and ensureSession server functions**

Create `src/lib/auth.functions.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { createAuth } from "@/lib/auth";
import { getCloudflareContext } from "@cloudflare/vite-plugin/context";

export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const { env } = await getCloudflareContext();
    const auth = createAuth(env.DB);
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    return session;
  }
);

export const ensureSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const { env } = await getCloudflareContext();
    const auth = createAuth(env.DB);
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });

    if (!session) {
      throw new Error("Unauthorized");
    }

    return session;
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/auth.functions.ts
git commit -m "feat: add getSession/ensureSession server functions"
```

---

### Task 6: Auth route handler

**Files:**
- Create: `src/routes/api/auth/$.ts`

- [ ] **Step 1: Create the catch-all auth route**

Create `src/routes/api/auth/$.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "@/lib/auth";
import { getCloudflareContext } from "@cloudflare/vite-plugin/context";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { env } = await getCloudflareContext();
        const auth = createAuth(env.DB);
        return auth.handler(request);
      },
      POST: async ({ request }: { request: Request }) => {
        const { env } = await getCloudflareContext();
        const auth = createAuth(env.DB);
        return auth.handler(request);
      },
    },
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/auth/$.ts
git commit -m "feat: add better-auth catch-all route handler"
```

---

### Task 7: Login page

**Files:**
- Create: `src/routes/login.tsx`

- [ ] **Step 1: Create the login page**

Create `src/routes/login.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGitHub = async () => {
    setLoading(true);
    setError(null);
    await authClient.signIn.social({
      provider: "github",
      callbackURL: "/playground",
    });
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: authError } = await authClient.signIn.email({
      email,
      password,
    });

    if (authError) {
      setError(authError.message ?? "Sign in failed");
      setLoading(false);
      return;
    }

    navigate({ to: "/playground" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page text-ink">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-stone bg-surface p-8">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-accent">Daml Playground</h1>
          <p className="mt-1 text-sm text-ink-muted">Sign in to access your sandbox</p>
        </div>

        <button
          type="button"
          onClick={handleGitHub}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-stone bg-page px-4 py-2 text-sm font-medium text-ink hover:bg-stone/30 disabled:opacity-50"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          Sign in with GitHub
        </button>

        <div className="flex items-center gap-3 text-xs text-ink-muted">
          <div className="h-px flex-1 bg-stone" />
          or
          <div className="h-px flex-1 bg-stone" />
        </div>

        <form onSubmit={handleEmailSignIn} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-md border border-stone bg-page px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-md border border-stone bg-page px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            Sign in with Email
          </button>
        </form>

        {error && (
          <p className="text-center text-xs text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/login.tsx
git commit -m "feat: add login page with GitHub OAuth and email/password"
```

---

### Task 8: Protected layout route

**Files:**
- Create: `src/routes/_protected.tsx`

- [ ] **Step 1: Create the auth-gated pathless layout**

Create `src/routes/_protected.tsx`:

```tsx
import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getSession } from "@/lib/auth.functions";

export const Route = createFileRoute("/_protected")({
  beforeLoad: async ({ location }) => {
    const session = await getSession();

    if (!session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }

    return { user: session.user };
  },
  component: () => <Outlet />,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/_protected.tsx
git commit -m "feat: add auth-gated layout route"
```

---

### Task 9: Move playground to protected route

**Files:**
- Create: `src/routes/_protected/playground.tsx`
- Modify: `src/routes/index.lazy.tsx`

- [ ] **Step 1: Create the protected playground route**

Create `src/routes/_protected/playground.tsx` with the full playground UI. This is the existing `PlaygroundPage` component moved into the protected layout, with a sandbox status wrapper added:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { PartyPanel } from "@/components/playground/party-panel";
import { ContractList } from "@/components/playground/contract-list";
import { CreateForm } from "@/components/playground/create-form";
import { CompileStatus } from "@/components/playground/compile-status";
import { Console, type ConsoleHandle } from "@/components/playground/console";
import { DamlEditor } from "@/editor/daml-editor";
import { ExamplePicker } from "@/components/playground/example-picker";
import { parseDamlSource } from "@/lib/playground/daml-parser";
import { EXAMPLES } from "@/lib/playground/examples";
import type { Party } from "@/lib/playground/types";
import { SandboxLoader } from "@/components/playground/sandbox-loader";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_protected/playground")({
  component: PlaygroundPage,
});

function PlaygroundPage() {
  const { user } = Route.useRouteContext();
  const [parties, setParties] = useState<Party[]>([]);
  const [activeParty, setActiveParty] = useState<Party | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [source, setSource] = useState(EXAMPLES[0]?.source ?? "");
  const [deployed, setDeployed] = useState(false);
  const consoleRef = useRef<ConsoleHandle>(null);

  const templates = useMemo(() => parseDamlSource(source), [source]);

  const handleSignOut = async () => {
    await authClient.signOut();
    window.location.href = "/login";
  };

  return (
    <SandboxLoader>
      <div className="flex h-screen flex-col bg-page text-ink">
        <header className="flex items-center gap-4 border-b border-stone bg-surface px-4 py-2">
          <h1 className="text-sm font-medium text-accent">Daml Playground</h1>
          <CompileStatus
            getSource={() => ({ "Main.daml": source })}
            onSuccess={() => {
              setDeployed(true);
              const names = templates.map((t) => t.name).join(", ");
              consoleRef.current?.success(`Deployed: ${names}`);
            }}
            onError={(err) => {
              consoleRef.current?.error(`Deploy failed: ${err}`);
            }}
          />
          <ExamplePicker
            onSelect={(src, name) => {
              setSource(src);
              setDeployed(false);
              consoleRef.current?.info(`Loaded example: ${name}`);
            }}
          />
          <span className="ml-auto flex items-center gap-3 text-xs text-ink-muted">
            {activeParty && <>Viewing as {activeParty.displayName}</>}
            <span>{user.name}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-ink-muted hover:text-ink"
            >
              Sign out
            </button>
          </span>
        </header>

        <div className="flex flex-1 overflow-hidden border-b border-stone">
          <div className="flex-1 border-r border-stone">
            <DamlEditor value={source} onChange={setSource} />
          </div>

          <div className="flex w-80 flex-col overflow-y-auto bg-surface">
            <PartyPanel
              parties={parties}
              activeParty={activeParty}
              onPartyCreated={(p) => {
                setParties((prev) => [...prev, p]);
                if (!activeParty) setActiveParty(p);
                consoleRef.current?.info(`Party created: ${p.displayName}`);
              }}
              onPartySelected={setActiveParty}
            />

            {!deployed && (
              <p className="p-3 text-xs text-ink-muted">
                Deploy your contract and create parties to get started
              </p>
            )}

            {deployed && parties.length > 0 && (
              <CreateForm
                templates={templates}
                parties={parties}
                onSuccess={(templateName) => {
                  setRefreshKey((k) => k + 1);
                  consoleRef.current?.success(
                    `Contract created: ${templateName}`
                  );
                }}
                onError={(err) => {
                  consoleRef.current?.error(err);
                }}
              />
            )}

            <ContractList
              partyId={activeParty?.id ?? null}
              refreshKey={refreshKey}
              templates={templates}
              parties={parties}
              onExercised={() => setRefreshKey((k) => k + 1)}
              onLog={(type, msg) => {
                if (type === "success") consoleRef.current?.success(msg);
                else consoleRef.current?.error(msg);
              }}
            />
          </div>
        </div>

        <div className="h-56 shrink-0 border-t border-stone-strong">
          <Console ref={consoleRef} />
        </div>
      </div>
    </SandboxLoader>
  );
}
```

- [ ] **Step 2: Update the index route to redirect**

Replace the contents of `src/routes/index.lazy.tsx` with a redirect to docs:

```tsx
import { createLazyFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createLazyFileRoute("/")({
  component: () => <Navigate to="/docs" />,
});
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/_protected/playground.tsx src/routes/index.lazy.tsx
git commit -m "feat: move playground behind auth, redirect index to docs"
```

---

### Task 10: Sandbox loader component

**Files:**
- Create: `src/components/playground/sandbox-loader.tsx`

- [ ] **Step 1: Create the sandbox loader component**

This component wraps the playground. It calls a server function to ensure the sandbox container is running before rendering children. It also handles the capacity-full case.

Create `src/components/playground/sandbox-loader.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { getSandboxStatus } from "@/lib/sandbox.functions";

type SandboxState =
  | { kind: "loading" }
  | { kind: "starting"; message: string }
  | { kind: "ready" }
  | { kind: "at-capacity"; active: number; max: number }
  | { kind: "error"; message: string };

export function SandboxLoader({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SandboxState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const status = await getSandboxStatus();

        if (cancelled) return;

        if (status.kind === "ready") {
          setState({ kind: "ready" });
          return;
        }

        if (status.kind === "at-capacity") {
          setState({
            kind: "at-capacity",
            active: status.active,
            max: status.max,
          });
          setTimeout(poll, 15_000);
          return;
        }

        if (status.kind === "starting") {
          setState({ kind: "starting", message: status.message });
          setTimeout(poll, 2_000);
          return;
        }

        setState({ kind: "error", message: status.message ?? "Unknown error" });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Failed to reach sandbox",
          });
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "ready") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page text-ink">
      <div className="max-w-sm space-y-4 text-center">
        {state.kind === "loading" && (
          <p className="text-sm text-ink-muted">Connecting to sandbox...</p>
        )}

        {state.kind === "starting" && (
          <>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-stone border-t-accent" />
            <p className="text-sm text-ink-muted">{state.message}</p>
          </>
        )}

        {state.kind === "at-capacity" && (
          <>
            <p className="text-sm font-medium text-ink">
              All sandboxes are in use
            </p>
            <p className="text-xs text-ink-muted">
              {state.active}/{state.max} active. Retrying automatically...
            </p>
          </>
        )}

        {state.kind === "error" && (
          <>
            <p className="text-sm font-medium text-red-400">
              Sandbox error
            </p>
            <p className="text-xs text-ink-muted">{state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-stone px-3 py-1 text-xs text-ink hover:bg-stone/30"
            >
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/playground/sandbox-loader.tsx
git commit -m "feat: add sandbox loader component with capacity/loading states"
```

---

### Task 11: Sandbox server functions

**Files:**
- Create: `src/lib/sandbox.functions.ts`

- [ ] **Step 1: Create the sandbox status server function**

This server function calls the Session DO to check/start the sandbox, gated by the Gatekeeper.

Create `src/lib/sandbox.functions.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { getCloudflareContext } from "@cloudflare/vite-plugin/context";
import { ensureSession } from "@/lib/auth.functions";

type SandboxStatus =
  | { kind: "ready" }
  | { kind: "starting"; message: string }
  | { kind: "at-capacity"; active: number; max: number }
  | { kind: "error"; message: string };

export const getSandboxStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SandboxStatus> => {
    const session = await ensureSession();
    const userId = session.user.id;
    const { env } = await getCloudflareContext();

    // Check capacity
    const gatekeeper = env.GATEKEEPER.getByName("global");
    const capacity = await gatekeeper.acquire(userId);

    if (!capacity.granted) {
      return {
        kind: "at-capacity",
        active: capacity.active,
        max: capacity.max,
      };
    }

    // Get sandbox status via Session DO
    const sessionDO = env.SESSION.getByName(userId);
    const status = await sessionDO.status();

    if (status.containerStatus === "running") {
      return { kind: "ready" };
    }

    if (status.containerStatus === "starting") {
      return { kind: "starting", message: "Starting your sandbox..." };
    }

    if (status.containerStatus === "error") {
      return { kind: "error", message: status.errorLog ?? "Container failed" };
    }

    // Container is stopped, trigger start
    await sessionDO.start();
    return { kind: "starting", message: "Starting your sandbox..." };
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/sandbox.functions.ts
git commit -m "feat: add sandbox status server function with gatekeeper check"
```

---

### Task 12: Sandbox API proxy route

**Files:**
- Create: `src/routes/api/sandbox/$.ts`

- [ ] **Step 1: Create the sandbox proxy route**

This route proxies `/api/sandbox/*` requests through the Session DO to the user's container. The frontend's `canton.ts` will be updated to use `/api/sandbox` as the base path.

Create `src/routes/api/sandbox/$.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { getCloudflareContext } from "@cloudflare/vite-plugin/context";
import { createAuth } from "@/lib/auth";

async function proxyToSandbox(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext();
  const auth = createAuth(env.DB);
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const sessionDO = env.SESSION.getByName(userId);

  // Rewrite the URL: /api/sandbox/v2/parties -> /v2/parties
  const url = new URL(request.url);
  const sandboxPath = url.pathname.replace(/^\/api\/sandbox/, "");
  const sandboxUrl = new URL(sandboxPath, "http://container");
  sandboxUrl.search = url.search;

  const proxyRequest = new Request(sandboxUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  return sessionDO.proxy(proxyRequest);
}

export const Route = createFileRoute("/api/sandbox/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        proxyToSandbox(request),
      POST: async ({ request }: { request: Request }) =>
        proxyToSandbox(request),
      PUT: async ({ request }: { request: Request }) =>
        proxyToSandbox(request),
      DELETE: async ({ request }: { request: Request }) =>
        proxyToSandbox(request),
    },
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/sandbox/$.ts
git commit -m "feat: add sandbox API proxy route through Session DO"
```

---

### Task 13: Update frontend API paths

**Files:**
- Modify: `src/lib/playground/canton.ts`
- Modify: `src/lib/playground/compiler.ts`

- [ ] **Step 1: Update canton.ts to use /api/sandbox prefix**

In `src/lib/playground/canton.ts`, change the API base path from `/api` to `/api/sandbox`:

Change line 3:
```ts
const API = '/api/sandbox'
```

Also change the hardcoded `userId` on lines 52 and 76 to omit it (the server identifies the user via session cookie):

Remove `userId: 'playground-user'` from the `submitCreate` body (line 52) and the `submitExercise` body (line 76). The Canton JSON API does not require a userId when submitted through the proxy.

Actually, Canton's JSON API v2 requires `userId` in commands. The Session DO should inject this. For now, keep `userId` but make it dynamic. Change lines 46-53 to:

```ts
    body: JSON.stringify({
      commands: [{ CreateCommand: { templateId, createArguments } }],
      actAs,
      readAs: actAs,
      commandId: nextCommandId(),
    }),
```

And lines 68-75 similarly:

```ts
    body: JSON.stringify({
      commands: [{ ExerciseCommand: { templateId, contractId, choice, choiceArgument } }],
      actAs,
      readAs: actAs,
      commandId: nextCommandId(),
    }),
```

Note: The Session DO proxy will inject the `userId` field before forwarding to Canton if needed. For the initial implementation, Canton sandbox mode does not enforce userId.

- [ ] **Step 2: Update compiler.ts to use /api/sandbox prefix**

In `src/lib/playground/compiler.ts`, change the fetch URL on line 4:

```ts
  const res = await fetch('/api/sandbox/compile', {
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/playground/canton.ts src/lib/playground/compiler.ts
git commit -m "feat: update frontend API paths to /api/sandbox proxy"
```

---

### Task 14: GatekeeperDO

**Files:**
- Create: `src/server/do/gatekeeper-do.ts`

- [ ] **Step 1: Create the Gatekeeper Durable Object**

Create `src/server/do/gatekeeper-do.ts`:

```ts
import { DurableObject } from "cloudflare:workers";

const DEFAULT_MAX = 50;
const RECONCILE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface ActiveEntry {
  userId: string;
  startedAt: number;
}

export class GatekeeperDO extends DurableObject {
  private activeContainers: Map<string, ActiveEntry> = new Map();
  private maxAllowed: number = DEFAULT_MAX;
  private initialized = false;

  private async ensureInitialized() {
    if (this.initialized) return;

    const stored = await this.ctx.storage.get<number>("maxAllowed");
    if (stored !== undefined) {
      this.maxAllowed = stored;
    }

    const entries =
      await this.ctx.storage.get<[string, ActiveEntry][]>("activeEntries");
    if (entries) {
      this.activeContainers = new Map(entries);
    }

    // Schedule reconciliation alarm
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + RECONCILE_INTERVAL_MS);
    }

    this.initialized = true;
  }

  private async persistActive() {
    await this.ctx.storage.put(
      "activeEntries",
      Array.from(this.activeContainers.entries())
    );
  }

  async acquire(
    userId: string
  ): Promise<{ granted: boolean; active: number; max: number }> {
    await this.ensureInitialized();

    // Idempotent: if user already has a slot, grant without incrementing
    if (this.activeContainers.has(userId)) {
      return {
        granted: true,
        active: this.activeContainers.size,
        max: this.maxAllowed,
      };
    }

    if (this.activeContainers.size >= this.maxAllowed) {
      return {
        granted: false,
        active: this.activeContainers.size,
        max: this.maxAllowed,
      };
    }

    this.activeContainers.set(userId, {
      userId,
      startedAt: Date.now(),
    });
    await this.persistActive();

    return {
      granted: true,
      active: this.activeContainers.size,
      max: this.maxAllowed,
    };
  }

  async release(userId: string): Promise<void> {
    await this.ensureInitialized();
    this.activeContainers.delete(userId);
    await this.persistActive();
  }

  async status(): Promise<{ active: number; max: number }> {
    await this.ensureInitialized();
    return {
      active: this.activeContainers.size,
      max: this.maxAllowed,
    };
  }

  async setMax(n: number): Promise<void> {
    await this.ensureInitialized();
    this.maxAllowed = n;
    await this.ctx.storage.put("maxAllowed", n);
  }

  async alarm() {
    await this.ensureInitialized();

    // Prune entries older than 1 hour (safety net for missed releases)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let pruned = false;
    for (const [userId, entry] of this.activeContainers) {
      if (entry.startedAt < oneHourAgo) {
        this.activeContainers.delete(userId);
        pruned = true;
      }
    }
    if (pruned) {
      await this.persistActive();
    }

    // Reschedule
    await this.ctx.storage.setAlarm(Date.now() + RECONCILE_INTERVAL_MS);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/do/gatekeeper-do.ts
git commit -m "feat: add GatekeeperDO for global sandbox capacity management"
```

---

### Task 15: SandboxContainer DO

**Files:**
- Create: `src/server/do/sandbox-container.ts`

- [ ] **Step 1: Create the Container Durable Object**

Create `src/server/do/sandbox-container.ts`:

```ts
import { Container } from "@cloudflare/containers";

export class SandboxContainer extends Container {
  defaultPort = 8081;
  sleepAfter = "5m";

  override onStart(): void {
    console.log(`Sandbox container started: ${this.ctx.id}`);
  }

  override onStop(stopParams: { exitCode: number; reason: string }): void {
    console.log(
      `Sandbox container stopped: ${this.ctx.id}, exit=${stopParams.exitCode}, reason=${stopParams.reason}`
    );
  }

  override onError(error: string): void {
    console.error(`Sandbox container error: ${this.ctx.id}, error=${error}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/do/sandbox-container.ts
git commit -m "feat: add SandboxContainer DO wrapping the Canton image"
```

---

### Task 16: SessionDO

**Files:**
- Create: `src/server/do/session-do.ts`

- [ ] **Step 1: Create the Session Durable Object**

Create `src/server/do/session-do.ts`:

```ts
import { DurableObject } from "cloudflare:workers";

type ContainerStatus = "stopped" | "starting" | "running" | "error";

interface SessionState {
  containerStatus: ContainerStatus;
  startedAt: number | null;
  lastActivityAt: number | null;
  requestCount: number;
  errorLog: string | null;
}

interface Env {
  SANDBOX: DurableObjectNamespace;
  GATEKEEPER: DurableObjectNamespace;
}

export class SessionDO extends DurableObject<Env> {
  private state: SessionState = {
    containerStatus: "stopped",
    startedAt: null,
    lastActivityAt: null,
    requestCount: 0,
    errorLog: null,
  };
  private initialized = false;

  private async ensureInitialized() {
    if (this.initialized) return;

    const stored = await this.ctx.storage.get<SessionState>("state");
    if (stored) {
      this.state = stored;
    }

    this.initialized = true;
  }

  private async persistState() {
    await this.ctx.storage.put("state", this.state);
  }

  private getContainerStub() {
    // Use the same name as this DO so there's a 1:1 mapping
    const name = this.ctx.id.toString();
    return this.env.SANDBOX.getByName(name);
  }

  async start(): Promise<void> {
    await this.ensureInitialized();

    if (this.state.containerStatus === "running") return;
    if (this.state.containerStatus === "starting") return;

    this.state.containerStatus = "starting";
    this.state.errorLog = null;
    await this.persistState();

    try {
      const container = this.getContainerStub();
      // startAndWaitForPorts waits until the container's defaultPort is reachable
      await container.startAndWaitForPorts();

      this.state.containerStatus = "running";
      this.state.startedAt = Date.now();
      await this.persistState();
    } catch (err) {
      this.state.containerStatus = "error";
      this.state.errorLog =
        err instanceof Error ? err.message : "Failed to start container";
      await this.persistState();
      throw err;
    }
  }

  async proxy(request: Request): Promise<Response> {
    await this.ensureInitialized();

    // Start container if not running
    if (this.state.containerStatus !== "running") {
      await this.start();
    }

    const container = this.getContainerStub();

    try {
      const response = await container.fetch(request);

      this.state.lastActivityAt = Date.now();
      this.state.requestCount += 1;
      await this.persistState();

      return response;
    } catch (err) {
      // Attempt one restart
      if (this.state.containerStatus === "running") {
        this.state.containerStatus = "stopped";
        await this.persistState();

        try {
          await this.start();
          const retryResponse = await container.fetch(request);

          this.state.lastActivityAt = Date.now();
          this.state.requestCount += 1;
          await this.persistState();

          return retryResponse;
        } catch (retryErr) {
          this.state.containerStatus = "error";
          this.state.errorLog =
            retryErr instanceof Error
              ? retryErr.message
              : "Container restart failed";
          await this.persistState();

          // Release gatekeeper slot on permanent failure
          const gatekeeper = this.env.GATEKEEPER.getByName("global");
          await gatekeeper.release(this.ctx.id.toString());
        }
      }

      return new Response("Sandbox unavailable", { status: 502 });
    }
  }

  async status(): Promise<{
    containerStatus: ContainerStatus;
    startedAt: number | null;
    lastActivityAt: number | null;
    requestCount: number;
    errorLog: string | null;
  }> {
    await this.ensureInitialized();
    return { ...this.state };
  }

  async stop(): Promise<void> {
    await this.ensureInitialized();

    try {
      const container = this.getContainerStub();
      await container.stop();
    } catch {
      // Container may already be stopped
    }

    this.state.containerStatus = "stopped";
    await this.persistState();

    // Release gatekeeper slot
    const gatekeeper = this.env.GATEKEEPER.getByName("global");
    await gatekeeper.release(this.ctx.id.toString());
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/do/session-do.ts
git commit -m "feat: add SessionDO for per-user container coordination"
```

---

### Task 17: Go compile service reverse proxy

**Files:**
- Modify: `sandbox/compile-service/main.go`

- [ ] **Step 1: Add reverse proxy for Canton JSON API**

Add a reverse proxy handler so all requests not matching `/compile` or `/health` are forwarded to the Canton sandbox at `localhost:7575`. Add this to `sandbox/compile-service/main.go`.

Add import `"net/http/httputil"` and `"net/url"` to the imports.

Add the proxy handler function after the `handleCompile` function:

```go
func newCantonProxy() http.Handler {
	target, _ := url.Parse("http://localhost:7575")
	proxy := httputil.NewSingleHostReverseProxy(target)
	return proxy
}
```

Update the `main` function to add a catch-all route. Replace the existing mux setup:

```go
func main() {
	port := os.Getenv("COMPILE_PORT")
	if port == "" {
		port = "8081"
	}

	cantonProxy := newCantonProxy()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("POST /compile", handleCompile)
	// Proxy all other requests to Canton JSON API
	mux.Handle("/", cantonProxy)

	log.Printf("compile-service listening on :%s", port)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), mux); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/crisog/Code/Canton/daml-playground/sandbox/compile-service
go build -o /dev/null .
```

Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add sandbox/compile-service/main.go
git commit -m "feat: add Canton JSON API reverse proxy to compile service"
```

---

### Task 18: Update wrangler configuration

**Files:**
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Update wrangler.jsonc with D1, DOs, and Containers**

Replace the contents of `wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "daml-playground",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
  "routes": [
    { "pattern": "daml.run/*", "zone_name": "daml.run" }
  ],

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "daml-playground-db",
      "database_id": "REPLACE_AFTER_D1_CREATE"
    }
  ],

  "containers": [
    {
      "class_name": "SandboxContainer",
      "image": "./sandbox",
      "max_instances": 50,
      "instance_type": "standard-1"
    }
  ],

  "durable_objects": {
    "bindings": [
      { "name": "SESSION", "class_name": "SessionDO" },
      { "name": "SANDBOX", "class_name": "SandboxContainer" },
      { "name": "GATEKEEPER", "class_name": "GatekeeperDO" }
    ]
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["SessionDO", "SandboxContainer", "GatekeeperDO"]
    }
  ]
}
```

Note: After running `wrangler d1 create daml-playground-db`, replace `REPLACE_AFTER_D1_CREATE` with the actual database ID.

- [ ] **Step 2: Commit**

```bash
git add wrangler.jsonc
git commit -m "feat: add D1, Durable Objects, and Containers to wrangler config"
```

---

### Task 19: Update CI/CD workflow

**Files:**
- Modify: `.github/workflows/deploy-docs.yml`

- [ ] **Step 1: Update the deploy workflow**

Replace the contents of `.github/workflows/deploy-docs.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
    paths:
      - "src/**"
      - "content/**"
      - "sandbox/**"
      - "package.json"
      - "package-lock.json"
      - "vite.config.ts"
      - "source.config.ts"
      - "wrangler.jsonc"
      - ".github/workflows/deploy-docs.yml"
  pull_request:
    branches: [main]
    paths:
      - "src/**"
      - "content/**"
      - "sandbox/**"
      - "package.json"
      - "package-lock.json"
      - "vite.config.ts"
      - "source.config.ts"
      - "wrangler.jsonc"
      - ".github/workflows/deploy-docs.yml"

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - run: npm ci
      - run: npm run build

  deploy:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - run: npm ci
      - run: npm run build
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

Note: Cloudflare's `wrangler deploy` handles container image building automatically when Docker is available. The ubuntu-latest runner has Docker pre-installed. Worker secrets (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_SECRET`) must be set via `wrangler secret put` before the first deploy.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-docs.yml
git commit -m "feat: update CI/CD for containers and sandbox path triggers"
```

---

### Task 20: Manual deployment setup

This task covers one-time setup steps that must be done manually before the first deploy.

- [ ] **Step 1: Create the D1 database**

```bash
npx wrangler d1 create daml-playground-db
```

Copy the output `database_id` and update `wrangler.jsonc` to replace `REPLACE_AFTER_D1_CREATE`.

- [ ] **Step 2: Run D1 migrations**

Generate the migration from the Drizzle schema and apply it:

```bash
npx drizzle-kit generate --dialect sqlite --out migrations --schema src/db/schema.ts
npx wrangler d1 migrations apply daml-playground-db --local
```

- [ ] **Step 3: Set Worker secrets**

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put BETTER_AUTH_SECRET
```

Each command will prompt for the value interactively.

- [ ] **Step 4: Register GitHub OAuth App**

Go to GitHub Settings > Developer Settings > OAuth Apps > New OAuth App:
- Application name: `Daml Playground`
- Homepage URL: `https://daml.run`
- Authorization callback URL: `https://daml.run/api/auth/callback/github`

Copy the Client ID and Client Secret for the secrets above.

- [ ] **Step 5: Update wrangler.jsonc with the D1 database ID**

Replace `REPLACE_AFTER_D1_CREATE` with the actual database ID from Step 1.

- [ ] **Step 6: Commit the database ID update**

```bash
git add wrangler.jsonc
git commit -m "chore: set D1 database ID in wrangler config"
```

---

## Execution Order

Tasks 1-8 can be done sequentially as they build on each other. Tasks 14-16 (the three DOs) are independent of each other and can be done in parallel. Task 17 (Go proxy) is independent of all TypeScript tasks. Task 20 requires a Cloudflare account and is done at deploy time.

Dependency graph:
```
1 (deps) → 2 (schema) → 3 (auth) → 4 (client) → 5 (functions) → 6 (handler) → 7 (login) → 8 (layout)
                                                                                                    ↓
                                                                                              9 (playground route)
                                                                                                    ↓
                                                                                        10 (sandbox loader) → 11 (sandbox functions)
                                                                                                    ↓
                                                                                              12 (proxy route) → 13 (update paths)

14 (gatekeeper) ─┐
15 (container)  ──┤── can run in parallel, independent of each other
16 (session)   ───┘

17 (go proxy) ──── independent of all TS tasks

18 (wrangler) ──── after all source files exist
19 (CI/CD) ─────── after wrangler config
20 (manual setup) ── at deploy time
```
