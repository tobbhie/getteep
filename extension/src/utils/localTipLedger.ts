export type LocalTipActivityEntry = {
  type: "tip_sent";
  fromAddress: string;
  amount: string;
  tx_hash: string;
  timestamp: number;
  author_handle?: string;
  tweet_id?: string;
  detail?: string;
  local?: boolean;
};

type StoredTipTotal = {
  totalRaw: string;
  txHashes: string[];
  updatedAt: number;
};

type StoredTipTotals = Record<string, StoredTipTotal>;

const LOCAL_ACTIVITY_KEY = "localTipActivity";
const LOCAL_TOTALS_KEY = "localTipTotalsByWallet";

export function normalizeActivityTxHash(item: any): string {
  return String(item?.tx_hash || item?.txHash || "").toLowerCase();
}

export function normalizeActivityFrom(item: any): string {
  return String(item?.fromAddress || item?.from_addr || item?.from_address || "").toLowerCase();
}

export function safeRawAmount(value: unknown): bigint {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

export function sumTipSentForOwner(items: any[], ownerAddress: string, ignoredTxs = new Set<string>()): bigint {
  const owner = ownerAddress.toLowerCase();
  return items.reduce((sum, item) => {
    const txHash = normalizeActivityTxHash(item);
    if (item?.type !== "tip_sent" || normalizeActivityFrom(item) !== owner || (txHash && ignoredTxs.has(txHash))) {
      return sum;
    }
    return sum + safeRawAmount(item.amount);
  }, 0n);
}

export function getLocalTipAggregate(ownerAddress: string): Promise<bigint> {
  const owner = ownerAddress.toLowerCase();
  return new Promise((resolve) => {
    chrome.storage.local.get([LOCAL_TOTALS_KEY], (stored) => {
      const totals = (stored[LOCAL_TOTALS_KEY] || {}) as StoredTipTotals;
      resolve(safeRawAmount(totals[owner]?.totalRaw));
    });
  });
}

export function rememberLocalTipSent(entry: LocalTipActivityEntry): Promise<void> {
  const owner = entry.fromAddress.toLowerCase();
  const txHash = entry.tx_hash.toLowerCase();
  const normalized: LocalTipActivityEntry = {
    ...entry,
    fromAddress: owner,
    tx_hash: txHash,
    amount: String(entry.amount || "0"),
    timestamp: entry.timestamp || Date.now(),
    local: entry.local ?? true,
  };

  return new Promise((resolve) => {
    chrome.storage.local.get([LOCAL_ACTIVITY_KEY, LOCAL_TOTALS_KEY], (stored) => {
      const existingActivity = Array.isArray(stored[LOCAL_ACTIVITY_KEY]) ? stored[LOCAL_ACTIVITY_KEY] : [];
      const nextActivity = [
        normalized,
        ...existingActivity.filter((item: any) => normalizeActivityTxHash(item) !== txHash),
      ].slice(0, 100);

      const totals = { ...((stored[LOCAL_TOTALS_KEY] || {}) as StoredTipTotals) };
      const previous = totals[owner] || { totalRaw: "0", txHashes: [], updatedAt: 0 };
      const knownTxs = new Set(previous.txHashes.map((hash) => hash.toLowerCase()));
      let totalRaw = safeRawAmount(previous.totalRaw);
      if (!knownTxs.has(txHash)) {
        totalRaw += safeRawAmount(normalized.amount);
        knownTxs.add(txHash);
      }

      totals[owner] = {
        totalRaw: totalRaw.toString(),
        txHashes: Array.from(knownTxs).slice(-250),
        updatedAt: Date.now(),
      };

      chrome.storage.local.set({ [LOCAL_ACTIVITY_KEY]: nextActivity, [LOCAL_TOTALS_KEY]: totals }, () => resolve());
    });
  });
}
