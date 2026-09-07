interface SpinnerProps {
  readonly label?: string;
  readonly className?: string;
}

/** A small progress indicator; pass a label when no adjacent text describes the wait. */
export function Spinner({ label, className = "h-4 w-4" }: SpinnerProps) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center">
      <span
        aria-hidden="true"
        className={`${className} animate-spin rounded-full border-2 border-current border-r-transparent opacity-80`}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
