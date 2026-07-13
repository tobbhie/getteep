import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { parseUnits } from "viem";
import { arcTestnet } from "../chains";
import { API_BASE, USDC_ADDRESS } from "../config";
import { computeContentId, encodeApproveCall, encodeTipCall, TIP_CONTRACT_ADDRESS } from "../lib/contracts";
import ConfirmTipModal from "../components/ConfirmTipModal";
import Icon from "../components/Icon";
import LoginModal from "../components/LoginModal";
import RechargePrompt from "../components/RechargePrompt";
import { avatarErrorFallback, xAvatarUrl } from "../lib/avatar";

const PENDING_TIP_POST_KEY = "teep_pending_tip_post";

interface PendingTip {
  amountUsd: string;
  handle: string;
  tweetId: string;
}

interface PostTipData {
  totalAmount?: string;
  tipCount?: number;
}

interface OembedData {
  author_name?: string | null;
  excerpt?: string | null;
  thumbnail_url?: string | null;
}

function money(rawAmount?: string) {
  const value = Number(rawAmount ?? "0") / 1e6;
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TipPost() {
  const { handle, tweetId } = useParams<{ handle: string; tweetId: string }>();
  const cleanHandle = handle?.replace(/^@/, "") ?? "";
  const postUrl = cleanHandle && tweetId ? `https://x.com/${cleanHandle}/status/${tweetId}` : "";

  const { ready, authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const userWalletAddress = (user?.wallet as { address?: string } | undefined)?.address;
  const linkedAccounts = (user as { linkedAccounts?: Array<{ type?: string; address?: string }> } | null)?.linkedAccounts ?? [];
  const addressFromLinked =
    linkedAccounts.find((account) => account?.type === "smart_wallet" && account?.address)?.address ||
    linkedAccounts.find((account) => account?.type === "wallet" && account?.address)?.address ||
    (linkedAccounts.find((account) => account?.address?.startsWith?.("0x"))?.address ?? "");
  const address = (
    smartWalletClient?.account?.address ||
    embeddedWallet?.address ||
    userWalletAddress ||
    addressFromLinked ||
    ""
  ).toLowerCase();

  const [postData, setPostData] = useState<PostTipData | null>(null);
  const [oembed, setOembed] = useState<OembedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tipAmount, setTipAmount] = useState("5.00");
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [rechargeModalOpen, setRechargeModalOpen] = useState(false);
  const [pendingTip, setPendingTip] = useState<PendingTip | null>(null);
  const [confirmTipData, setConfirmTipData] = useState<PendingTip | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [tipSending, setTipSending] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [rechargeRetryStatus, setRechargeRetryStatus] = useState<"idle" | "checking" | "insufficient">("idle");
  const [rechargeRetryMessage, setRechargeRetryMessage] = useState<string | null>(null);
  const [createWalletLoading, setCreateWalletLoading] = useState(false);
  const [createWalletError, setCreateWalletError] = useState<string | null>(null);

  const { createWallet } = useCreateWallet({
    onSuccess: () => {
      setCreateWalletLoading(false);
      setCreateWalletError(null);
    },
    onError: (error) => {
      setCreateWalletLoading(false);
      setCreateWalletError(typeof error === "string" ? error : "Failed to create wallet");
    },
  });

  useEffect(() => {
    if (!cleanHandle || !tweetId) return;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const postResponse = await fetch(`${API_BASE}/tips/post/${encodeURIComponent(cleanHandle)}/${tweetId}`);
        if (!postResponse.ok) throw new Error("Could not load this post.");
        const data = (await postResponse.json()) as PostTipData;
        if (!cancelled) setPostData(data);
      } catch {
        if (!cancelled) setPostData({ totalAmount: "0", tipCount: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const loadPreview = async () => {
      if (!postUrl) return;
      try {
        const response = await fetch(`${API_BASE}/api/v1/oembed?url=${encodeURIComponent(postUrl)}`);
        if (!response.ok) return;
        const data = (await response.json()) as OembedData;
        if (!cancelled) setOembed(data);
      } catch {
        if (!cancelled) setOembed(null);
      }
    };

    load();
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [cleanHandle, tweetId, postUrl]);

  const fetchBalance = useCallback(async (): Promise<string> => {
    if (!address) return "0";
    const response = await fetch(`${API_BASE}/api/v1/wallet/${address}/usdc-balance`);
    if (!response.ok) return "0";
    const data = await response.json();
    return data.balanceRaw ?? "0";
  }, [address]);

  const prepareTip = useCallback(async (tip: PendingTip) => {
    setPageError(null);
    setSuccessTxHash(null);
    if (!ready) return;
    if (!authenticated) {
      sessionStorage.setItem(PENDING_TIP_POST_KEY, JSON.stringify(tip));
      setPendingTip(tip);
      setLoginModalOpen(true);
      return;
    }
    if (!address) {
      setPageError("Create your Teep wallet before sending this tip.");
      return;
    }

    const balanceRaw = await fetchBalance();
    const balance = Number(balanceRaw) / 1e6;
    const needed = Number(tip.amountUsd);
    if (balance < needed) {
      setPendingTip(tip);
      setRechargeRetryStatus("idle");
      setRechargeRetryMessage(null);
      setRechargeModalOpen(true);
      return;
    }

    setConfirmTipData(tip);
    setConfirmModalOpen(true);
  }, [address, authenticated, fetchBalance, ready]);

  const handleStartTip = useCallback(() => {
    if (!cleanHandle || !tweetId) return;
    const amount = Number(tipAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPageError("Enter a valid tip amount.");
      return;
    }
    prepareTip({ amountUsd: amount.toFixed(2), handle: cleanHandle, tweetId });
  }, [cleanHandle, prepareTip, tipAmount, tweetId]);

  useEffect(() => {
    const stored = sessionStorage.getItem(PENDING_TIP_POST_KEY);
    if (!stored || !authenticated) return;
    try {
      const tip = JSON.parse(stored) as PendingTip;
      sessionStorage.removeItem(PENDING_TIP_POST_KEY);
      setPendingTip(tip);
    } catch {
      sessionStorage.removeItem(PENDING_TIP_POST_KEY);
    }
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !pendingTip) return;
    if (loginModalOpen) setLoginModalOpen(false);
    let cancelled = false;
    const tip = pendingTip;

    const checkAndDecide = async () => {
      if (!address) {
        if (!cancelled) setPageError("Create your Teep wallet before sending this tip.");
        return;
      }
      const balanceRaw = await fetchBalance();
      const balance = Number(balanceRaw) / 1e6;
      const needed = Number(tip.amountUsd);
      if (cancelled) return;
      if (balance >= needed) {
        setConfirmTipData(tip);
        setConfirmModalOpen(true);
        setPendingTip(null);
      } else {
        setRechargeRetryStatus("idle");
        setRechargeRetryMessage(null);
        setRechargeModalOpen(true);
      }
    };

    checkAndDecide();
    return () => {
      cancelled = true;
    };
  }, [address, authenticated, fetchBalance, loginModalOpen, pendingTip]);

  const openConfirmFromRecharge = useCallback(async () => {
    if (!pendingTip) return;
    setRechargeRetryStatus("checking");
    setRechargeRetryMessage(null);
    const balanceRaw = await fetchBalance();
    const balance = Number(balanceRaw) / 1e6;
    const needed = Number(pendingTip.amountUsd);

    if (balance >= needed) {
      setRechargeRetryStatus("idle");
      setRechargeRetryMessage(null);
      setRechargeModalOpen(false);
      setConfirmTipData(pendingTip);
      setConfirmModalOpen(true);
      return;
    }

    const shortfall = needed - balance;
    setRechargeRetryStatus("insufficient");
    setRechargeRetryMessage(
      balance > 0
        ? `Balance still below $${needed.toFixed(2)}. Add at least $${shortfall.toFixed(2)} more.`
        : `Balance still $0. Add at least $${needed.toFixed(2)} to continue.`,
    );
  }, [fetchBalance, pendingTip]);

  const handleConfirmTip = useCallback(async () => {
    if (!confirmTipData || !smartWalletClient?.account || !address) return;
    setTipError(null);
    setTipSending(true);
    try {
      const resolved = await fetch(`${API_BASE}/auth/x/user/${encodeURIComponent(confirmTipData.handle)}`);
      if (!resolved.ok) throw new Error("Could not verify this creator. Try again in a moment.");
      const resolvedData = (await resolved.json()) as { id?: string };
      if (!resolvedData.id || !/^[0-9]+$/.test(resolvedData.id)) throw new Error("Could not verify this creator.");

      const contentId = computeContentId(confirmTipData.handle, confirmTipData.tweetId);
      const rawAmount = parseUnits(confirmTipData.amountUsd, 6);
      const txHash = await smartWalletClient.sendTransaction({
        account: smartWalletClient.account,
        chain: arcTestnet,
        calls: [
          { to: USDC_ADDRESS, data: encodeApproveCall(TIP_CONTRACT_ADDRESS, rawAmount) },
          { to: TIP_CONTRACT_ADDRESS, data: encodeTipCall(contentId, BigInt(resolvedData.id), rawAmount) },
        ],
      } as Parameters<typeof smartWalletClient.sendTransaction>[0]);

      await fetch(`${API_BASE}/tips/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId,
          authorHandle: confirmTipData.handle,
          tweetId: confirmTipData.tweetId,
        }),
      }).catch(() => {});

      await fetch(`${API_BASE}/tips/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "tip_sent",
          fromAddress: address,
          amount: rawAmount.toString(),
          txHash,
          authorHandle: confirmTipData.handle,
          tweetId: confirmTipData.tweetId,
          detail: `Tipped @${confirmTipData.handle}`,
          sourceMethod: "web_deep_link",
        }),
      }).catch(() => {});

      setConfirmModalOpen(false);
      setConfirmTipData(null);
      setPendingTip(null);
      setSuccessTxHash(txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTipError(message.includes("insufficient") || message.includes("balance") ? "Insufficient funds to tip this post." : message);
    } finally {
      setTipSending(false);
    }
  }, [address, confirmTipData, smartWalletClient]);

  const displayName = oembed?.author_name || `@${cleanHandle}`;
  const avatarUrl = xAvatarUrl(cleanHandle) || "/logo.svg";
  const total = money(postData?.totalAmount);
  const tipCount = postData?.tipCount ?? 0;
  return (
    <main className="tip-post-page">
      <section className="tip-post-shell" aria-labelledby="tip-post-title">
        <div className="tip-post-copy">
          <p className="tip-post-kicker">Post tip</p>
          <h1 id="tip-post-title">Tip this post</h1>
          <p>Send a stable-value tip to @{cleanHandle}. The receipt stays attached to this post.</p>

          <div className="tip-post-target" aria-label="Creator being tipped">
            <img
              src={avatarUrl}
              alt=""
              onError={(event) => avatarErrorFallback(event, cleanHandle)}
            />
            <div>
              <span>Tip recipient</span>
              <strong>{displayName}</strong>
              <small>@{cleanHandle}</small>
            </div>
          </div>

          <div className="tip-post-form" aria-label="Send a tip">
            <label htmlFor="tip-post-amount">Tip amount</label>
            <div className="tip-post-amount-row">
              <span>$</span>
              <input
                id="tip-post-amount"
                type="text"
                inputMode="decimal"
                pattern="^[0-9]+(\\.[0-9]{0,2})?$"
                value={tipAmount}
                onChange={(event) => setTipAmount(event.target.value)}
                aria-invalid={Boolean(pageError)}
                aria-describedby={`tip-post-amount-help${pageError ? " tip-post-page-error" : ""}${createWalletError ? " tip-post-wallet-error" : ""}`}
              />
            </div>
            <div className="tip-post-quick">
              {["1.00", "5.00", "10.00"].map((amount) => (
                <button key={amount} type="button" aria-label={`Set tip amount to $${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} onClick={() => setTipAmount(amount)}>
                  ${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </button>
              ))}
            </div>
            <p id="tip-post-amount-help">Send from the web app or use an X tip command for this post.</p>
            {pageError ? <p id="tip-post-page-error" className="tip-post-error" role="alert">{pageError}</p> : null}
            {createWalletError ? <p id="tip-post-wallet-error" className="tip-post-error" role="alert">{createWalletError}</p> : null}

            {authenticated && !address ? (
              <button
                type="button"
                className="tip-post-primary"
                disabled={createWalletLoading}
                onClick={async () => {
                  setCreateWalletError(null);
                  setCreateWalletLoading(true);
                  try {
                    await createWallet();
                  } catch {
                    setCreateWalletLoading(false);
                  }
                }}
              >
                <Icon name="wallet" />
                {createWalletLoading ? "Creating wallet..." : "Create Teep wallet"}
              </button>
            ) : (
              <button type="button" className="tip-post-primary" onClick={handleStartTip} disabled={!cleanHandle || !tweetId || !ready}>
                <Icon name="send" />
                Tip this post
              </button>
            )}

            <div className="tip-post-secondary-actions">
              {postUrl ? (
                <a href={postUrl} target="_blank" rel="noopener noreferrer">
                  View post on X
                </a>
              ) : null}
              <a href="/dashboard" target="_blank" rel="noopener noreferrer">
                Open Teep app
              </a>
            </div>
          </div>

          {successTxHash ? (
            <div className="tip-post-success" role="status">
              <Icon name="checkCircle" />
              <div>
                <strong>Tip submitted</strong>
                <span>Receipt and activity will update once the transaction is indexed.</span>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="tip-post-context" aria-label="Post being tipped">
          <div className="tip-post-preview">
            <div className="tip-post-preview-head">
              <img
                src={avatarUrl}
                alt=""
                onError={(event) => avatarErrorFallback(event, cleanHandle)}
              />
              <div>
                <strong>{displayName}</strong>
                <span>@{cleanHandle}</span>
              </div>
              <span className="tip-post-x">X</span>
            </div>
            {loading ? (
              <div className="tip-post-skeleton" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            ) : (
              <>
                <p className="tip-post-excerpt">
                  {oembed?.excerpt || "This post can receive support through Teep. Open the original post for the full context."}
                </p>
                {oembed?.thumbnail_url ? <img src={oembed.thumbnail_url} alt="" className="tip-post-thumbnail" /> : null}
              </>
            )}
            <div className="tip-post-stats">
              <div>
                <span>Received</span>
                <strong>${total}</strong>
              </div>
              <div>
                <span>Tips</span>
                <strong>{tipCount.toLocaleString()}</strong>
              </div>
            </div>
            {postUrl ? (
              <a href={postUrl} target="_blank" rel="noopener noreferrer" className="tip-post-preview-link">
                Open original post <Icon name="arrowRight" />
              </a>
            ) : null}
          </div>

          <p className="tip-post-context-line">Creator, post, amount, and receipt stay linked for both sides.</p>
        </aside>
      </section>

      <LoginModal
        open={loginModalOpen}
        onClose={() => {
          setLoginModalOpen(false);
          setPendingTip(null);
        }}
        onLogin={login}
        pendingTipSummary={pendingTip ? `$${pendingTip.amountUsd} to @${pendingTip.handle}` : undefined}
      />
      {confirmTipData ? (
        <ConfirmTipModal
          open={confirmModalOpen}
          onClose={() => {
            setConfirmModalOpen(false);
            setConfirmTipData(null);
            setTipError(null);
          }}
          amountUsd={confirmTipData.amountUsd}
          handle={confirmTipData.handle}
          tweetId={confirmTipData.tweetId}
          onConfirm={handleConfirmTip}
          sending={tipSending}
          error={tipError}
        />
      ) : null}
      {pendingTip ? (
        <RechargePrompt
          open={rechargeModalOpen}
          onClose={() => {
            setRechargeModalOpen(false);
            setPendingTip(null);
            setRechargeRetryStatus("idle");
            setRechargeRetryMessage(null);
          }}
          onRetry={openConfirmFromRecharge}
          amountUsd={pendingTip.amountUsd}
          handle={pendingTip.handle}
          embedFunding
          walletAddress={address || null}
          retryStatus={rechargeRetryStatus}
          retryMessage={rechargeRetryMessage}
        />
      ) : null}
    </main>
  );
}
