/** Canonical storage and lookup form of a public username. */
export function normalizeUsername(value: string): string {
  const trimmed = value.trim();

  return (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
}
