import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { buildFundingPolicy } from "@teep/shared";
import { ENABLE_FIAT_OFFRAMP, ENABLE_FIAT_ONRAMP, FAUCET_URL, FUNDING_ENV, OFFRAMP_URL, ONRAMP_URL } from "../config";

interface RechargePromptProps {
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
  amountUsd: string;
  handle: string;
  /** When true (e.g. hero tipping flow), show Add funds in-modal with options dropdown (same as extension) */
  embedFunding?: boolean;
  /** Wallet address for onramp/faucet/deposit; when missing, options still shown but link to dashboard */
  walletAddress?: string | null;
  /** When retrying balance check: "checking" = show spinner, "insufficient" = show retryMessage */
  retryStatus?: "idle" | "checking" | "insufficient";
  /** Shown when retryStatus === "insufficient" after clicking "I've added funds" */
  retryMessage?: string | null;
}

export default function RechargePrompt({
  open,
  onClose,
  onRetry,
  amountUsd,
  handle,
  embedFunding = false,
  walletAddress,
  retryStatus = "idle",
  retryMessage,
}: RechargePromptProps) {
  const [fundingDropdownOpen, setFundingDropdownOpen] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState("");
  const [depositCopyFeedback, setDepositCopyFeedback] = useState(false);
  const fundingPolicy = buildFundingPolicy({
    environment: FUNDING_ENV,
    faucetUrl: FAUCET_URL,
    fiatOnrampUrl: ONRAMP_URL,
    fiatOfframpUrl: OFFRAMP_URL,
    enableFiatOnramp: ENABLE_FIAT_ONRAMP,
    enableFiatOfframp: ENABLE_FIAT_OFFRAMP,
  });

  const handleFaucet = useCallback(async () => {
    if (!walletAddress) return;
    if (!fundingPolicy.providers.faucet.enabled || !fundingPolicy.providers.faucet.url) {
      setFaucetMsg(fundingPolicy.providers.faucet.disabledReason || "Faucet funding is not available.");
      setTimeout(() => setFaucetMsg(""), 5000);
      return;
    }
    setFaucetLoading(true);
    setFaucetMsg("Copying wallet address...");
    try {
      await navigator.clipboard.writeText(walletAddress);
      setDepositCopyFeedback(true);
      setFundingDropdownOpen(false);
      setFaucetMsg("Address copied. Opening Circle faucet...");
      window.open(fundingPolicy.providers.faucet.url, "_blank", "noopener,noreferrer");
      setTimeout(() => setDepositCopyFeedback(false), 1500);
    } catch (err: unknown) {
      setFaucetMsg(err instanceof Error ? err.message : "Could not copy address");
    }
    setFaucetLoading(false);
    setTimeout(() => setFaucetMsg(""), 5000);
  }, [walletAddress, fundingPolicy]);

  const handleCopyAddress = useCallback(() => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress).then(() => {
      setDepositCopyFeedback(true);
      setFundingDropdownOpen(false);
      setTimeout(() => setDepositCopyFeedback(false), 1500);
    });
  }, [walletAddress]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setFundingDropdownOpen(false);
      setFaucetMsg("");
    }
  }, [open]);

  if (!open) return null;

  const onrampUrl = walletAddress && fundingPolicy.providers.fiatOnramp.enabled && fundingPolicy.providers.fiatOnramp.url
    ? fundingPolicy.providers.fiatOnramp.url.replace("WALLET", walletAddress)
    : null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recharge-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-panel modal-panel--recharge">
        <h2 id="recharge-title" className="modal-title">
          Add funds to continue
        </h2>
        <p className="modal-subtitle">
          You’re tipping <strong>${amountUsd}</strong> to @{handle}. Add at least ${amountUsd} to your Teep balance to send this tip.
        </p>

        {embedFunding ? (
          <div className="recharge-funding-dropdown-wrap">
            <div className="recharge-funding-dropdown">
              <button
                type="button"
                className="btn-primary modal-btn-primary recharge-funding-trigger"
                onClick={() => setFundingDropdownOpen((o) => !o)}
                aria-expanded={fundingDropdownOpen}
                aria-haspopup="true"
              >
                Add funds
                <span className="recharge-funding-chevron" aria-hidden>{fundingDropdownOpen ? "▲" : "▼"}</span>
              </button>
              {fundingDropdownOpen && (
                <div className="recharge-funding-menu" role="menu">
                  {onrampUrl ? (
                    <a href={onrampUrl} target="_blank" rel="noopener noreferrer" className="recharge-funding-item" role="menuitem">
                      {fundingPolicy.providers.fiatOnramp.label}
                    </a>
                  ) : (
                    <button type="button" className="recharge-funding-item recharge-funding-item--btn" role="menuitem" disabled title={fundingPolicy.providers.fiatOnramp.disabledReason}>
                      {fundingPolicy.providers.fiatOnramp.label} - unavailable
                    </button>
                  )}
                  {walletAddress ? (
                    <button
                      type="button"
                      onClick={() => { handleFaucet(); setFundingDropdownOpen(false); }}
                      disabled={faucetLoading || !fundingPolicy.providers.faucet.enabled}
                      className="recharge-funding-item recharge-funding-item--btn"
                      role="menuitem"
                      style={{ opacity: faucetLoading || !fundingPolicy.providers.faucet.enabled ? 0.6 : 1 }}
                    >
                      {faucetLoading ? "Opening..." : fundingPolicy.providers.faucet.label}
                    </button>
                  ) : (
                    <Link to="/dashboard" className="recharge-funding-item" role="menuitem" onClick={onClose}>
                      Get test funds from faucet - set up wallet in Dashboard first
                    </Link>
                  )}
                  {walletAddress ? (
                    <button
                      type="button"
                      onClick={handleCopyAddress}
                      className={`recharge-funding-item recharge-funding-item--btn ${depositCopyFeedback ? "recharge-funding-item--copied" : ""}`}
                      role="menuitem"
                    >
                      {depositCopyFeedback ? "Copied. Send to this address" : fundingPolicy.providers.cryptoReceive.label}
                    </button>
                  ) : (
                    <Link to="/dashboard" className="recharge-funding-item" role="menuitem" onClick={onClose}>
                      Receive from wallet (set up in Dashboard)
                    </Link>
                  )}
                </div>
              )}
            </div>
            {depositCopyFeedback && (
              <p className="recharge-copy-toast" role="status" aria-live="polite">
                Address copied to clipboard. Paste it in your wallet to send supported funds.
              </p>
            )}
            <p className="recharge-faucet-msg" style={{ color: "var(--text-muted)" }}>
              {fundingPolicy.testnetCopy}
            </p>
            {faucetMsg && (
              <p
                className="recharge-faucet-msg"
                style={{ color: faucetMsg.includes("received") ? "var(--accent)" : "var(--text-muted)" }}
                role="status"
              >
                {faucetMsg}
              </p>
            )}
          </div>
        ) : (
          <div className="modal-actions">
            <Link to="/dashboard" className="btn-primary modal-btn-primary" onClick={onClose}>
              Go to Dashboard to add funds
            </Link>
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            onClick={onRetry}
            disabled={retryStatus === "checking"}
            className="btn-secondary modal-btn-secondary"
          >
            {retryStatus === "checking" ? "Checking balance..." : "I've added funds - continue"}
          </button>
          {retryStatus === "insufficient" && retryMessage && (
            <p className="recharge-retry-message" role="status">
              {retryMessage}
            </p>
          )}
          <button type="button" onClick={onClose} className="modal-link">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
