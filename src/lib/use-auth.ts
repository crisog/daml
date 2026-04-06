import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: { id: string; name: string; email: string } }
  | { status: "unauthenticated" };

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (data?.session) {
        setState({
          status: "authenticated",
          user: {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
          },
        });
      } else {
        setState({ status: "unauthenticated" });
      }
    }).catch(() => {
      setState({ status: "unauthenticated" });
    });
  }, []);

  return state;
}
