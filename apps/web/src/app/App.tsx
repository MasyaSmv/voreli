import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../entities/session/session.store";
import { LoginPage } from "../pages/login/LoginPage";
import { WorkspacePage } from "../pages/workspace/WorkspacePage";
import { BrandMark } from "../shared/ui/BrandMark";
import { Spinner } from "../shared/ui/Spinner";

/**
 * Routing is a single branch on purpose: until there is more than one screen behind login,
 * a router would be ceremony. It arrives when deep links to a channel do.
 */
export function App() {
  const { t } = useTranslation();
  const user = useSession((state) => state.user);
  const restoring = useSession((state) => state.restoring);
  const restore = useSession((state) => state.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  if (restoring) {
    return (
      <main className="grid min-h-dvh place-items-center bg-canvas">
        <div className="flex flex-col items-center gap-5">
          <BrandMark />
          <Spinner label={t("app.restoringSession")} className="h-5 w-5 text-accent-bright" />
        </div>
      </main>
    );
  }

  return user === null ? <LoginPage /> : <WorkspacePage />;
}
