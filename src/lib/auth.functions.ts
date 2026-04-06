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
