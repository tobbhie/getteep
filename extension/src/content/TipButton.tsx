import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { computeContentId } from "../utils/contentId";
import { fetchTipData, formatUSDC } from "../utils/api";
import { TIP_PRESETS, CONFIG } from "../utils/config";
import { debugLog } from "../utils/debug";

interface TipButtonProps {
  tweetId: string;
  authorHandle: string;
}

type TipState = "idle" | "selecting" | "confirming" | "sending" | "success" | "error";

export const TipButton: React.FC<TipButtonProps> = ({ tweetId, authorHandle }) => {
  const [state, setState] = useState<TipState>("idle");
  const [totalTipped, setTotalTipped] = useState<string>("0");
  const [tipCount, setTipCount] = useState<number>(0);
  const [selectedAmount, setSelectedAmount] = useState<number>(1);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [customError, setCustomError] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [cachedBalance, setCachedBalance] = useState<string | null>(null);
  const [balanceLoadedAt, setBalanceLoadedAt] = useState<number | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const confirmInFlightRef = useRef(false);

  const contentId = computeContentId(authorHandle, tweetId);

  const tipLinkUrl = `${CONFIG.WEB_APP_URL}/t/${authorHandle.replace(/^@/, "")}/${tweetId}`;
  const applyTipTotals = useCallback((totalAmount: string, count: number) => {
    chrome.storage.local.get(["localDomTipTotals"], (stored) => {
      const localTotals = stored.localDomTipTotals || {};
      const local = localTotals[contentId];
      const isFresh = local?.updatedAt && Date.now() - Number(local.updatedAt) < 30 * 60 * 1000;
      const localAmount = isFresh ? Number(local?.amount || 0) : 0;
      const localCount = isFresh ? Number(local?.count || 0) : 0;
      if (local && !isFresh) {
        const nextTotals = { ...localTotals };
        delete nextTotals[contentId];
        chrome.storage.local.set({ localDomTipTotals: nextTotals });
      }
      setTotalTipped((Number(totalAmount || 0) + localAmount).toString());
      setTipCount(count + localCount);
    });
  }, [contentId]);

  const handleCopyTipLink = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(tipLinkUrl).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }).catch(() => {});
  }, [tipLinkUrl]);

  // Fetch existing tip total
  useEffect(() => {
    fetchTipData(contentId)
      .then((data) => {
        applyTipTotals(data.totalAmount, data.tipCount);
      })
      .catch(() => {});
  }, [applyTipTotals, contentId]);

  useEffect(() => {
    let cancelled = false;
    chrome.runtime.sendMessage({ type: "GET_CURRENT_USER_TIPPER_SETTINGS" }, (res: { defaultTipAmount?: number }) => {
      if (cancelled) return;
      const amount = Number(res?.defaultTipAmount || 0);
      if (Number.isFinite(amount) && amount > 0) {
        setSelectedAmount(amount);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Position the panel relative to the button; show above if not enough space below
  const PANEL_ESTIMATE_HEIGHT = 340;
  const PANEL_WIDTH = 250;
  const GAP = 6;
  const updatePanelPosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const preferAbove = spaceBelow < PANEL_ESTIMATE_HEIGHT + GAP;
    const left = Math.max(8, Math.min(rect.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8)) + window.scrollX;
    let top: number;
    if (preferAbove) {
      top = rect.top + window.scrollY - PANEL_ESTIMATE_HEIGHT - GAP;
      top = Math.max(GAP + window.scrollY, top);
    } else {
      top = rect.bottom + window.scrollY + GAP;
    }
    setPanelPos({ top, left });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (state !== "selecting" && state !== "confirming") return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) return;
      setState("idle");
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [state]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (state !== "selecting" && state !== "confirming") return;
    updatePanelPosition();
    const handler = () => updatePanelPosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [state, updatePanelPosition]);

  const handleTipClick = useCallback(() => {
    if (state === "idle") {
      updatePanelPosition();
      setState("selecting");
    } else {
      setState("idle");
    }
  }, [state, updatePanelPosition]);

  // Preload balance when modal opens so amount selection feels instant
  useEffect(() => {
    if (state !== "selecting") return;
    let cancelled = false;
    chrome.runtime.sendMessage({ type: "GET_CURRENT_USER_USDC_BALANCE" }, (res: { balance?: string; error?: string }) => {
      if (cancelled) return;
      if (res?.balance !== undefined) {
        setCachedBalance(res.balance);
        setBalanceLoadedAt(Date.now());
      }
    });
    return () => { cancelled = true; };
  }, [state]);

  const handleAmountSelect = useCallback((amount: number) => {
    setCustomError("");
    setSelectedAmount(amount);
    setState("confirming");
  }, []);

  const handleCustomSubmit = useCallback(() => {
    const val = parseFloat(customAmount);
    if (isNaN(val) || val <= 0) {
      setCustomError("Enter a valid amount");
      return;
    }
    if (val < CONFIG.MIN_TIP_USDC) {
      setCustomError(`Min $${CONFIG.MIN_TIP_USDC}`);
      return;
    }
    setCustomError("");
    setSelectedAmount(val);
    setState("confirming");
  }, [customAmount]);

  // Listen for tip transaction result via chrome.storage (set by the signing window)
  useEffect(() => {
    if (state !== "sending") return;

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      const activeRequestId = activeRequestIdRef.current;
      const requestResultKey = activeRequestId ? `tipResult:${activeRequestId}` : "";
      const result = (requestResultKey && changes[requestResultKey]?.newValue) || changes.tipResult?.newValue;
      if (!result || result.contentId !== contentId) return;
      if (activeRequestId && result.requestId && result.requestId !== activeRequestId) return;

      if (result.success) {
        activeRequestIdRef.current = null;
        confirmInFlightRef.current = false;
        setState("success");
        const tipAmount = result.amount ? Number(result.amount) * 1_000_000 : selectedAmount * 1_000_000;
        const newTotal = (Number(totalTipped) + tipAmount).toString();
        setTotalTipped(newTotal);
        setTipCount((c) => c + 1);
        chrome.storage.local.get(["localDomTipTotals"], (stored) => {
          const localTotals = stored.localDomTipTotals || {};
          const existing = localTotals[contentId] || { amount: 0, count: 0, updatedAt: 0 };
          chrome.storage.local.set({
            localDomTipTotals: {
              ...localTotals,
              [contentId]: {
                amount: Number(existing.amount || 0) + tipAmount,
                count: Number(existing.count || 0) + 1,
                updatedAt: Date.now(),
              },
            },
          });
        });
        setTimeout(() => setState("idle"), 2500);

        // Broadcast to other TipButtons on the page
        document.dispatchEvent(new CustomEvent("teep:tip-completed", {
          detail: { contentId, amount: tipAmount },
        }));
      } else {
        activeRequestIdRef.current = null;
        confirmInFlightRef.current = false;
        setErrorMsg(result.error || "Transaction failed");
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      }
      // Clean up result from storage
      chrome.storage.local.remove(requestResultKey ? [requestResultKey, "tipResult"] : "tipResult");
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [state, contentId, totalTipped, selectedAmount]);

  // Listen for broadcasts from other TipButton instances
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.contentId === contentId && state !== "sending") {
        // Another instance already tipped this — update optimistically
        setTotalTipped((prev) => (Number(prev) + Number(detail.amount)).toString());
        setTipCount((c) => c + 1);
      }
    };
    document.addEventListener("teep:tip-completed", handler);
    return () => document.removeEventListener("teep:tip-completed", handler);
  }, [contentId, state]);

  // After any tip on the page, schedule a backend re-fetch to sync with the indexer
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        fetchTipData(contentId)
          .then((data) => {
            applyTipTotals(data.totalAmount, data.tipCount);
          })
          .catch(() => {});
      }, 15000); // 15s — give the indexer time to process the block
    };
    document.addEventListener("teep:tip-completed", handler);
    return () => {
      document.removeEventListener("teep:tip-completed", handler);
      if (timerId) clearTimeout(timerId);
    };
  }, [applyTipTotals, contentId]);

  const handleConfirm = useCallback(async () => {
    if (confirmInFlightRef.current || state === "sending") return;
    confirmInFlightRef.current = true;
    setErrorMsg("");
    const rawAmount = Math.floor(selectedAmount * 1_000_000);
    const cacheAge = balanceLoadedAt != null ? Date.now() - balanceLoadedAt : Infinity;
    const useCache = cachedBalance != null && cacheAge <= 2000;
    if (!useCache) {
      const res = await new Promise<{ balance?: string; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ type: "GET_CURRENT_USER_USDC_BALANCE" }, resolve);
      });
      if (res?.error || res?.balance === undefined) {
        setErrorMsg("Could not check balance. Open Teep popup to connect.");
        setState("error");
        confirmInFlightRef.current = false;
        setTimeout(() => setState("idle"), 3000);
        return;
      }
      if (BigInt(res.balance) < BigInt(rawAmount)) {
        setErrorMsg("Insufficient funds to tip");
        setState("error");
        confirmInFlightRef.current = false;
        setTimeout(() => setState("idle"), 3000);
        return;
      }
      setCachedBalance(res.balance ?? null);
      setBalanceLoadedAt(Date.now());
    } else if (BigInt(cachedBalance!) < BigInt(rawAmount)) {
      setErrorMsg("Insufficient funds to tip");
      setState("error");
      confirmInFlightRef.current = false;
      setTimeout(() => setState("idle"), 3000);
      return;
    }
    setState("sending");
    const tipRequestPayload = { contentId, amount: selectedAmount, tweetId, authorHandle };
    debugLog("TipContent", "Sending TIP_REQUEST to background", tipRequestPayload);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "TIP_REQUEST",
        payload: tipRequestPayload,
      });
      debugLog("TipContent", "TIP_REQUEST response received", response);

      if (response?.pending) {
        if (response.requestId) activeRequestIdRef.current = response.requestId;
        // Signing window opened — wait for result via storage listener above
        return;
      }

      // Immediate error (wallet not connected, allowance check failed, etc.)
      if (response?.error) {
        setErrorMsg(response.error);
        setState("error");
        confirmInFlightRef.current = false;
        setTimeout(() => setState("idle"), 3000);
      } else if (response === undefined) {
        debugLog("TipContent", "TIP_REQUEST got undefined response — background may have closed or not responded");
        setErrorMsg("No response. Open the Teep popup once, then try again.");
        setState("error");
        confirmInFlightRef.current = false;
        setTimeout(() => setState("idle"), 3000);
      }
    } catch (err: any) {
      debugLog("TipContent", "TIP_REQUEST catch", { message: err?.message, err });
      setErrorMsg(err.message || "Unknown error");
      setState("error");
      confirmInFlightRef.current = false;
      setTimeout(() => setState("idle"), 3000);
    }
  }, [state, contentId, selectedAmount, tweetId, authorHandle, cachedBalance, balanceLoadedAt]);

  const isOpen = state === "selecting" || state === "confirming";

  const coinIcon = (
    <svg viewBox="0 0 24 24" width="18.5" height="18.5" fill="none" style={{ display: "block" }}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor" fontFamily="Arial, sans-serif">$</text>
    </svg>
  );

  // Backdrop (blur) + panel when tip modal is open — focus user on the modal
  const panel = isOpen && panelPos ? createPortal(
    <>
      <div
        role="presentation"
        style={S.backdrop}
        onClick={() => setState("idle")}
      />
      <div
        ref={panelRef}
        style={{
          ...S.panel,
          top: panelPos.top,
          left: panelPos.left,
          maxHeight: `min(${PANEL_ESTIMATE_HEIGHT}px, calc(100vh - ${GAP * 2}px))`,
          overflowY: "auto",
        }}
      >
      {state === "selecting" && (
        <>
          <div style={S.panelTitle}>Tip @{authorHandle}</div>
          {cachedBalance != null && (
            <div style={S.balanceRow}>Balance: {formatUSDC(cachedBalance)}</div>
          )}
          <button
            type="button"
            onClick={handleCopyTipLink}
            style={S.copyLinkRow}
            title="Paste in post or bio so others can tip"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span style={{ color: linkCopied ? "#00ba7c" : "#71767b", fontSize: "12px" }}>
              {linkCopied ? "Copied!" : "Copy tip link"}
            </span>
          </button>
          <div style={S.grid}>
            {TIP_PRESETS.map((amount) => (
              <button
                key={amount}
                onClick={() => handleAmountSelect(amount)}
                style={S.amountBtn}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.background = "#1d9bf0";
                  el.style.color = "#fff";
                  el.style.borderColor = "#1d9bf0";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.background = "transparent";
                  el.style.color = "#e7e9ea";
                  el.style.borderColor = "#333639";
                }}
              >
                ${amount}
              </button>
            ))}
          </div>
          <div style={S.divider}>
            <span style={S.dividerText}>or custom</span>
          </div>
          <div style={S.customRow}>
            <span style={S.customDollar}>$</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder={`${CONFIG.MIN_TIP_USDC}+`}
              value={customAmount}
              onChange={(e) => {
                setCustomAmount(e.target.value);
                setCustomError("");
              }}
              onKeyDown={(e) => { if (e.key === "Enter") handleCustomSubmit(); }}
              style={S.customInput}
            />
            <button onClick={handleCustomSubmit} style={S.customGoBtn}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          </div>
          {customError && <div style={S.customErr}>{customError}</div>}
        </>
      )}

      {state === "confirming" && (
        <>
          <div style={S.panelTitle}>
            Send <span style={{ color: "#1d9bf0" }}>${selectedAmount}</span> USD
          </div>
          <div style={S.panelSub}>to @{authorHandle}</div>
          <div style={S.confirmRow}>
            <button onClick={handleConfirm} disabled={confirmInFlightRef.current} style={S.confirmBtn}>Confirm</button>
            <button onClick={() => setState("selecting")} style={S.backBtn}>Back</button>
          </div>
        </>
      )}
      </div>
    </>,
    document.body
  ) : null;

  // Error toast — also portaled
  const errorToast = state === "error" && panelPos ? createPortal(
    <div style={{ ...S.toast, top: panelPos.top, left: Math.max(8, panelPos.left) }}>
      {errorMsg || "Something went wrong"}
    </div>,
    document.body
  ) : null;

  return (
    <div data-teep="true" style={S.wrap}>
      <button
        ref={btnRef}
        onClick={handleTipClick}
        style={{
          ...S.btn,
          color:
            state === "success" ? "#00ba7c"
            : state === "sending" ? "#f6a623"
            : isOpen ? "#1d9bf0"
            : "#71767b",
        }}
        title={`Tip @${authorHandle} with USD`}
      >
        <span style={S.iconWrap}>{coinIcon}</span>
        <span style={S.tipLabel}>Tip</span>
        {(tipCount > 0 || state === "success" || state === "sending") && (
          <span style={S.btnLabel}>
            {state === "success" ? "Sent!"
              : state === "sending" ? "..."
              : totalTipped !== "0" ? formatUSDC(totalTipped)
              : ""}
          </span>
        )}
      </button>
      {panel}
      {errorToast}
    </div>
  );
};

const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const S: Record<string, React.CSSProperties> = {
  wrap: {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    verticalAlign: "middle",
  },
  btn: {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    padding: "2px 6px 4px",
    minHeight: "34px",
    border: "none",
    borderRadius: "9999px",
    background: "transparent",
    fontSize: "13px",
    fontWeight: 400,
    cursor: "pointer",
    transition: "color 0.2s",
    fontFamily: font,
    outline: "none",
    lineHeight: 1,
  },
  iconWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderRadius: "9999px",
  },
  tipLabel: {
    fontSize: "11px",
    lineHeight: 1,
    fontWeight: 400,
  },
  btnLabel: {
    fontSize: "11px",
    lineHeight: 1,
  },
  copyLinkRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 0",
    marginBottom: "8px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: font,
    outline: "none",
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    zIndex: 2147483646,
    cursor: "pointer",
  },
  /* Portaled panel — fixed to viewport via absolute on body */
  panel: {
    position: "absolute",
    width: "250px",
    background: "#000",
    border: "1px solid #2f3336",
    borderRadius: "16px",
    padding: "16px",
    boxShadow: "0 0 20px rgba(255,255,255,0.05), 0 8px 40px rgba(0,0,0,0.8)",
    zIndex: 2147483647, // max z-index — above everything
    fontFamily: font,
  },
  panelTitle: {
    fontSize: "15px",
    fontWeight: 700,
    color: "#e7e9ea",
    marginBottom: "4px",
  },
  balanceRow: {
    fontSize: "12px",
    color: "#71767b",
    marginBottom: "8px",
  },
  panelSub: {
    fontSize: "13px",
    color: "#71767b",
    marginBottom: "12px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
    marginTop: "12px",
  },
  amountBtn: {
    padding: "10px 0",
    border: "1px solid #333639",
    borderRadius: "12px",
    background: "transparent",
    color: "#e7e9ea",
    fontSize: "15px",
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: font,
    outline: "none",
    textAlign: "center" as const,
  },
  confirmRow: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  },
  confirmBtn: {
    width: "100%",
    padding: "10px",
    border: "none",
    borderRadius: "9999px",
    background: "#1d9bf0",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: font,
    outline: "none",
  },
  backBtn: {
    width: "100%",
    padding: "8px",
    border: "none",
    borderRadius: "9999px",
    background: "transparent",
    color: "#71767b",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: font,
    outline: "none",
  },
  /* Custom amount */
  divider: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: "10px 0 8px",
  },
  dividerText: {
    fontSize: "11px",
    color: "#536471",
    whiteSpace: "nowrap" as const,
    width: "100%",
    textAlign: "center" as const,
  },
  customRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    background: "#16181c",
    borderRadius: "10px",
    border: "1px solid #333639",
    padding: "4px 8px",
  },
  customDollar: {
    fontSize: "15px",
    fontWeight: 700,
    color: "#71767b",
  },
  customInput: {
    flex: 1,
    border: "none",
    background: "transparent",
    color: "#e7e9ea",
    fontSize: "15px",
    fontWeight: 700,
    outline: "none",
    fontFamily: font,
    width: "0",
    padding: "6px 0",
  },
  customGoBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    borderRadius: "8px",
    border: "none",
    background: "#1d9bf0",
    color: "#fff",
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
  },
  customErr: {
    fontSize: "11px",
    color: "#f4212e",
    marginTop: "4px",
    textAlign: "center" as const,
  },

  toast: {
    position: "absolute",
    width: "250px",
    background: "#1c1117",
    border: "1px solid #67000d",
    borderRadius: "12px",
    padding: "10px 14px",
    color: "#f4212e",
    fontSize: "13px",
    fontFamily: font,
    zIndex: 2147483647,
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  },
};
