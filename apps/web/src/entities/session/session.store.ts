import type { PublicUser } from "@voreli/shared";
import { create } from "zustand";

import { apiFetch, refreshAccessToken, setAccessToken } from "../../shared/api/http";
import { chatSocket, disconnectSocket } from "../../shared/api/socket";

interface SessionState {
  readonly user: PublicUser | null;
  /** True until the initial "am I already logged in" check finishes. */
  readonly restoring: boolean;
  logIn: (username: string, password: string) => Promise<void>;
  register: (inviteCode: string, username: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  restore: () => Promise<void>;
}

interface AuthPayload {
  readonly user: PublicUser;
  readonly accessToken: string;
}

export const useSession = create<SessionState>((set) => {
  function adopt(payload: AuthPayload): void {
    setAccessToken(payload.accessToken);
    set({ user: payload.user, restoring: false });
    chatSocket().connect();
  }

  return {
    user: null,
    restoring: true,

    async logIn(username, password) {
      adopt(
        await apiFetch<AuthPayload>("/auth/login", {
          method: "POST",
          body: { username, password },
        }),
      );
    },

    async register(inviteCode, username, password) {
      adopt(
        await apiFetch<AuthPayload>("/auth/register", {
          method: "POST",
          body: { inviteCode, username, password },
        }),
      );
    },

    async logOut() {
      await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
      setAccessToken(null);
      disconnectSocket();
      set({ user: null });
    },

    /**
     * On a fresh page load there is no access token in memory, but the refresh cookie may
     * still be valid — so the session is restored from it instead of asking to log in again.
     */
    async restore() {
      if (!(await refreshAccessToken())) {
        set({ user: null, restoring: false });

        return;
      }

      try {
        const me = await apiFetch<{ user: PublicUser }>("/auth/me");
        set({ user: me.user, restoring: false });
        chatSocket().connect();
      } catch {
        set({ user: null, restoring: false });
      }
    },
  };
});
