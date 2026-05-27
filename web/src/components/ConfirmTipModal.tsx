import { useEffect } from "react";
import { CHROME_STORE_URL } from "../config";
import TeepTipModal from "./TeepTipModal";

interface ConfirmTipModalProps {
  open: boolean;
  onClose: () => void;
  amountUsd: string;
  handle: string;
  tweetId: string;
  /** When set, primary action is "Send tip" and executes on web. */
  onConfirm?: () => void | Promise<void>;
  sending?: boolean;
  error?: string | null;
}

export default function ConfirmTipModal({
  open,
  onClose,
  amountUsd,
  handle,
  tweetId,
  onConfirm,
  sending = false,
  error,
}: ConfirmTipModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => e.key === "Escape" && !sending && onClose();
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose, sending]);

  if (!open) return null;

  const cleanHandle = handle.replace(/^@/, "");
  const postUrl = `https://x.com/${cleanHandle}/status/${tweetId}`;

  if (onConfirm) {
    return (
      <TeepTipModal
        open={open}
        title="Confirm tip"
        modeLabel="Post tip"
        recipientLabel={`@${cleanHandle}`}
        context="This will send the tip from your Teep balance and keep this X post as the receipt context."
        amount={amountUsd}
        onAmountChange={() => {}}
        readOnlyAmount
        confirmLabel="Send tip"
        sending={sending}
        error={error}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-tip-title"
      onClick={(e) => e.target === e.currentTarget && !sending && onClose()}
    >
      <div className="modal-panel modal-panel--confirm">
        <h2 id="confirm-tip-title" className="modal-title">Confirm tip</h2>
        <p className="modal-tip-summary">
          <strong>${amountUsd}</strong> USD to @{cleanHandle}
        </p>
        {error && <p className="modal-error" style={{ color: "var(--text-muted)", fontSize: "var(--text-small)", marginTop: 4 }}>{error}</p>}
        <p className="modal-hint">Complete this tip in the Teep extension on the post.</p>
        <div className="modal-actions">
          <a href={postUrl} target="_blank" rel="noopener noreferrer" className="btn-primary modal-btn-primary">
            Open post on X to tip
          </a>
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary modal-btn-secondary">
            Install extension
          </a>
          <button type="button" onClick={onClose} className="modal-link" disabled={sending}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
