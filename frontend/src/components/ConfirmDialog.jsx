import { useEffect, useId, useRef } from "react";

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Lanjutkan",
  cancelLabel = "Batal",
  busy = false,
  onConfirm,
  onCancel,
  children,
}) {
  const dialogRef = useRef(null);
  const id = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleCancel(event) {
    event.preventDefault();
    if (!busy) onCancel();
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={handleCancel}
      onClick={(event) => {
        if (event.target === dialogRef.current && !busy) onCancel();
      }}
    >
      <div className="confirm-dialog-content">
        <span className="section-kicker">KONFIRMASI</span>
        <h2 id={`${id}-title`}>{title}</h2>
        <p id={`${id}-description`}>{description}</p>
        {children}
        <div className="confirm-dialog-actions">
          <button className="button button-ghost" type="button" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="button button-danger" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? "Memproses..." : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
