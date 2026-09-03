import { useState } from "react";

import { useSession } from "../../entities/session/session.store";

type Mode = "login" | "register";

/**
 * Login and registration in one form.
 *
 * Registration asks for an invite code, a name and a password — nothing else. That is the
 * product requirement: every extra field is a person who does not finish.
 */
export function LoginForm() {
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
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6"
    >
      <div>
        <h1 className="text-lg font-semibold text-white">Voreli</h1>
        <p className="mt-1 text-sm text-white/50">
          {mode === "login" ? "Вход" : "Регистрация по приглашению"}
        </p>
      </div>

      {mode === "register" ? (
        <Field
          label="Код приглашения"
          value={inviteCode}
          onChange={setInviteCode}
          autoComplete="off"
        />
      ) : null}

      <Field label="Имя" value={username} onChange={setUsername} autoComplete="username" />
      <Field
        label="Пароль"
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
      />

      {error === null ? null : (
        <p data-testid="auth-error" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-white/90 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
      >
        {mode === "login" ? "Войти" : "Создать аккаунт"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError(null);
        }}
        className="w-full text-sm text-white/50 underline-offset-4 hover:underline"
      >
        {mode === "login" ? "У меня есть приглашение" : "У меня уже есть аккаунт"}
      </button>
    </form>
  );
}

interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly autoComplete?: string;
}

function Field({ label, value, onChange, type = "text", autoComplete }: FieldProps) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-white/50">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
      />
    </label>
  );
}

/** Turns the server's error code into something a person can act on. */
function messageFor(caught: unknown): string {
  const code =
    typeof caught === "object" && caught !== null && "errorCode" in caught
      ? String(caught.errorCode)
      : "";

  switch (code) {
    case "INVALID_CREDENTIALS":
      return "Неверное имя или пароль";
    case "USERNAME_TAKEN":
      return "Это имя уже занято";
    case "INVITE_NOT_FOUND":
      return "Приглашение не найдено";
    case "INVITE_EXPIRED":
      return "Срок приглашения истёк";
    case "INVITE_EXHAUSTED":
      return "Приглашение исчерпано";
    default:
      return "Не получилось. Попробуйте ещё раз";
  }
}
