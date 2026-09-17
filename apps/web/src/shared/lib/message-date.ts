export function sameLocalDay(first: string, second: string): boolean {
  const left = new Date(first);
  const right = new Date(second);

  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function formatMessageDay(value: string, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(value));
}

export function formatMessageTime(value: string, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

export function formatMessageTimestamp(value: string, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "medium" }).format(
    new Date(value),
  );
}
