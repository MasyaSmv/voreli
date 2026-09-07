import { useTranslation } from "react-i18next";

import { LoginForm } from "../../features/auth/LoginForm";
import { BrandMark } from "../../shared/ui/BrandMark";
import { Icon } from "../../shared/ui/Icon";
import { LanguageSwitcher } from "../../shared/ui/LanguageSwitcher";

export function LoginPage() {
  const { t } = useTranslation();

  return (
    <main className="relative min-h-dvh overflow-y-auto bg-canvas">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-52 -top-52 h-[34rem] w-[34rem] rounded-full bg-accent/15 blur-[120px]" />
        <div className="absolute -bottom-64 right-[-10rem] h-[38rem] w-[38rem] rounded-full bg-highlight/8 blur-[140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      </div>

      <div className="absolute right-5 top-5 z-10">
        <LanguageSwitcher />
      </div>

      <div className="relative mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-12 px-6 py-10 lg:grid-cols-[1.15fr_.85fr] lg:px-10">
        <section
          className="animate-voreli-rise mx-auto max-w-xl lg:mx-0"
          aria-labelledby="welcome-title"
        >
          <BrandMark />
          <div className="mt-12">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/8 px-3 py-1.5 text-xs font-semibold tracking-wide text-accent-bright">
              <Icon name="spark" className="h-3.5 w-3.5" />
              {t("login.eyebrow")}
            </p>
            <h1
              id="welcome-title"
              className="max-w-lg text-4xl font-bold leading-[1.08] tracking-[-0.045em] text-ink sm:text-5xl"
            >
              {t("login.title")}{" "}
              <span className="bg-gradient-to-r from-accent-bright to-highlight bg-clip-text text-transparent">
                {t("login.titleAccent")}
              </span>
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-muted">{t("login.description")}</p>
          </div>

          <div className="mt-10 hidden grid-cols-3 gap-3 sm:grid">
            {[
              ["01", t("login.benefits.data")],
              ["02", t("login.benefits.voice")],
              ["03", t("login.benefits.privacy")],
            ].map(([number, label]) => (
              <div key={number} className="border-l border-line pl-4">
                <span className="block text-xs font-semibold text-accent-bright">{number}</span>
                <span className="mt-1 block text-sm text-ink-soft">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="animate-voreli-rise mx-auto w-full max-w-md [animation-delay:90ms]">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
