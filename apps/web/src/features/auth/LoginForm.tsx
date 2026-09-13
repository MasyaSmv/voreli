import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../../entities/session/session.store";
import { Icon } from "../../shared/ui/Icon";
import { Spinner } from "../../shared/ui/Spinner";

type Mode = "login" | "register";

/**
 * Login and registration in one form.
 *
 * Registration asks for an invite code, a name and a password — nothing else. That is the
 * product requirement: every extra field is a person who does not finish.
 */
export function LoginForm() {
  const { t } = useTranslation();
  const logIn = useSession((state) => state.logIn);
  const register = useSession((state) => state.register);

  const [mode, setMode] = useState<Mode>("login");
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (mode === "login") {
        await logIn(username, password);
      } else {
        await register(inviteCode, username, password);
      }
    } catch (caught) {
      setError(messageFor(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="w-full rounded-card border border-line bg-panel/95 p-6 shadow-card backdrop-blur-xl sm:p-8"
    >
      <div className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-bright">
          {mode === "login" ? t("login.welcomeBack") : t("login.welcome")}
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-ink">
          {mode === "login" ? t("login.signInTitle") : t("login.registerTitle")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          {mode === "login" ? t("login.signInDescription") : t("login.registerDescription")}
        </p>
      </div>

      <div className="space-y-4">
        {mode === "register" ? (
          <Field
            label={t("login.inviteCode")}
            value={inviteCode}
            onChange={setInviteCode}
            autoComplete="off"
            placeholder={t("login.invitePlaceholder")}
          />
        ) : null}

        <Field
          label={t("login.username")}
          value={username}
          onChange={setUsername}
          autoComplete="username"
          placeholder={t("login.usernamePlaceholder")}
        />
        <Field
          label={t("login.password")}
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder={t("login.passwordPlaceholder")}
        />
      </div>

      {error === null ? null : (
        <p
          data-testid="auth-error"
          role="alert"
          className="mt-4 rounded-xl border border-danger/20 bg-danger/8 px-3 py-2.5 text-sm text-danger-soft"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-accent transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-55"
      >
        {busy ? (
          <>
            <Spinner />
            {t("login.wait")}
          </>
        ) : mode === "login" ? (
          t("login.signIn")
        ) : (
          t("login.createAccount")
        )}
      </button>

      <div className="mt-6 flex items-center gap-3 text-xs text-faint" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        {t("login.or")}
        <span className="h-px flex-1 bg-line" />
      </div>

      <p className="mt-5 text-center text-sm text-muted">
        {mode === "login" ? t("login.firstTime") : t("login.alreadyRegistered")}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          className="font-semibold text-accent-bright underline-offset-4 hover:underline"
        >
          {mode === "login" ? t("login.enterInvite") : t("login.signIn")}
        </button>
      </p>

      <p className="mt-7 flex items-center justify-center gap-2 text-xs text-faint">
        <Icon name="radio" className="h-3.5 w-3.5 text-voice" />
        {t("login.secureConnection")}
      </p>
    </form>
  );
}

interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly autoComplete?: string;
  readonly placeholder?: string;
}

function Field({ label, value, onChange, type = "text", autoComplete, placeholder }: FieldProps) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="min-h-11 w-full rounded-xl border border-line bg-canvas/70 px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-faint hover:border-line-strong focus:border-accent/70 focus:bg-canvas"
      />
    </label>
  );
}

/** Turns the server's error code into something a person can act on. */
function messageFor(caught: unknown, t: TFunction): string {
  const code =
    typeof caught === "object" && caught !== null && "errorCode" in caught
      ? String(caught.errorCode)
      : "";

  switch (code) {
    case "INVALID_CREDENTIALS":
      return t("login.errors.invalidCredentials");
    case "USERNAME_TAKEN":
      return t("login.errors.usernameTaken");
    case "INVITE_NOT_FOUND":
      return t("login.errors.inviteNotFound");
    case "INVITE_EXPIRED":
      return t("login.errors.inviteExpired");
    case "INVITE_EXHAUSTED":
      return t("login.errors.inviteExhausted");
    default:
      return t("login.errors.unknown");
  }
}
