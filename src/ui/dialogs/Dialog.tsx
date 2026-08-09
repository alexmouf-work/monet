/** Modal shell: focus-trapped <dialog>, Esc cancels, Enter confirms — docs/09 §6. */
import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({
  title,
  children,
  onCancel,
  onConfirm,
  confirmLabel = 'OK',
  confirmDisabled,
  wide,
  extraActions,
}: {
  title: string;
  children: ReactNode;
  onCancel(): void;
  onConfirm?(): void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  wide?: boolean;
  extraActions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current!;
    if (!el.open) el.showModal();
    const first = el.querySelector<HTMLElement>(
      'input, select, textarea, button:not(.dialog__cancel)',
    );
    first?.focus();
  }, []);

  return (
    <dialog
      className={`dialog ${wide ? 'dialog--wide' : ''}`}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onConfirm && !confirmDisabled) {
          const t = e.target as HTMLElement;
          if (t.tagName !== 'TEXTAREA' && t.tagName !== 'BUTTON') {
            e.preventDefault();
            onConfirm();
          }
        }
      }}
    >
      <h2 className="dialog__title">{title}</h2>
      <div className="dialog__body">{children}</div>
      <div className="dialog__actions">
        {extraActions}
        <button className="btn dialog__cancel" onClick={onCancel}>
          Cancel
        </button>
        {onConfirm && (
          <button className="btn btn--primary" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </button>
        )}
      </div>
    </dialog>
  );
}
