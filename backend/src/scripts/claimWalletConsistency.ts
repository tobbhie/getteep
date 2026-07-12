import "dotenv/config";
import { erc20Abi, parseAbi } from "viem";
import { getDb, getPool } from "../db/database";
import { createBackendPublicClient } from "../services/rpcClient";
import { computeClaimWallet, getXTippingRouterAddress } from "../services/xTippingRouter";
import { getDefaultTokenAddress } from "../services/teepBalance";

const ROUTER_ABI = parseAbi(["function factory() view returns (address)"]);

function normalizeHandle(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function bigintToString(value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    throw new Error("Usage: npm run ops:claim-wallet --workspace=backend -- <x-username-or-x-user-id>");
  }

  const db = getDb();
  const isXUserId = /^[0-9]+$/.test(identifier);
  const normalizedHandle = normalizeHandle(identifier);

  const xAccount = isXUserId
    ? await db.prepare(`SELECT * FROM x_accounts WHERE x_user_id = ? LIMIT 1`).get(identifier)
    : await db.prepare(`SELECT * FROM x_accounts WHERE LOWER(x_username) = ? LIMIT 1`).get(normalizedHandle);

  const verifiedClaim = isXUserId
    ? await db.prepare(`SELECT * FROM verified_claims WHERE author_id = ? ORDER BY verified_at DESC LIMIT 1`).get(identifier)
    : await db.prepare(`SELECT * FROM verified_claims WHERE LOWER(username) = ? ORDER BY verified_at DESC LIMIT 1`).get(normalizedHandle);

  const authorId = String((xAccount as any)?.x_user_id || (verifiedClaim as any)?.author_id || (isXUserId ? identifier : ""));
  if (!authorId) {
    console.log(JSON.stringify({
      input: identifier,
      found: false,
      xAccount: xAccount || null,
      verifiedClaim: verifiedClaim || null,
    }, null, 2));
    return;
  }

  const claimWalletRow = await db
    .prepare(`SELECT * FROM claim_wallets WHERE author_id = ? LIMIT 1`)
    .get(authorId);
  const legacyWalletRows = await db
    .prepare(`SELECT * FROM claim_wallet_legacy WHERE author_id = ? ORDER BY created_at DESC`)
    .all(authorId);

  const client = createBackendPublicClient();
  const computedClaimWallet = await computeClaimWallet(authorId);
  const [code, usdcBalance] = await Promise.all([
    client.getCode({ address: computedClaimWallet }),
    client.readContract({
      address: getDefaultTokenAddress() as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [computedClaimWallet],
    }),
  ]);

  const routerAddress = getXTippingRouterAddress();
  const routerFactory = routerAddress
    ? await client.readContract({
        address: routerAddress,
        abi: ROUTER_ABI,
        functionName: "factory",
      })
    : null;

  console.log(JSON.stringify({
    input: identifier,
    authorId,
    xAccount: xAccount || null,
    verifiedClaim: verifiedClaim || null,
    claimWalletRow: claimWalletRow || null,
    legacyWalletRows,
    currentFactory: process.env.FACTORY_ADDRESS || null,
    computedClaimWallet,
    computedClaimWalletHasCode: Boolean(code && code !== "0x"),
    computedClaimWalletCodeBytes: code ? Math.max(0, (code.length - 2) / 2) : 0,
    computedClaimWalletUsdcBalanceRaw: bigintToString(usdcBalance),
    xTippingRouterAddress: routerAddress,
    xTippingRouterFactory: routerFactory,
    routerUsesCurrentFactory:
      typeof routerFactory === "string" &&
      typeof process.env.FACTORY_ADDRESS === "string" &&
      routerFactory.toLowerCase() === process.env.FACTORY_ADDRESS.toLowerCase(),
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
