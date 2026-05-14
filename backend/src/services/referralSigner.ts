import { ethers } from "ethers";
import crypto from "crypto";
import { getChainId } from "../config/chain";

/**
 * Signs setReferrer(owner, referrer, expiresAt, nonce) for the ReferralRegistry contract using EIP-712.
 * Uses REFERRAL_SIGNER_PRIVATE_KEY; falls back to ATTESTATION_PRIVATE_KEY if unset.
 * Requires REFERRAL_REGISTRY_ADDRESS and CHAIN_ID when registry is deployed.
 */

const REFERRAL_SIGNER_PRIVATE_KEY =
  process.env.REFERRAL_SIGNER_PRIVATE_KEY || process.env.ATTESTATION_PRIVATE_KEY;
const REGISTRY_ADDRESS = (process.env.REFERRAL_REGISTRY_ADDRESS || "").toLowerCase();
const CHAIN_ID = getChainId();
const REFERRAL_SIGNATURE_TTL_SECONDS = parseInt(process.env.REFERRAL_SIGNATURE_TTL_SECONDS || "600", 10);

const EIP712_DOMAIN = {
  name: "TipcoinReferralRegistry",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: REGISTRY_ADDRESS as `0x${string}`,
};

const SET_REFERRER_TYPE = {
  SetReferrer: [
    { name: "owner", type: "address" },
    { name: "referrer", type: "address" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export interface SetReferrerSignature {
  owner: string;
  referrer: string;
  expiresAt: string;
  nonce: string; // 0x-prefixed bytes32 hex
  signature: string;
}

export class ReferralSignerService {
  private signer: ethers.Wallet | null = null;

  constructor() {
    if (REFERRAL_SIGNER_PRIVATE_KEY) {
      this.signer = new ethers.Wallet(REFERRAL_SIGNER_PRIVATE_KEY);
      console.log(`[ReferralSigner] Signer address: ${this.signer.address}`);
    } else {
      console.warn("[ReferralSigner] REFERRAL_SIGNER_PRIVATE_KEY (or ATTESTATION_PRIVATE_KEY) not set.");
    }
  }

  get signerAddress(): string | null {
    return this.signer?.address ?? null;
  }

  /**
   * Sign setReferrer(owner, referrer, expiresAt, nonce) for on-chain ReferralRegistry using EIP-712.
   */
  async signSetReferrer(owner: string, referrer: string): Promise<SetReferrerSignature> {
    if (!this.signer) {
      throw new Error("Referral signer not configured");
    }
    if (!REGISTRY_ADDRESS || REGISTRY_ADDRESS.length < 40) {
      throw new Error("REFERRAL_REGISTRY_ADDRESS must be set for EIP-712 signing");
    }
    const nonce = "0x" + crypto.randomBytes(32).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + REFERRAL_SIGNATURE_TTL_SECONDS;
    const value = {
      owner: ethers.getAddress(owner),
      referrer: ethers.getAddress(referrer),
      expiresAt,
      nonce: nonce as `0x${string}`,
    };
    const signature = await this.signer.signTypedData(
      EIP712_DOMAIN,
      SET_REFERRER_TYPE,
      value
    );
    return { owner, referrer, expiresAt: expiresAt.toString(), nonce, signature };
  }
}

export const referralSignerService = new ReferralSignerService();
