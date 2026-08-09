/** Generic confirm, plus the three-way unsaved-changes prompt — docs/09 §6. */
import { Dialog } from './Dialog';

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'OK',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <Dialog title={title} onCancel={onCancel} onConfirm={onConfirm} confirmLabel={confirmLabel}>
      <p>{message}</p>
    </Dialog>
  );
}

export function UnsavedDialog({
  name,
  onSave,
  onDiscard,
  onCancel,
}: {
  name: string;
  onSave(): void;
  onDiscard(): void;
  onCancel(): void;
}) {
  return (
    <Dialog
      title="Unsaved changes"
      onCancel={onCancel}
      onConfirm={onSave}
      confirmLabel="Save"
      extraActions={
        <button className="btn btn--danger" onClick={onDiscard}>
          Discard
        </button>
      }
    >
      <p>“{name}” has unsaved changes.</p>
    </Dialog>
  );
}
