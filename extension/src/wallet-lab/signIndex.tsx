import "../utils/process-polyfill";

import { Buffer } from "buffer";
(window as any).Buffer = Buffer;
(globalThis as any).Buffer = Buffer;

import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { CONFIG } from "../utils/config";
import { installAaNetworkLogger } from "./diagnostics";
import { WalletLabSign } from "./WalletLabSign";

installAaNetworkLogger("Teep:WalletLabSign");

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <PrivyProvider
        appId={CONFIG.PRIVY_APP_ID}
        config={{
          loginMethods: ["email", "google"],
          appearance: {
            theme: "dark",
            accentColor: "#6d28d9",
          },
          embeddedWallets: {
            ethereum: { createOnLogin: "users-without-wallets" },
          },
          defaultChain: CONFIG.CHAIN,
          supportedChains: [CONFIG.CHAIN],
        }}
      >
        <SmartWalletsProvider>
          <WalletLabSign />
        </SmartWalletsProvider>
      </PrivyProvider>
    </React.StrictMode>
  );
}
