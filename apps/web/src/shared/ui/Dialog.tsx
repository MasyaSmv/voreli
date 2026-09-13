import { useEffect, useRef, type ReactNode } from "react";

import { Icon } from "./Icon";

interface DialogProps {
  readonly title: string;
  readonly description?: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function Dialog({ title, description, closeLabel, onClose, children }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;

    if (!element) return;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
  }, []);

  return (
    <dialog
      ref={dialog}
      className="voreli-dialog m-auto w-[min(34rem,calc(100%-2rem))] rounded-card border border-line bg-panel-raised p-0 text-ink shadow-card"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-faint transition hover:bg-panel-hover hover:text-ink"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
