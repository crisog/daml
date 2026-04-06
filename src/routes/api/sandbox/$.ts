import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "@/lib/auth";
import { env } from "cloudflare:workers";

async function proxyToSandbox(request: Request): Promise<Response> {
  const auth = createAuth(env);
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
