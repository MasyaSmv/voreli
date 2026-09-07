interface AvatarProps {
  readonly name: string;
  readonly url?: string | null;
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

const gradients = [
  "from-violet-400 to-indigo-600",
  "from-cyan-400 to-blue-600",
  "from-emerald-400 to-teal-600",
  "from-amber-300 to-orange-600",
  "from-fuchsia-400 to-purple-600",
] as const;

const sizes = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-14 w-14 text-base",
} as const;

export function Avatar({ name, url, size = "md", className = "" }: AvatarProps) {
  const common = `${sizes[size]} shrink-0 rounded-[35%] ${className}`;

  if (url) {
    return <img src={url} alt="" className={`${common} object-cover`} />;
  }

  return (
    <span
      aria-hidden="true"
      className={`grid place-items-center bg-gradient-to-br font-bold tracking-tight text-white shadow-inner ${gradientFor(name)} ${common}`}
    >
      {initials(name)}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);

  return (
    parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : name.slice(0, 2)
  ).toLocaleUpperCase("ru-RU");
}

function gradientFor(name: string): (typeof gradients)[number] {
  let hash = 0;

  for (const character of name) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }

  return gradients[hash % gradients.length] ?? gradients[0];
}
