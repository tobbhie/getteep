type TeepTipModalProps = {
  open: boolean;
  title: string;
  modeLabel: string;
  recipientLabel: string;
  context: string;
  amount: string;
  confirmLabel: string;
  sending?: boolean;
  error?: string | null;
  readOnlyAmount?: boolean;
  onAmountChange: (amount: string) => void;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

export default function TeepTipModal({
  open,
  title,
  modeLabel,
  recipientLabel,
  context,
  amount,
  confirmLabel,
  sending = false,
  error,
  readOnlyAmount = false,
  onAmountChange,
  onConfirm,
  onClose,
}: TeepTipModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="teep-tip-modal-title">
      <div className="modal-panel dashboard-direct-tip-modal dashboard-post-tip-modal">
        <button type="button" className="dashboard-modal-close" onClick={onClose} aria-label="Close tip modal" disabled={sending}>
          <span className="material-symbols-outlined" aria-hidden>close</span>
        </button>
        <div className="dashboard-post-tip-kicker">
          <span className="material-symbols-outlined" aria-hidden>send</span>
          {modeLabel}
        </div>
        <h2 id="teep-tip-modal-title" className="modal-title">{title}</h2>
        <div className="dashboard-post-tip-context">
          <strong>{recipientLabel}</strong>
          <span>{context}</span>
        </div>
        <label className="dashboard-direct-tip-field">
          <span>Amount (USD)</span>
          <div className="dashboard-amount-input">
            <span aria-hidden>$</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => onAmountChange(event.target.value)}
              readOnly={readOnlyAmount}
              autoFocus
            />
          </div>
        </label>
        {error && <p className="dashboard-direct-tip-error">{error}</p>}
        <div className="modal-actions dashboard-post-tip-actions">
          <button type="button" className="btn-primary" onClick={onConfirm} disabled={sending}>
            {sending ? "Sending..." : confirmLabel}
          </button>
          <button type="button" className="dashboard-modal-cancel" onClick={onClose} disabled={sending}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
