import { Router, Request, Response } from "express";
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getConfiguredChain, getRpcUrl } from "../config/chain";
import { isAddress } from "../utils/security";

const router = Router();

const MOCK_USDC_ADDRESS = process.env.MOCK_USDC_ADDRESS as `0x${string}` | undefined;
const FAUCET_PRIVATE_KEY = process.env.FAUCET_PRIVATE_KEY as `0x${string}` | undefined;
const RPC_URL = getRpcUrl();
const CHAIN = process.env.CHAIN || "arcTestnet";
const ENABLE_FAUCET = process.env.ENABLE_FAUCET === "true";

// Faucet amount: 100 USDC per request
const FAUCET_AMOUNT = parseUnits("100", 6);

// Rate limit: one request per address per 5 minutes
const lastFaucetRequest = new Map<string, number>();
const COOLDOWN_MS = 5 * 60 * 1000;

const mintAbi = parseAbi(["function mint(address to, uint256 amount) external"]);

/**
 * POST /faucet
 * Mint test USDC to a wallet address (testnet only)
 * Body: { address: string }
 */
router.post("/", async (req: Request, res: Response) => {
  if (!ENABLE_FAUCET) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Only available on testnet
  if (CHAIN !== "baseSepolia" && CHAIN !== "arcTestnet") {
    res.status(403).json({ error: "Faucet is only available on testnet" });
    return;
  }

  if (!MOCK_USDC_ADDRESS || !FAUCET_PRIVATE_KEY) {
    res.status(503).json({ error: "Faucet not configured" });
    return;
  }

  const { address } = req.body;
  if (!isAddress(address)) {
    res.status(400).json({ error: "Valid address is required" });
    return;
  }

  const addrLower = address.toLowerCase();

  // Rate limit check
  const lastRequest = lastFaucetRequest.get(addrLower);
  if (lastRequest && Date.now() - lastRequest < COOLDOWN_MS) {
    const remainingSec = Math.ceil((COOLDOWN_MS - (Date.now() - lastRequest)) / 1000);
    res.status(429).json({ error: `Rate limited. Try again in ${remainingSec}s` });
    return;
  }

  try {
    const account = privateKeyToAccount(FAUCET_PRIVATE_KEY);
    const configuredChain = getConfiguredChain();
    const walletClient = createWalletClient({
      account,
      chain: configuredChain,
      transport: http(RPC_URL),
    });
    const publicClient = createPublicClient({
      chain: configuredChain,
      transport: http(RPC_URL),
    });

    const txHash = await walletClient.writeContract({
      address: MOCK_USDC_ADDRESS,
      abi: mintAbi,
      functionName: "mint",
      args: [address as `0x${string}`, FAUCET_AMOUNT],
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    lastFaucetRequest.set(addrLower, Date.now());

    console.log(`[Faucet] Minted 100 USDC to ${address} — tx: ${txHash}`);

    res.json({
      success: true,
      amount: "100",
      txHash,
      blockNumber: Number(receipt.blockNumber),
    });
  } catch (err: any) {
    console.error("[Faucet] Error:", err.message);
    res.status(500).json({ error: "Faucet transaction failed" });
  }
});

export default router;
