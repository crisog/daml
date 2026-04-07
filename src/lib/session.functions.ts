import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { getSession } from "@/lib/auth.functions";

export interface UserSessionData {
  source: string;
  partyNames: string[];
  deployed: boolean;
}

export const loadUserSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<UserSessionData | null> => {
    const session = await getSession();
    if (!session) return null;
    const sessionDO = env.SESSION.getByName(session.user.id);
    return sessionDO.loadUserSession();
  }
);

export const saveUserSessionFn = createServerFn({ method: "POST" })
  .inputValidator((data: UserSessionData) => data)
  .handler(async ({ data }) => {
    const session = await getSession();
    if (!session) return;
    const sessionDO = env.SESSION.getByName(session.user.id);
    await sessionDO.saveUserSession(data);
  });
