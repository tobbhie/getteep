import "dotenv/config";
import { erc20Abi } from "viem";
import { getDb, getPool } from "../db/database";
import { createBackendPublicClient } from "../services/rpcClient";
import { computeClaimWallet } from "../services/xTippingRouter";
import { getDefaultTokenAddress } from "../services/teepBalance";

function sameAddress(a?: string | null, b?: string | null) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

async function main() {
  const limit = Math.min(Math.max(Number(process.argv[2] || 50), 1), 250);
  const db = getDb();
  const rows = await db
    .prepare(
      `SELECT tx_hash, sender_address, recipient_address, recipient_x_user_id,
              recipient_x_username, amount_raw, receipt_id, created_at
       FROM x_bot_tips
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all<{
      tx_hash: string | null;
      sender_address: string;
      recipient_address: string | null;
      recipient_x_user_id: string;
      recipient_x_username: string | null;
      amount_raw: string;
      receipt_id: string;
      created_at: number;
    }>(limit);

  const client = createBackendPublicClient();
  const tokenAddress = getDefaultTokenAddress() as `0x${string}`;
  const checked = [];

  for (const row of rows) {
    let currentFactoryClaimWallet: `0x${string}` | null = null;
    let currentFactoryWalletBalanceRaw: string | null = null;
    let recordedWalletBalanceRaw: string | null = null;
    let error: string | null = null;
    try {
      currentFactoryClaimWallet = await computeClaimWallet(row.recipient_x_user_id);
      const [currentBalance, recordedBalance] = await Promise.all([
        client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [currentFactoryClaimWallet],
        }),
        row.recipient_address
          ? client.readContract({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [row.recipient_address as `0x${string}`],
            })
          : Promise.resolve(null),
      ]);
      currentFactoryWalletBalanceRaw = currentBalance.toString();
      recordedWalletBalanceRaw = typeof recordedBalance === "bigint" ? recordedBalance.toString() : null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    checked.push({
      txHash: row.tx_hash,
      receiptId: row.receipt_id,
      recipientXUserId: row.recipient_x_user_id,
      recipientXUsername: row.recipient_x_username,
      amountRaw: row.amount_raw,
      recordedRecipientAddress: row.recipient_address,
      currentFactoryClaimWallet,
      matchesCurrentFactory: sameAddress(row.recipient_address, currentFactoryClaimWallet),
      recordedWalletBalanceRaw,
      currentFactoryWalletBalanceRaw,
      createdAt: row.created_at,
      error,
    });
  }

  const mismatches = checked.filter((row) => !row.matchesCurrentFactory);
  console.log(JSON.stringify({
    checked: checked.length,
    mismatches: mismatches.length,
    factoryAddress: process.env.FACTORY_ADDRESS || null,
    tokenAddress,
    rows: checked,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
