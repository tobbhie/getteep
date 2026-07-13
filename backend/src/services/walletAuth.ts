import crypto from "crypto";
import { ethers } from "ethers";
import type { Address, Hex } from "viem";
import { isAddress } from "../utils/security";
import { createBackendPublicClient } from "./rpcClient";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const allowedPurposes = new Set([
  "claim-attestation",
  "referral-code",
  "referral-link",
  "referral-set-referrer",
  "account-settings",
  "activity-write",
  "funding",
  "supporter-thank",
  "withdrawal",
  "x-tipping-link",
]);

type ChallengeRecord = {
  address: `0x${string}`;
  purpose: string;
  expiresAt: number;
};

export type WalletProof = {
  message?: unknown;
  signature?: unknown;
};

const challenges = new Map<string, ChallengeRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [nonce, challenge] of challenges) {
    if (challenge.expiresAt < now) challenges.delete(nonce);
  }
}, 60_000);

export function isWalletAuthPurpose(value: unknown): value is string {
  return typeof value === "string" && allowedPurposes.has(value);
}

export function createWalletChallenge(address: `0x${string}`, purpose: string) {
  if (!isWalletAuthPurpose(purpose)) {
    throw new Error("Invalid wallet auth purpose");
  }

  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const message = [
    "Teep wallet verification",
    `Address: ${normalizedAddress}`,
    `Purpose: ${purpose}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
  ].join("\n");

  challenges.set(nonce, {
    address: normalizedAddress,
    purpose,
    expiresAt,
  });

  return { message, nonce, expiresAt };
}

export async function verifyWalletProof(
  address: unknown,
  purpose: string,
  proof: WalletProof | undefined
): Promise<boolean> {
  if (!isAddress(address) || !isWalletAuthPurpose(purpose) || !proof) return false;
  if (typeof proof.message !== "string" || typeof proof.signature !== "string") return false;

  const nonceMatch = proof.message.match(/^Nonce: ([a-f0-9]{32})$/m);
  if (!nonceMatch) return false;

  const nonce = nonceMatch[1];
  const challenge = challenges.get(nonce);
  if (!challenge) return false;
  challenges.delete(nonce);

  const normalizedAddress = address.toLowerCase();
  if (
    challenge.address !== normalizedAddress ||
    challenge.purpose !== purpose ||
    challenge.expiresAt < Date.now()
  ) {
    return false;
  }

  if (proof.message !== createExpectedMessage(challenge, nonce)) {
    return false;
  }

  return verifySignature(normalizedAddress, proof.message, proof.signature);
}

function createExpectedMessage(challenge: ChallengeRecord, nonce: string): string {
  return [
    "Teep wallet verification",
    `Address: ${challenge.address}`,
    `Purpose: ${challenge.purpose}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(challenge.expiresAt).toISOString()}`,
  ].join("\n");
}

async function verifySignature(address: string, message: string, signature: string): Promise<boolean> {
  try {
    if (ethers.verifyMessage(message, signature).toLowerCase() === address) {
      return true;
    }
  } catch {
    // Smart-account signatures may not be recoverable as EOAs.
  }

  try {
    const client = createBackendPublicClient();
    return await client.verifyMessage({
      address: address as Address,
      message,
      signature: signature as Hex,
    });
  } catch {
    return false;
  }
}
