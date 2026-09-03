import { useEffect } from "react";

import { useSession } from "../entities/session/session.store";
import { LoginPage } from "../pages/login/LoginPage";
import { WorkspacePage } from "../pages/workspace/WorkspacePage";

/**
 * Routing is a single branch on purpose: until there is more than one screen behind login,
 * a router would be ceremony. It arrives when deep links to a channel do.
 */
export function App() {
  const user = useSession((state) => state.user);
  const restoring = useSession((state) => state.restoring);
  const restore = useSession((state) => state.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  if (restoring) {
    return <main className="grid min-h-dvh place-items-center bg-neutral-950 text-white/40" />;
  }

  return user === null ? <LoginPage /> : <WorkspacePage />;
}
