import { encodeFunctionData, keccak256, toBytes } from "viem";
import { USDC_ADDRESS, TIP_CONTRACT_ADDRESS } from "../config";

const CLAIM_WALLET_ABI = [
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdrawWithFee",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "destination", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdrawWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "destination", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export function encodeWithdrawCall(to: `0x${string}`, amountRaw: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: CLAIM_WALLET_ABI,
    functionName: "withdraw",
    args: [USDC_ADDRESS, to, amountRaw],
  });
}

export function encodeWithdrawWithFeeCall(destination: `0x${string}`, amountRaw: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: CLAIM_WALLET_ABI,
    functionName: "withdrawWithFee",
    args: [USDC_ADDRESS, destination, amountRaw],
  });
}

export function encodeWithdrawWithAuthorizationCall(
  destination: `0x${string}`,
  amountRaw: bigint,
  authorization: { expiresAt: number | bigint; nonce: `0x${string}`; signature: `0x${string}` }
): `0x${string}` {
  return encodeFunctionData({
    abi: CLAIM_WALLET_ABI,
    functionName: "withdrawWithAuthorization",
    args: [USDC_ADDRESS, destination, amountRaw, BigInt(authorization.expiresAt), authorization.nonce, authorization.signature],
  });
}

/** contentId = keccak256("x.com/{handle}/status/{tweetId}") — matches contract */
export function computeContentId(handle: string, tweetId: string): `0x${string}` {
  const canonical = `x.com/${handle.toLowerCase()}/status/${tweetId}`;
  return keccak256(toBytes(canonical));
}

/** authorId as uint256 — keccak256(handle) */
export function handleToAuthorId(handle: string): bigint {
  return BigInt(keccak256(toBytes(handle.toLowerCase())));
}

const TIP_ABI = [
  { name: "tip", type: "function", stateMutability: "nonpayable", inputs: [{ name: "contentId", type: "bytes32" }, { name: "authorId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;
const USDC_APPROVE_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
const USDC_TRANSFER_ABI = [
  { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export function encodeTipCall(contentId: `0x${string}`, authorId: bigint, amountRaw: bigint): `0x${string}` {
  return encodeFunctionData({ abi: TIP_ABI, functionName: "tip", args: [contentId, authorId, amountRaw] });
}

export function encodeApproveCall(spender: `0x${string}`, amountRaw: bigint): `0x${string}` {
  return encodeFunctionData({ abi: USDC_APPROVE_ABI, functionName: "approve", args: [spender, amountRaw] });
}

/** ERC20 transfer — for Tip Balance withdrawal (no fee) from user's wallet */
export function encodeTransferCall(to: `0x${string}`, amountRaw: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: USDC_TRANSFER_ABI,
    functionName: "transfer",
    args: [to, amountRaw],
  });
}

export { TIP_CONTRACT_ADDRESS };
