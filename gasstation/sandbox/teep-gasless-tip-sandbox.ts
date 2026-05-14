import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initiateDeveloperControlledWalletsClient,
  type CreateContractExecutionTransactionInput,
  type EstimateContractExecutionFeeInput,
} from "@circle-fin/developer-controlled-wallets";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GASSTATION_DIR = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(__dirname, "output");
const ARC_TESTNET = "ARC-TESTNET";
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
const TERMINAL_STATES = new Set(["COMPLETE", "FAILED", "CANCELLED", "DENIED"]);

type WalletInfo = {
  id: string;
  address: string;
  blockchain?: string;
  accountType?: string;
  state?: string;
  scaCore?: string;
};

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function env(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  return value?.trim();
}

function required(name: string) {
  const value = env(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isBytes32(value: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function parseUsdc(value: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new Error("AMOUNT_USDC must be a positive decimal with up to 6 places");
  }

  const parts = value.split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString();
}

function short(value?: string) {
  if (!value) return "(none)";
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function nowRef(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: required("CIRCLE_API_KEY"),
    entitySecret: required("CIRCLE_ENTITY_SECRET"),
  });
}

async function createScaWallet() {
  const client = createClient();
  let walletSetId = env("CIRCLE_WALLET_SET_ID");

  if (!walletSetId) {
    const walletSet = (await client.createWalletSet({ name: "Teep Arc Gasless Sandbox" })).data?.walletSet;
    if (!walletSet?.id) throw new Error("Circle wallet set creation returned no id");
    walletSetId = walletSet.id;
  }

  const wallet = (
    await client.createWallets({
      walletSetId,
      blockchains: [ARC_TESTNET],
      count: 1,
      accountType: "SCA",
      metadata: [{ refId: nowRef("teep-arc-sca") }],
    })
  ).data?.wallets?.[0] as WalletInfo | undefined;

  if (!wallet?.id || !wallet.address) throw new Error("Circle SCA wallet creation returned no wallet");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "sca-wallet.json"), JSON.stringify({ walletSetId, wallet }, null, 2), "utf8");

  console.log("Created Arc Testnet SCA wallet");
  console.log("Wallet set:", walletSetId);
  console.log("Wallet ID:", wallet.id);
  console.log("Address:", wallet.address);
  console.log("Account type:", wallet.accountType);
  console.log("SCA core:", wallet.scaCore ?? "(not returned)");
  console.log(`Saved: ${path.relative(GASSTATION_DIR, path.join(OUTPUT_DIR, "sca-wallet.json"))}`);
}

function buildApproveTx(walletId: string, usdcAddress: string, tipContract: string, amountRaw: string) {
  return {
    walletId,
    contractAddress: usdcAddress,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [tipContract, amountRaw],
    refId: nowRef("teep-approve"),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } satisfies CreateContractExecutionTransactionInput;
}

function buildTipTx(walletId: string, tipContract: string, contentId: string, authorId: string, amountRaw: string) {
  return {
    walletId,
    contractAddress: tipContract,
    abiFunctionSignature: "tip(bytes32,uint256,uint256)",
    abiParameters: [contentId, authorId, amountRaw],
    refId: nowRef("teep-tip"),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } satisfies CreateContractExecutionTransactionInput;
}

function buildEstimateInput(tx: CreateContractExecutionTransactionInput): EstimateContractExecutionFeeInput {
  if (!("walletId" in tx) || !tx.walletId) throw new Error("Estimate requires a walletId");
  if (!("abiFunctionSignature" in tx) || !tx.abiFunctionSignature) {
    throw new Error("This sandbox estimates ABI-based calls only");
  }

  return {
    contractAddress: tx.contractAddress,
    abiFunctionSignature: tx.abiFunctionSignature,
    abiParameters: tx.abiParameters,
    source: { walletId: tx.walletId },
  };
}

function loadWalletId() {
  const walletId = env("CIRCLE_WALLET_ID") ?? env("WALLET_ID");
  if (!walletId) {
    const saved = path.join(OUTPUT_DIR, "sca-wallet.json");
    if (fs.existsSync(saved)) {
      const data = JSON.parse(fs.readFileSync(saved, "utf8")) as { wallet?: WalletInfo };
      if (data.wallet?.id) return data.wallet.id;
    }
  }
  if (!walletId) throw new Error("CIRCLE_WALLET_ID is required, or run CREATE_WALLET=true first");
  return walletId;
}

function loadTransactions() {
  const walletId = loadWalletId();
  const tipContract = required("TIP_CONTRACT_ADDRESS");
  const usdcAddress = env("USDC_ADDRESS", ARC_TESTNET_USDC)!;
  const contentId = required("CONTENT_ID");
  const authorId = required("AUTHOR_ID");
  const amountRaw = env("AMOUNT_RAW") ?? parseUsdc(required("AMOUNT_USDC"));

  if (!isAddress(tipContract)) throw new Error("TIP_CONTRACT_ADDRESS must be an EVM address");
  if (!isAddress(usdcAddress)) throw new Error("USDC_ADDRESS must be an EVM address");
  if (!isBytes32(contentId)) throw new Error("CONTENT_ID must be bytes32");
  if (!/^\d+$/.test(authorId)) throw new Error("AUTHOR_ID must be the numeric X user id");
  if (!/^\d+$/.test(amountRaw)) throw new Error("AMOUNT_RAW must be an integer USDC base-unit amount");

  return {
    approve: buildApproveTx(walletId, usdcAddress, tipContract, amountRaw),
    tip: buildTipTx(walletId, tipContract, contentId, authorId, amountRaw),
    amountRaw,
    tipContract,
    usdcAddress,
    walletId,
  };
}

async function estimate(label: string, tx: CreateContractExecutionTransactionInput) {
  const client = createClient();
  const response = await client.estimateContractExecutionFee(buildEstimateInput(tx));
  console.log(`${label} fee estimate:`);
  console.log(JSON.stringify(response.data, null, 2));
}

async function submitAndPoll(label: string, tx: CreateContractExecutionTransactionInput) {
  const client = createClient();
  const response = await client.createContractExecutionTransaction(tx);
  const txId = response.data?.id;
  if (!txId) throw new Error(`${label} submission returned no transaction id`);

  console.log(`${label} submitted:`, txId);
  let state = response.data?.state;
  while (!state || !TERMINAL_STATES.has(state)) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const poll = await client.getTransaction({ id: txId });
    const transaction = poll.data?.transaction;
    state = transaction?.state;
    console.log(`${label} state:`, state);
    if (state === "COMPLETE" && transaction?.txHash) {
      console.log(`${label} explorer: https://testnet.arcscan.app/tx/${transaction.txHash}`);
    }
  }

  if (state !== "COMPLETE") throw new Error(`${label} ended in state: ${state}`);
}

function printPlan() {
  const amountRaw = env("AMOUNT_RAW") ?? (env("AMOUNT_USDC") ? parseUsdc(env("AMOUNT_USDC")!) : "(set AMOUNT_USDC)");
  console.log("Teep Arc gasless sandbox plan");
  console.log("Network:", ARC_TESTNET);
  console.log("Sponsorship path: Circle dev-controlled SCA wallet + Circle Gas Station on Arc Testnet");
  console.log("Wallet ID:", short(env("CIRCLE_WALLET_ID") ?? env("WALLET_ID")));
  console.log("USDC:", env("USDC_ADDRESS", ARC_TESTNET_USDC));
  console.log("Tip contract:", env("TIP_CONTRACT_ADDRESS", "(set TIP_CONTRACT_ADDRESS)"));
  console.log("Content ID:", short(env("CONTENT_ID")));
  console.log("Author ID:", env("AUTHOR_ID", "(set AUTHOR_ID)"));
  console.log("Amount raw:", amountRaw);
  console.log("");
  console.log("Stages:");
  console.log("1. CREATE_WALLET=true creates an ARC-TESTNET SCA wallet.");
  console.log("2. ESTIMATE=true estimates approve + tip contract executions.");
  console.log("3. EXECUTE=true submits approve, waits for completion, then submits tip.");
}

async function main() {
  loadEnvFile(path.join(GASSTATION_DIR, ".env"));
  loadEnvFile(path.join(__dirname, ".env"));

  if (env("CREATE_WALLET") === "true") {
    await createScaWallet();
    return;
  }

  if (env("ESTIMATE") === "true") {
    const txs = loadTransactions();
    console.log("Using wallet:", txs.walletId);
    await estimate("approve", txs.approve);
    await estimate("tip", txs.tip);
    return;
  }

  if (env("EXECUTE") === "true") {
    const txs = loadTransactions();
    console.log("Using wallet:", txs.walletId);
    console.log("Approving TipContract to spend", txs.amountRaw, "USDC base units");
    await submitAndPoll("approve", txs.approve);
    console.log("Submitting Teep tip");
    await submitAndPoll("tip", txs.tip);
    return;
  }

  printPlan();
}

main().catch((err) => {
  console.error("Sandbox failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
