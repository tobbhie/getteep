import { getDb } from "../db/database";

export type UserSettings = {
  address: string;
  username: string | null;
  socialXHandle: string | null;
  defaultTipAmount: string;
  receipts: {
    shareLinksEnabled: boolean;
    shareAmountEnabled: boolean;
    postAwareCopyEnabled: boolean;
  };
  notifications: {
    creatorClaimed: boolean;
    lowBalance: boolean;
    receiptReady: boolean;
  };
  privacy: {
    hideAddress: boolean;
    privateActivity: boolean;
    requireVerification: boolean;
  };
  updatedAt: string | null;
};

export function settingsRowToResponse(address: string, row?: any): UserSettings {
  return {
    address,
    username: row?.username ?? null,
    socialXHandle: row?.social_x_handle ?? null,
    defaultTipAmount: row?.default_tip_amount ?? "5.00",
    receipts: {
      shareLinksEnabled: true,
      shareAmountEnabled: row?.receipt_share_amount_enabled !== 0,
      postAwareCopyEnabled: true,
    },
    notifications: {
      creatorClaimed: row?.notify_creator_claimed !== 0,
      lowBalance: row?.notify_low_balance !== 0,
      receiptReady: row?.notify_receipt_ready === 1,
    },
    privacy: {
      hideAddress: row?.privacy_hide_address !== 0,
      privateActivity: row?.privacy_private_activity !== 0,
      requireVerification: row?.privacy_require_verification !== 0,
    },
    updatedAt: row?.updatedAt ?? row?.updated_at ?? null,
  };
}

export function getUserSettings(address: string): UserSettings {
  const normalized = address.toLowerCase();
  const db = getDb();
  const row = db
    .prepare("SELECT *, updated_at as updatedAt FROM user_settings WHERE address = ? LIMIT 1")
    .get(normalized);
  return settingsRowToResponse(normalized, row);
}

export function publicIdentity(address: string) {
  const settings = getUserSettings(address);
  if (settings.username) {
    return {
      label: `@${settings.username}`,
      socialXHandle: settings.socialXHandle,
      address: settings.privacy.hideAddress ? null : address,
    };
  }
  return {
    label: settings.privacy.hideAddress ? `${address.slice(0, 6)}...${address.slice(-4)}` : address,
    socialXHandle: settings.socialXHandle,
    address: settings.privacy.hideAddress ? null : address,
  };
}
