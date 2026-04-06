# Daml Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive browser-based playground where users write Daml contracts, compile them, deploy to a live Canton sandbox, and interact with their contracts through a web UI.

**Architecture:** A Docker Compose setup running a Canton sandbox (with JSON API) alongside a Go compile service in one container, and a Vite+React frontend in a second container. The compile service accepts Daml source via HTTP, runs `dpm build`, and uploads the resulting DAR to the sandbox via `POST /v2/packages`. The frontend provides a Monaco editor with Daml syntax highlighting and a contract explorer for creating parties, submitting commands, and querying active contracts. Cloudflare Containers deployment is a future phase, not in this plan.

**Tech Stack:** Go 1.22+ (compile service), Vite 7 + React 19 + TypeScript 5.8 + TanStack Router + Tailwind 4 + Base UI (frontend, matching ichno stack), Monaco Editor (code editor), Docker + Docker Compose (local dev), Canton SDK 3.4.11 (sandbox)

**Reference codebase:** `/Users/crisog/Code/Personal/ichno/apps/web` for frontend patterns, styling, and component conventions.

---

## File Structure

```
playground/
├── docker-compose.yml              # Orchestrates sandbox + web containers
├── README.md                       # Setup and usage instructions
│
├── sandbox/
│   ├── Dockerfile                  # Canton SDK + JVM + dpm + compile service
│   ├── entrypoint.sh               # Starts Canton sandbox + compile service
│   └── compile-service/
│       ├── go.mod
│       ├── main.go                 # HTTP server: POST /compile, GET /health
│       └── main_test.go            # Tests for compile handler
│
└── web/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts              # Dev proxy: /api → sandbox:7575, /compile → sandbox:8081
    ├── index.html
    └── src/
        ├── main.tsx                # React entry, router setup (no tRPC, no auth)
        ├── index.css               # Tailwind + washi-paper design tokens (from ichno)
        ├── vite-env.d.ts
        ├── routes/
        │   ├── __root.tsx          # Root layout (no auth guard)
        │   └── index.lazy.tsx      # Main playground view
        ├── components/
        │   ├── party-panel.tsx     # Create parties, select active party
        │   ├── contract-list.tsx   # Query + display active contracts for selected party
        │   ├── command-panel.tsx   # Create contracts, exercise choices
        │   └── compile-status.tsx  # Build button, error display, deploy status
        ├── editor/
        │   ├── daml-editor.tsx     # Monaco editor wrapper with Daml grammar
        │   └── daml-language.ts    # Monarch tokenizer for Daml
        └── lib/
            ├── canton.ts           # Canton JSON API client (typed fetch wrappers)
            ├── compiler.ts         # Compile service client (POST source, get result)
            └── types.ts            # Shared types: Party, Contract, CompileResult
```

---

## Coding Conventions (from ichno reference)

These conventions apply to all frontend code in the plan:

- **Types:** Use `type` keyword, not `interface`. Props types inline or above component.
- **Components:** Named exports, explicit `React.JSX.Element` return type.
- **Styling:** Tailwind utility classes using the washi-paper design tokens (`bg-surface`, `text-ink`, `border-stone`, `text-xs`, `rounded-md`, etc.). No inline `style` objects.
- **UI primitives:** Base UI headless components (`Button`, `Dialog`, `Menu`) with Tailwind classes.
- **State:** `useState` for local state. No global store, no React Query (plain fetch is sufficient for a playground).
- **File naming:** kebab-case for all files (`party-panel.tsx`, `daml-editor.tsx`).
- **Imports:** Named imports, no default exports except route components.

---

## Task 1: Compile service skeleton

**Files:**
- Create: `playground/sandbox/compile-service/go.mod`
- Create: `playground/sandbox/compile-service/main.go`
- Create: `playground/sandbox/compile-service/main_test.go`

- [ ] **Step 1: Initialize Go module**

```bash
mkdir -p playground/sandbox/compile-service
cd playground/sandbox/compile-service
go mod init github.com/crisog/daml-playground/compile-service
```

- [ ] **Step 2: Write the health endpoint test**

Create `playground/sandbox/compile-service/main_test.go`:

```go
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if w.Body.String() != `{"status":"ok"}` {
		t.Errorf("unexpected body: %s", w.Body.String())
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd playground/sandbox/compile-service
go test -v -run TestHealthEndpoint
```

Expected: FAIL with `undefined: handleHealth`

- [ ] **Step 4: Implement health handler and main**

Create `playground/sandbox/compile-service/main.go`:

```go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
)

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func main() {
	port := os.Getenv("COMPILE_PORT")
	if port == "" {
		port = "8081"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)

	log.Printf("compile-service listening on :%s", port)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), mux); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd playground/sandbox/compile-service
go test -v -run TestHealthEndpoint
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add playground/sandbox/compile-service/
git commit -m "feat(playground): add compile service skeleton with health endpoint"
```

---

## Task 2: Compile endpoint

**Files:**
- Modify: `playground/sandbox/compile-service/main.go`
- Modify: `playground/sandbox/compile-service/main_test.go`

- [ ] **Step 1: Write the compile handler tests**

Append to `playground/sandbox/compile-service/main_test.go`:

```go
func TestCompileEndpoint_MissingBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/compile", nil)
	w := httptest.NewRecorder()
	handleCompile(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestCompileEndpoint_InvalidJSON(t *testing.T) {
	body := strings.NewReader(`not json`)
	req := httptest.NewRequest(http.MethodPost, "/compile", body)
	w := httptest.NewRecorder()
	handleCompile(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestCompileEndpoint_EmptySource(t *testing.T) {
	body := strings.NewReader(`{"files":{}}`)
	req := httptest.NewRequest(http.MethodPost, "/compile", body)
	w := httptest.NewRecorder()
	handleCompile(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}
```

Add `"strings"` to the test file imports.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd playground/sandbox/compile-service
go test -v
```

Expected: FAIL with `undefined: handleCompile`

- [ ] **Step 3: Implement the compile handler**

Add to `playground/sandbox/compile-service/main.go` (add imports: `"bytes"`, `"io"`, `"os/exec"`, `"path/filepath"`, `"strings"`):

```go
type CompileRequest struct {
	Files map[string]string `json:"files"`
}

type CompileResponse struct {
	Success bool     `json:"success"`
	Errors  []string `json:"errors,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func handleCompile(w http.ResponseWriter, r *http.Request) {
	if r.Body == nil {
		writeJSON(w, http.StatusBadRequest, CompileResponse{Errors: []string{"request body required"}})
		return
	}

	var req CompileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, CompileResponse{Errors: []string{"invalid JSON: " + err.Error()}})
		return
	}

	if len(req.Files) == 0 {
		writeJSON(w, http.StatusBadRequest, CompileResponse{Errors: []string{"at least one .daml file required"}})
		return
	}

	tmpDir, err := os.MkdirTemp("", "daml-compile-*")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to create temp dir"}})
		return
	}
	defer os.RemoveAll(tmpDir)

	damlYaml := "sdk-version: 3.4.11\nname: playground-project\nsource: daml\nversion: 0.0.1\ndependencies:\n  - daml-prim\n  - daml-stdlib\n  - daml-script\n"
	if err := os.WriteFile(filepath.Join(tmpDir, "daml.yaml"), []byte(damlYaml), 0644); err != nil {
		writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to write daml.yaml"}})
		return
	}

	damlDir := filepath.Join(tmpDir, "daml")
	if err := os.MkdirAll(damlDir, 0755); err != nil {
		writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to create daml dir"}})
		return
	}

	for name, content := range req.Files {
		if err := os.WriteFile(filepath.Join(damlDir, name), []byte(content), 0644); err != nil {
			writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to write " + name}})
			return
		}
	}

	cmd := exec.Command("dpm", "build")
	cmd.Dir = tmpDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		var errors []string
		for _, line := range strings.Split(string(output), "\n") {
			if trimmed := strings.TrimSpace(line); trimmed != "" {
				errors = append(errors, trimmed)
			}
		}
		writeJSON(w, http.StatusUnprocessableEntity, CompileResponse{Errors: errors})
		return
	}

	darPath := filepath.Join(tmpDir, ".daml", "dist", "playground-project-0.0.1.dar")
	darBytes, err := os.ReadFile(darPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"DAR not found after build"}})
		return
	}

	sandboxURL := os.Getenv("SANDBOX_URL")
	if sandboxURL == "" {
		sandboxURL = "http://localhost:7575"
	}

	uploadReq, _ := http.NewRequest(http.MethodPost, sandboxURL+"/v2/packages", bytes.NewReader(darBytes))
	uploadReq.Header.Set("Content-Type", "application/octet-stream")

	resp, err := http.DefaultClient.Do(uploadReq)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, CompileResponse{Errors: []string{"failed to upload DAR: " + err.Error()}})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		writeJSON(w, http.StatusBadGateway, CompileResponse{Errors: []string{"sandbox rejected DAR: " + string(respBody)}})
		return
	}

	writeJSON(w, http.StatusOK, CompileResponse{Success: true})
}
```

Register the route in `main()`:

```go
mux.HandleFunc("POST /compile", handleCompile)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd playground/sandbox/compile-service
go test -v
```

Expected: PASS (validation tests don't need dpm)

- [ ] **Step 5: Commit**

```bash
git add playground/sandbox/compile-service/
git commit -m "feat(playground): add compile endpoint with dpm build and DAR upload"
```

---

## Task 3: Sandbox container image

**Files:**
- Create: `playground/sandbox/Dockerfile`
- Create: `playground/sandbox/entrypoint.sh`

- [ ] **Step 1: Write the Dockerfile**

Create `playground/sandbox/Dockerfile`:

```dockerfile
FROM eclipse-temurin:17-jdk-jammy AS base

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://get.digitalasset.com/install/install.sh | sh
ENV PATH="/root/.dpm/bin:${PATH}"
RUN dpm install 3.4.11

FROM golang:1.22-bookworm AS builder
WORKDIR /build
COPY compile-service/go.mod ./
RUN go mod download
COPY compile-service/ ./
RUN CGO_ENABLED=0 go build -o /compile-service .

FROM eclipse-temurin:17-jdk-jammy
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=base /root/.dpm /root/.dpm
ENV PATH="/root/.dpm/bin:${PATH}"

COPY --from=builder /compile-service /usr/local/bin/compile-service

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7575 8081
ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 2: Write the entrypoint script**

Create `playground/sandbox/entrypoint.sh`:

```bash
#!/bin/bash
set -e

echo "Starting compile service on :8081..."
compile-service &

echo "Starting Canton sandbox on :7575..."
dpm sandbox --json-api-port 7575
```

- [ ] **Step 3: Verify Dockerfile builds**

```bash
cd playground/sandbox
docker build -t daml-playground-sandbox .
```

Expected: Build completes successfully.

- [ ] **Step 4: Commit**

```bash
git add playground/sandbox/Dockerfile playground/sandbox/entrypoint.sh
git commit -m "feat(playground): add sandbox container with Canton and compile service"
```

---

## Task 4: Docker Compose for local dev

**Files:**
- Create: `playground/docker-compose.yml`

- [ ] **Step 1: Write docker-compose.yml**

Create `playground/docker-compose.yml`:

```yaml
services:
  sandbox:
    build:
      context: ./sandbox
    ports:
      - "7575:7575"
      - "8081:8081"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8081/health"]
      interval: 5s
      timeout: 3s
      retries: 30
      start_period: 20s
```

- [ ] **Step 2: Verify compose starts**

```bash
cd playground
docker compose up --build -d
docker compose ps
```

Expected: sandbox service is running and healthy.

- [ ] **Step 3: Test compile endpoint end-to-end**

```bash
curl -s -X POST http://localhost:8081/compile \
  -H "Content-Type: application/json" \
  -d '{"files":{"Main.daml":"module Main where\n\ntemplate Hello\n  with\n    owner : Party\n  where\n    signatory owner"}}' | jq .
```

Expected: `{"success": true}`

- [ ] **Step 4: Tear down**

```bash
docker compose down
```

- [ ] **Step 5: Commit**

```bash
git add playground/docker-compose.yml
git commit -m "feat(playground): add docker-compose for local development"
```

---

## Task 5: Web app scaffold

**Files:**
- Create: `playground/web/package.json`
- Create: `playground/web/tsconfig.json`
- Create: `playground/web/vite.config.ts`
- Create: `playground/web/index.html`
- Create: `playground/web/src/vite-env.d.ts`
- Create: `playground/web/src/index.css`
- Create: `playground/web/src/main.tsx`
- Create: `playground/web/src/lib/types.ts`
- Create: `playground/web/src/routes/__root.tsx`
- Create: `playground/web/src/routes/index.lazy.tsx`

- [ ] **Step 1: Write package.json**

Create `playground/web/package.json`:

```json
{
  "name": "@daml-playground/web",
  "version": "0.0.1",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@base-ui/react": "^1.1.0",
    "@monaco-editor/react": "^4.7.0",
    "@tanstack/react-router": "^1.158.4",
    "lucide-react": "^0.563.0",
    "monaco-editor": "^0.52.2",
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.18",
    "@tanstack/router-devtools": "^1.158.4",
    "@tanstack/router-plugin": "^1.158.4",
    "@types/react": "^19.2.13",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react-swc": "^4.2.3",
    "autoprefixer": "^10.4.24",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.18",
    "typescript": "^5.8.3",
    "vite": "^7.3.1"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

Create `playground/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write vite.config.ts**

Create `playground/web/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [TanStackRouterVite({ autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7575',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/compile': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 4: Write index.html**

Create `playground/web/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Daml Playground</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write index.css (design tokens from ichno)**

Create `playground/web/src/index.css`:

```css
@import 'tailwindcss';

@theme {
  --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;

  --color-page: #F7F3EE;
  --color-surface: #EFEBE5;
  --color-elevated: #E7E2DA;

  --color-ink: #2C2825;
  --color-ink-secondary: #5C5550;
  --color-ink-muted: #746B62;
  --color-ink-inverted: #F7F3EE;

  --color-stone: #D5CFC7;
  --color-stone-strong: #B8B0A5;

  --color-accent: #5F628F;
  --color-accent-hover: #53567E;
  --color-accent-light: #EEEEF5;

  --color-error: #A15C4B;
  --color-error-light: #F5EBE7;
  --color-success: #4F765C;
  --color-success-light: #EBF2ED;

  --text-xs: 0.6875rem;
  --text-sm: 0.8125rem;
  --text-base: 0.9375rem;

  --leading-tight: 1.4;
  --leading-normal: 1.6;

  --radius-sm: 0.125rem;
  --radius-md: 0.375rem;
}

html {
  background-color: var(--color-page);
  color: var(--color-ink);
}

body {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  -webkit-font-smoothing: antialiased;
  margin: 0;
}

::selection {
  background-color: var(--color-accent-light);
  color: var(--color-ink);
}

::placeholder {
  color: var(--color-ink-muted);
  opacity: 1;
}

:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

button, [role='button'] {
  cursor: pointer;
  font-family: inherit;
  transition: background-color 150ms ease, color 150ms ease;
}

button:disabled, [role='button']:disabled {
  cursor: default;
  opacity: 0.5;
}
```

- [ ] **Step 6: Write vite-env.d.ts**

Create `playground/web/src/vite-env.d.ts`:

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 7: Write shared types**

Create `playground/web/src/lib/types.ts`:

```typescript
export type Party = {
  id: string
  displayName: string
}

export type ActiveContract = {
  contractId: string
  templateId: string
  createArguments: Record<string, unknown>
  signatories: string[]
  observers: string[]
}

export type CompileResult = {
  success: boolean
  errors?: string[]
}
```

- [ ] **Step 8: Write root route (no auth)**

Create `playground/web/src/routes/__root.tsx`:

```tsx
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const RouterDevtools = import.meta.env.DEV
  ? lazy(async () => {
      const mod = await import('@tanstack/router-devtools')
      return { default: mod.TanStackRouterDevtools }
    })
  : null

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent(): React.JSX.Element {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV && RouterDevtools ? (
        <Suspense fallback={null}>
          <RouterDevtools />
        </Suspense>
      ) : null}
    </>
  )
}
```

- [ ] **Step 9: Write main.tsx**

Create `playground/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing #root element')

if (!rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  )
}
```

- [ ] **Step 10: Write index route placeholder**

Create `playground/web/src/routes/index.lazy.tsx`:

```tsx
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/')({
  component: PlaygroundPage,
})

function PlaygroundPage(): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-stone px-4 py-2">
        <h1 className="text-sm font-medium">Daml Playground</h1>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 border-r border-stone bg-elevated p-4 text-ink-muted">
          Editor goes here
        </div>
        <div className="w-96 overflow-y-auto bg-surface p-4 text-ink-muted">
          Explorer goes here
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 11: Install and verify**

```bash
cd playground/web
npm install
npx tsc --noEmit
npx vite build
```

Expected: No errors.

- [ ] **Step 12: Commit**

```bash
git add playground/web/
git commit -m "feat(playground): add web scaffold with TanStack Router and Tailwind"
```

---

## Task 6: Canton and compiler API clients

**Files:**
- Create: `playground/web/src/lib/canton.ts`
- Create: `playground/web/src/lib/compiler.ts`

- [ ] **Step 1: Write Canton API client**

Create `playground/web/src/lib/canton.ts`:

```typescript
import type { Party, ActiveContract } from './types'

const API = '/api'

let commandCounter = 0
function nextCommandId(): string {
  return `playground-${Date.now()}-${++commandCounter}`
}

export async function createParty(displayName: string): Promise<Party> {
  const res = await fetch(`${API}/v2/parties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partyIdHint: displayName, identityProviderId: '' }),
  })
  if (!res.ok) throw new Error(`Failed to create party: ${res.statusText}`)
  const data = await res.json()
  return { id: data.partyDetails.party, displayName }
}

export async function submitCreate(
  actAs: string[],
  templateId: string,
  createArguments: Record<string, unknown>,
): Promise<{ updateId: string; completionOffset: number }> {
  const res = await fetch(`${API}/v2/commands/submit-and-wait`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [{ CreateCommand: { templateId, createArguments } }],
      actAs,
      readAs: actAs,
      userId: 'playground-user',
      commandId: nextCommandId(),
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body)
  }
  return res.json()
}

export async function submitExercise(
  actAs: string[],
  templateId: string,
  contractId: string,
  choice: string,
  choiceArgument: Record<string, unknown>,
): Promise<{ updateId: string; completionOffset: number }> {
  const res = await fetch(`${API}/v2/commands/submit-and-wait`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [{ ExerciseCommand: { templateId, contractId, choice, choiceArgument } }],
      actAs,
      readAs: actAs,
      userId: 'playground-user',
      commandId: nextCommandId(),
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body)
  }
  return res.json()
}

export async function queryContracts(partyId: string): Promise<ActiveContract[]> {
  const endRes = await fetch(`${API}/v2/state/ledger-end`)
  if (!endRes.ok) throw new Error(`Failed to get ledger end`)
  const { offset } = await endRes.json()

  const res = await fetch(`${API}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: {
        filtersByParty: {
          [partyId]: {
            cumulative: [
              { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
            ],
          },
        },
      },
      verbose: true,
      activeAtOffset: offset,
    }),
  })
  if (!res.ok) throw new Error(`Query failed: ${res.statusText}`)

  const data = await res.json()
  if (!Array.isArray(data)) return []

  return data
    .filter((e: Record<string, unknown>) => e.contractEntry)
    .map((e: Record<string, unknown>) => {
      const active = (e.contractEntry as Record<string, unknown>).JsActiveContract as Record<string, unknown>
      const ev = active.createdEvent as Record<string, unknown>
      return {
        contractId: ev.contractId as string,
        templateId: ev.templateId as string,
        createArguments: ev.createArgument as Record<string, unknown>,
        signatories: ev.signatories as string[],
        observers: (ev.observers as string[]) ?? [],
      }
    })
}
```

- [ ] **Step 2: Write compiler client**

Create `playground/web/src/lib/compiler.ts`:

```typescript
import type { CompileResult } from './types'

export async function compileAndDeploy(files: Record<string, string>): Promise<CompileResult> {
  const res = await fetch('/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  return res.json()
}
```

- [ ] **Step 3: Verify types**

```bash
cd playground/web
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add playground/web/src/lib/
git commit -m "feat(playground): add Canton JSON API and compiler clients"
```

---

## Task 7: Party panel component

**Files:**
- Create: `playground/web/src/components/party-panel.tsx`

- [ ] **Step 1: Write PartyPanel**

Create `playground/web/src/components/party-panel.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '@base-ui/react/button'
import { createParty } from '../lib/canton'
import type { Party } from '../lib/types'

type PartyPanelProps = {
  parties: Party[]
  activeParty: Party | null
  onPartyCreated: (party: Party) => void
  onPartySelected: (party: Party) => void
}

export function PartyPanel({
  parties,
  activeParty,
  onPartyCreated,
  onPartySelected,
}: PartyPanelProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const party = await createParty(name.trim())
      onPartyCreated(party)
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create party')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="border-b border-stone p-3">
      <h3 className="mb-2 text-xs font-medium text-ink-secondary">Parties</h3>
      <div className="mb-2 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="Party name"
          disabled={creating}
          className="flex-1 rounded-md border border-stone bg-page px-2 py-1 text-xs"
        />
        <Button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          className="rounded-md bg-accent px-3 py-1 text-xs text-ink-inverted hover:bg-accent-hover"
        >
          {creating ? '...' : 'Create'}
        </Button>
      </div>
      {error && <p className="mb-2 text-xs text-error">{error}</p>}
      <div className="flex flex-wrap gap-1">
        {parties.map((p) => (
          <button
            key={p.id}
            onClick={() => onPartySelected(p)}
            className={`rounded-sm px-2 py-0.5 text-xs transition-colors ${
              activeParty?.id === p.id
                ? 'bg-accent text-ink-inverted'
                : 'bg-elevated text-ink-secondary hover:bg-stone'
            }`}
          >
            {p.displayName}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify types**

```bash
cd playground/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add playground/web/src/components/party-panel.tsx
git commit -m "feat(playground): add party panel component"
```

---

## Task 8: Contract list component

**Files:**
- Create: `playground/web/src/components/contract-list.tsx`

- [ ] **Step 1: Write ContractList**

Create `playground/web/src/components/contract-list.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { queryContracts } from '../lib/canton'
import type { ActiveContract } from '../lib/types'

type ContractListProps = {
  partyId: string | null
  refreshKey: number
}

function shortId(id: string): string {
  return id.split('::')[0] ?? id
}

function shortTemplate(id: string): string {
  const parts = id.split(':')
  return parts.length >= 3 ? `${parts[parts.length - 2]}:${parts[parts.length - 1]}` : id
}

export function ContractList({ partyId, refreshKey }: ContractListProps): React.JSX.Element | null {
  const [contracts, setContracts] = useState<ActiveContract[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!partyId) {
      setContracts([])
      return
    }
    setLoading(true)
    setError(null)
    queryContracts(partyId)
      .then(setContracts)
      .catch((e) => setError(e instanceof Error ? e.message : 'Query failed'))
      .finally(() => setLoading(false))
  }, [partyId, refreshKey])

  if (!partyId) return null
  if (loading) return <p className="p-3 text-xs text-ink-muted">Loading...</p>
  if (error) return <p className="p-3 text-xs text-error">{error}</p>
  if (contracts.length === 0) return <p className="p-3 text-xs text-ink-muted">No active contracts</p>

  return (
    <div className="p-3">
      <h3 className="mb-2 text-xs font-medium text-ink-secondary">
        Active Contracts ({contracts.length})
      </h3>
      <div className="flex flex-col gap-2">
        {contracts.map((c) => (
          <div key={c.contractId} className="rounded-md border border-stone bg-page p-2">
            <div className="mb-1 text-xs font-medium text-accent">{shortTemplate(c.templateId)}</div>
            <div className="mb-1 font-mono text-xs text-ink-muted">
              {c.contractId.slice(0, 24)}...
            </div>
            <table className="w-full text-xs">
              <tbody>
                {Object.entries(c.createArguments).map(([key, val]) => (
                  <tr key={key}>
                    <td className="pr-3 align-top text-ink-muted">{key}</td>
                    <td className="text-ink">
                      {typeof val === 'string' ? shortId(val) : JSON.stringify(val)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify types**

```bash
cd playground/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add playground/web/src/components/contract-list.tsx
git commit -m "feat(playground): add contract list component"
```

---

## Task 9: Command panel component

**Files:**
- Create: `playground/web/src/components/command-panel.tsx`

- [ ] **Step 1: Write CommandPanel**

Create `playground/web/src/components/command-panel.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '@base-ui/react/button'
import { submitCreate, submitExercise } from '../lib/canton'
import type { Party } from '../lib/types'

type CommandPanelProps = {
  parties: Party[]
  onCommandSuccess: () => void
}

export function CommandPanel({ parties, onCommandSuccess }: CommandPanelProps): React.JSX.Element | null {
  const [mode, setMode] = useState<'create' | 'exercise'>('create')
  const [templateId, setTemplateId] = useState('')
  const [argsJson, setArgsJson] = useState('{}')
  const [contractId, setContractId] = useState('')
  const [choice, setChoice] = useState('')
  const [choiceArgsJson, setChoiceArgsJson] = useState('{}')
  const [actAsIds, setActAsIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (parties.length === 0) return null

  function toggleActAs(id: string) {
    setActAsIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      if (mode === 'create') {
        const args = JSON.parse(argsJson)
        await submitCreate(actAsIds, templateId, args)
        setResult('Contract created')
      } else {
        const args = JSON.parse(choiceArgsJson)
        await submitExercise(actAsIds, templateId, contractId, choice, args)
        setResult('Choice exercised')
      }
      onCommandSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Command failed')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = 'w-full rounded-md border border-stone bg-page px-2 py-1 text-xs'

  return (
    <div className="border-t border-stone p-3">
      <h3 className="mb-2 text-xs font-medium text-ink-secondary">Submit Command</h3>

      <div className="mb-2 flex gap-1">
        {(['create', 'exercise'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-sm px-2 py-0.5 text-xs capitalize ${
              mode === m ? 'bg-accent text-ink-inverted' : 'bg-elevated text-ink-secondary'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mb-2">
        <span className="text-xs text-ink-muted">Act as:</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {parties.map((p) => (
            <button
              key={p.id}
              onClick={() => toggleActAs(p.id)}
              className={`rounded-sm px-2 py-0.5 text-xs ${
                actAsIds.includes(p.id) ? 'bg-success text-ink-inverted' : 'bg-elevated text-ink-secondary'
              }`}
            >
              {p.displayName}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <input value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="Template ID" className={inputClass} />
        {mode === 'exercise' && (
          <>
            <input value={contractId} onChange={(e) => setContractId(e.target.value)} placeholder="Contract ID" className={inputClass} />
            <input value={choice} onChange={(e) => setChoice(e.target.value)} placeholder="Choice name" className={inputClass} />
          </>
        )}
        <textarea
          value={mode === 'create' ? argsJson : choiceArgsJson}
          onChange={(e) => (mode === 'create' ? setArgsJson(e.target.value) : setChoiceArgsJson(e.target.value))}
          placeholder={mode === 'create' ? 'Create arguments (JSON)' : 'Choice arguments (JSON)'}
          rows={3}
          className={`${inputClass} resize-none font-mono`}
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={submitting || actAsIds.length === 0 || !templateId}
        className="mt-2 rounded-md bg-accent px-3 py-1 text-xs text-ink-inverted hover:bg-accent-hover"
      >
        {submitting ? 'Submitting...' : 'Submit'}
      </Button>

      {result && <p className="mt-2 text-xs text-success">{result}</p>}
      {error && <pre className="mt-2 whitespace-pre-wrap rounded-md bg-error-light p-2 text-xs text-error">{error}</pre>}
    </div>
  )
}
```

- [ ] **Step 2: Verify types**

```bash
cd playground/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add playground/web/src/components/command-panel.tsx
git commit -m "feat(playground): add command panel for create and exercise"
```

---

## Task 10: Compile status component

**Files:**
- Create: `playground/web/src/components/compile-status.tsx`

- [ ] **Step 1: Write CompileStatus**

Create `playground/web/src/components/compile-status.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '@base-ui/react/button'
import { compileAndDeploy } from '../lib/compiler'

type CompileStatusProps = {
  getSource: () => Record<string, string>
}

export function CompileStatus({ getSource }: CompileStatusProps): React.JSX.Element {
  const [compiling, setCompiling] = useState(false)
  const [result, setResult] = useState<{ success: boolean; errors?: string[] } | null>(null)

  async function handleCompile() {
    setCompiling(true)
    setResult(null)
    try {
      const res = await compileAndDeploy(getSource())
      setResult(res)
    } catch (e) {
      setResult({ success: false, errors: [e instanceof Error ? e.message : 'Compile failed'] })
    } finally {
      setCompiling(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        onClick={handleCompile}
        disabled={compiling}
        className="rounded-md bg-success px-3 py-1 text-xs font-medium text-ink-inverted hover:opacity-90"
      >
        {compiling ? 'Compiling...' : 'Deploy'}
      </Button>
      {result?.success && <span className="text-xs text-success">Deployed</span>}
      {result && !result.success && (
        <span className="text-xs text-error" title={result.errors?.join('\n')}>
          Build failed
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify types**

```bash
cd playground/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add playground/web/src/components/compile-status.tsx
git commit -m "feat(playground): add compile and deploy status component"
```

---

## Task 11: Monaco editor with Daml syntax

**Files:**
- Create: `playground/web/src/editor/daml-language.ts`
- Create: `playground/web/src/editor/daml-editor.tsx`

- [ ] **Step 1: Write Daml language registration (Monarch tokenizer)**

Create `playground/web/src/editor/daml-language.ts`:

```typescript
import type * as Monaco from 'monaco-editor'

export function registerDamlLanguage(monaco: typeof Monaco): void {
  if (monaco.languages.getLanguages().some((l) => l.id === 'daml')) return

  monaco.languages.register({ id: 'daml', extensions: ['.daml'] })

  monaco.languages.setMonarchTokensProvider('daml', {
    keywords: [
      'module', 'where', 'import', 'template', 'with', 'do', 'let', 'in',
      'if', 'then', 'else', 'case', 'of', 'data', 'type', 'class', 'instance',
      'signatory', 'observer', 'controller', 'choice', 'nonconsuming',
      'preconsuming', 'postconsuming', 'ensure', 'create', 'exercise',
      'fetch', 'archive', 'return', 'pure', 'this', 'self', 'deriving',
    ],
    typeKeywords: [
      'Party', 'Text', 'Int', 'Decimal', 'Bool', 'Optional', 'ContractId',
      'Update', 'Script', 'Date', 'Time',
    ],
    operators: ['=', '->', '<-', '::', '=>', '|', '\\', '.', '@'],
    tokenizer: {
      root: [
        [/--\|.*$/, 'comment.doc'],
        [/--.*$/, 'comment'],
        [/\{-/, 'comment', '@comment'],
        [/"/, 'string', '@string'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/[a-z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/[A-Z]\w*/, { cases: { '@typeKeywords': 'type', '@default': 'type.identifier' } }],
        [/[=\->:<|\\@.]/, 'operator'],
      ],
      comment: [
        [/[^{-]+/, 'comment'],
        [/-\}/, 'comment', '@pop'],
        [/[{-]/, 'comment'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],
    },
  })

  monaco.languages.setLanguageConfiguration('daml', {
    comments: { lineComment: '--', blockComment: ['{-', '-}'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  })
}
```

- [ ] **Step 2: Write DamlEditor component**

Create `playground/web/src/editor/daml-editor.tsx`:

```tsx
import { useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { registerDamlLanguage } from './daml-language'

type DamlEditorProps = {
  value: string
  onChange: (value: string) => void
}

export function DamlEditor({ value, onChange }: DamlEditorProps): React.JSX.Element {
  const registered = useRef(false)

  const handleMount: OnMount = (editor, monaco) => {
    if (!registered.current) {
      registerDamlLanguage(monaco)
      registered.current = true
    }
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, 'daml')
  }

  return (
    <Editor
      height="100%"
      defaultLanguage="daml"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        fontFamily: 'SF Mono, Cascadia Code, Fira Code, monospace',
      }}
    />
  )
}
```

- [ ] **Step 3: Verify types**

```bash
cd playground/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add playground/web/src/editor/
git commit -m "feat(playground): add Monaco editor with Daml syntax highlighting"
```

---

## Task 12: Wire everything into the playground page

**Files:**
- Modify: `playground/web/src/routes/index.lazy.tsx`

- [ ] **Step 1: Replace index route with full playground layout**

Replace `playground/web/src/routes/index.lazy.tsx`:

```tsx
import { createLazyFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { PartyPanel } from '../components/party-panel'
import { ContractList } from '../components/contract-list'
import { CommandPanel } from '../components/command-panel'
import { CompileStatus } from '../components/compile-status'
import { DamlEditor } from '../editor/daml-editor'
import type { Party } from '../lib/types'

export const Route = createLazyFileRoute('/')({
  component: PlaygroundPage,
})

const DEFAULT_SOURCE = `module Main where

template Hello
  with
    owner : Party
  where
    signatory owner
`

function PlaygroundPage(): React.JSX.Element {
  const [parties, setParties] = useState<Party[]>([])
  const [activeParty, setActiveParty] = useState<Party | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [source, setSource] = useState(DEFAULT_SOURCE)

  return (
    <div className="flex h-screen flex-col bg-page text-ink">
      <header className="flex items-center gap-4 border-b border-stone px-4 py-2">
        <h1 className="text-sm font-medium">Daml Playground</h1>
        <CompileStatus getSource={() => ({ 'Main.daml': source })} />
        {activeParty && (
          <span className="ml-auto text-xs text-ink-muted">
            Viewing as {activeParty.displayName}
          </span>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 border-r border-stone">
          <DamlEditor value={source} onChange={setSource} />
        </div>

        <div className="flex w-96 flex-col overflow-y-auto bg-surface">
          <PartyPanel
            parties={parties}
            activeParty={activeParty}
            onPartyCreated={(p) => {
              setParties((prev) => [...prev, p])
              if (!activeParty) setActiveParty(p)
            }}
            onPartySelected={setActiveParty}
          />
          <ContractList partyId={activeParty?.id ?? null} refreshKey={refreshKey} />
          <CommandPanel
            parties={parties}
            onCommandSuccess={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify full build**

```bash
cd playground/web
npx tsc --noEmit
npx vite build
```

Expected: No errors, build output in `dist/`.

- [ ] **Step 3: Commit**

```bash
git add playground/web/src/routes/index.lazy.tsx
git commit -m "feat(playground): wire all components into playground page"
```

---

## Task 13: README and end-to-end test

**Files:**
- Create: `playground/README.md`

- [ ] **Step 1: Write README**

Create `playground/README.md`:

```markdown
# Daml Playground

An interactive browser-based environment for writing, compiling, and interacting
with Daml smart contracts on a live Canton sandbox.

## Prerequisites

- Docker and Docker Compose
- Node.js 20+

## Quick start

Start the Canton sandbox and compile service:

    cd playground
    docker compose up --build -d

Wait for the sandbox to be healthy (~20 seconds):

    docker compose ps

Start the web UI:

    cd web
    npm install
    npm run dev

Open http://localhost:5173 in your browser.

## Usage

1. Write Daml code in the editor (left panel).
2. Click **Deploy** to compile and upload your contracts to the sandbox.
3. Create parties in the right panel (e.g. "Alice", "Bob").
4. Use the command panel to create contracts and exercise choices.
5. Switch between parties to see contracts from different perspectives.

## Architecture

- **sandbox/**: Docker container running Canton sandbox (JSON API on :7575)
  and a Go compile service (:8081).
- **web/**: React app (Vite + TanStack Router + Tailwind) with Monaco editor
  and Canton API client.
- The Vite dev server proxies `/api/*` to the sandbox JSON API and `/compile`
  to the compile service.
```

- [ ] **Step 2: Manual end-to-end test**

```bash
# Terminal 1
cd playground && docker compose up --build -d

# Terminal 2
cd playground/web && npm install && npm run dev

# In browser at http://localhost:5173:
# 1. Default Hello template visible in editor
# 2. Click Deploy -> "Deployed" appears
# 3. Create party "Alice"
# 4. Command panel: Act as Alice, Template: #playground-project:Main:Hello
# 5. Args: {"owner": "<Alice's full party ID>"}
# 6. Click Submit -> "Contract created"
# 7. Contract appears in list
```

- [ ] **Step 3: Tear down**

```bash
cd playground && docker compose down
```

- [ ] **Step 4: Commit**

```bash
git add playground/README.md
git commit -m "docs(playground): add README with setup and usage instructions"
```

---

## Summary

| Task | What it produces | Commit |
|------|-----------------|--------|
| 1 | Go compile service with health endpoint | `feat(playground): add compile service skeleton` |
| 2 | Compile endpoint (build + upload DAR) | `feat(playground): add compile endpoint` |
| 3 | Dockerfile (Canton + compile service) | `feat(playground): add sandbox container` |
| 4 | docker-compose.yml for local dev | `feat(playground): add docker-compose` |
| 5 | Web scaffold (Vite + TanStack Router + Tailwind) | `feat(playground): add web scaffold` |
| 6 | Canton and compiler API clients | `feat(playground): add API clients` |
| 7 | Party panel component | `feat(playground): add party panel` |
| 8 | Contract list component | `feat(playground): add contract list` |
| 9 | Command panel component | `feat(playground): add command panel` |
| 10 | Compile status component | `feat(playground): add compile panel` |
| 11 | Monaco editor with Daml syntax | `feat(playground): add Monaco editor` |
| 12 | Full playground page wiring | `feat(playground): wire all components` |
| 13 | README + end-to-end test | `docs(playground): add README` |
