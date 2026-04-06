import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "@/lib/auth";
import { getCloudflareContext } from "@cloudflare/vite-plugin/context";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { env } = await getCloudflareContext();
        const auth = createAuth(env);
        return auth.handler(request);
      },
      POST: async ({ request }: { request: Request }) => {
        const { env } = await getCloudflareContext();
        const auth = createAuth(env);
        return auth.handler(request);
      },
    },
  },
});
