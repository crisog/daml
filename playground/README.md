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
