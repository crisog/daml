import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

interface AuthEnv {
  DB: D1Database;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
}

export function createAuth(env: AuthEnv) {
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },
    plugins: [tanstackStartCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
