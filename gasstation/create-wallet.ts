// create-wallet.ts

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  registerEntitySecretCiphertext,
  initiateDeveloperControlledWalletsClient,
  type TokenBlockchain,
} from "@circle-fin/developer-controlled-wallets";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "output");
const WALLET_SET_NAME = "Circle Wallet Onboarding";

async function main() {
    const apiKey = process.env.CIRCLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "CIRCLE_API_KEY is required. Add it to .env or set it as an environment variable."
      );
    }
  
    // Register entity secret
    console.log("Registering entity secret...");
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const entitySecret = crypto.randomBytes(32).toString("hex");
    await registerEntitySecretCiphertext({
      apiKey,
      entitySecret,
      recoveryFileDownloadPath: OUTPUT_DIR,
    });
    const envPath = path.join(__dirname, ".env");
    fs.appendFileSync(envPath, `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`, "utf-8");
    console.log("Entity secret registered.");

    // Create wallet set
console.log("\nCreating wallet set...");
const client = initiateDeveloperControlledWalletsClient({
  apiKey,
  entitySecret,
});
const walletSet = (await client.createWalletSet({ name: WALLET_SET_NAME })).data
  ?.walletSet;
if (!walletSet?.id) {
  throw new Error("Wallet set creation failed: no ID returned");
}
console.log("Wallet set ID:", walletSet.id);

// Create Wallet
console.log("\nCreating Wallet on ARC-TESTNET...");
const wallet = (
  await client.createWallets({
    walletSetId: walletSet.id,
    blockchains: ["ARC-TESTNET"],
    count: 1,
    accountType: "EOA",
  })
).data?.wallets?.[0];
if (!wallet) {
  throw new Error("Wallet creation failed: no wallet returned");
}
console.log("Wallet ID:", wallet.id);
console.log("Address:", wallet.address);

fs.appendFileSync(
  envPath,
  `CIRCLE_WALLET_ADDRESS=${wallet.address}\n`,
  "utf-8",
);
fs.appendFileSync(
  envPath,
  `CIRCLE_WALLET_BLOCKCHAIN=${wallet.blockchain}\n`,
  "utf-8",
);
fs.writeFileSync(
  path.join(OUTPUT_DIR, "wallet-info.json"),
  JSON.stringify(wallet, null, 2),
  "utf-8",
);
console.log("\nBefore continuing, request test USDC from the faucet:");
console.log("  1. Go to https://faucet.circle.com");
console.log('  2. Select "Arc Testnet" network');
console.log(`  3. Paste your wallet address: ${wallet.address}`);
console.log('  4. Click "Send USDC"');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise<void>((resolve) =>
    rl.question("\nPress Enter once faucet tokens have been sent... ", () => {
      rl.close();
      resolve();
    }),
  );

  // Create second wallet
  console.log("\nCreating second wallet...");
  const secondWallet = (
    await client.createWallets({
      walletSetId: walletSet.id,
      blockchains: ["ARC-TESTNET"],
      count: 1,
      accountType: "EOA",
    })
  ).data?.wallets?.[0];
  if (!secondWallet) {
    throw new Error("Second wallet creation failed: no wallet returned");
  }
  console.log("Second wallet address:", secondWallet.address);

  // Send USDC to second wallet (Arc Testnet USDC token address)
  const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
  console.log("\nSending 5 USDC to second wallet...");
  const txResponse = await client.createTransaction({
    blockchain: wallet.blockchain as TokenBlockchain,
    walletAddress: wallet.address,
    destinationAddress: secondWallet.address,
    amount: ["5"],
    tokenAddress: ARC_TESTNET_USDC,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const txId = txResponse.data?.id;
  if (!txId) throw new Error("Transaction creation failed: no ID returned");
  console.log("Transaction ID:", txId);

  // Poll until transaction reaches a terminal state
  const terminalStates = new Set([
    "COMPLETE",
    "FAILED",
    "CANCELLED",
    "DENIED",
  ]);
  let currentState: string | undefined = txResponse.data?.state;
  while (!currentState || !terminalStates.has(currentState)) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const poll = await client.getTransaction({ id: txId });
    const tx = poll.data?.transaction;
    currentState = tx?.state;
    console.log("Transaction state:", currentState);
    if (currentState === "COMPLETE" && tx?.txHash) {
      console.log(`Explorer: https://testnet.arcscan.app/tx/${tx.txHash}`);
    }
  }
  if (currentState !== "COMPLETE") {
    throw new Error(`Transaction ended in state: ${currentState}`);
  }

  // Verify both wallets' token balances
  console.log("\nSource wallet balances:");
  const srcBalances = (
    await client.getWalletTokenBalance({ id: wallet.id })
  ).data?.tokenBalances;
  for (const b of srcBalances ?? []) {
    console.log(`  ${b.token?.symbol ?? "Unknown"}: ${b.amount}`);
  }
  console.log("\nSecond wallet balances:");
  const secondBalances = (
    await client.getWalletTokenBalance({ id: secondWallet.id })
  ).data?.tokenBalances;
  for (const b of secondBalances ?? []) {
    console.log(`  ${b.token?.symbol ?? "Unknown"}: ${b.amount}`);
  }
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});