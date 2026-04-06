import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getSession } from "@/lib/auth.functions";

export const Route = createFileRoute("/_protected")({
  beforeLoad: async ({ location }) => {
    const session = await getSession();

    if (!session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.pathname },
      });
    }

    return { user: session.user };
  },
  component: () => <Outlet />,
});
