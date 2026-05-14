import { useEffect } from "react";
import { CHROME_STORE_URL } from "../config";

interface ConfirmTipModalProps {
  open: boolean;
  onClose: () => void;
  amountUsd: string;
  handle: string;
  tweetId: string;
  /** When set, primary action is "Send tip" and executes on web (no redirect to extension) */
  onConfirm?: () => void | Promise<void>;
  /** Show loading state while onConfirm is in progress */
  sending?: boolean;
  /** Error message from tip submission */
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

  const postUrl = `https://x.com/${handle}/status/${tweetId}`;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-tip-title"
      onClick={(e) => e.target === e.currentTarget && !sending && onClose()}
    >
      <div className="modal-panel modal-panel--confirm">
        <h2 id="confirm-tip-title" className="modal-title">
          Confirm tip
        </h2>
        <p className="modal-tip-summary">
          <strong>${amountUsd}</strong> USD to @{handle}
        </p>
        {error && <p className="modal-error" style={{ color: "var(--text-muted)", fontSize: "var(--text-small)", marginTop: 4 }}>{error}</p>}
        {onConfirm ? (
          <p className="modal-hint">This will send the tip from your Teep balance. Tip easily on X with the Teep extension installed.</p>
        ) : (
          <p className="modal-hint">Complete this tip in the Teep extension on the post.</p>
        )}
        <div className="modal-actions">
          {onConfirm ? (
            <>
              <button
                type="button"
                onClick={() => onConfirm()}
                disabled={sending}
                className="btn-primary modal-btn-primary"
              >
                {sending ? "Sending…" : "Send tip"}
              </button>
              <a href={postUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary modal-btn-secondary">
                View post on X
              </a>
            </>
          ) : (
            <>
              <a href={postUrl} target="_blank" rel="noopener noreferrer" className="btn-primary modal-btn-primary">
                Open post on X to tip
              </a>
              <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary modal-btn-secondary">
                Install extension
              </a>
            </>
          )}
          <button type="button" onClick={onClose} className="modal-link" disabled={sending}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
