import { Icon } from "./Icon";

export function BrandMark({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-2xl bg-accent text-white shadow-[0_10px_30px_rgba(124,108,246,0.28)]">
        <span className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,.38),transparent_38%)]" />
        <Icon name="radio" className="relative h-5 w-5" />
      </span>
      {compact ? null : (
        <span className="text-lg font-bold tracking-[-0.03em] text-ink">Voreli</span>
      )}
    </span>
  );
}
