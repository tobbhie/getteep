import { ethers } from "ethers";
import crypto from "crypto";

/**
 * Attestation service for X OAuth claim verification.
 * Signs attestations that prove an X user owns a specific authorId.
 * These attestations are consumed on-chain by the WalletFactory.
 */

const ATTESTATION_PRIVATE_KEY = process.env.ATTESTATION_PRIVATE_KEY;
const ATTESTATION_EXPIRY_SECONDS = parseInt(process.env.ATTESTATION_EXPIRY_SECONDS || "600"); // 10 min

export interface Attestation {
  authorId: string;
  owner: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

export class AttestationService {
  private signer: ethers.Wallet | null = null;

  constructor() {
    if (ATTESTATION_PRIVATE_KEY) {
      this.signer = new ethers.Wallet(ATTESTATION_PRIVATE_KEY);
      console.log(`[Attestation] Signer address: ${this.signer.address}`);
    } else {
      console.warn("[Attestation] ATTESTATION_PRIVATE_KEY not set. Attestation disabled.");
    }
  }

  get signerAddress(): string | null {
    return this.signer?.address || null;
  }

  /**
   * Create a signed attestation for an X author claiming their wallet.
   *
   * @param authorId Numeric X author ID (verified via OAuth)
   * @param ownerAddress The wallet address that will own the claim wallet
   * @returns Signed attestation data to be submitted on-chain
   */
  async createAttestation(authorId: string, ownerAddress: string): Promise<Attestation> {
    if (!this.signer) {
      throw new Error("Attestation service not configured");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = "0x" + crypto.randomBytes(32).toString("hex");

    // Match the on-chain packing: abi.encodePacked(authorId, owner, timestamp, nonce)
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [BigInt(authorId), ownerAddress, BigInt(timestamp), nonce]
    );

    // Sign with EIP-191 prefix (ethSignedMessage)
    const signature = await this.signer.signMessage(ethers.getBytes(messageHash));

    return {
      authorId,
      owner: ownerAddress,
      timestamp,
      nonce,
      signature,
    };
  }

  /**
   * Verify an attestation is still valid (not expired)
   */
  isValid(attestation: Attestation): boolean {
    const now = Math.floor(Date.now() / 1000);
    return now - attestation.timestamp <= ATTESTATION_EXPIRY_SECONDS;
  }
}
