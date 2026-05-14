import React from "react";
import ReactDOM from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { App } from "./App";
import { arcTestnet } from "./chains";
import "./styles.css";

const appId = import.meta.env.VITE_PRIVY_APP_ID || "cmoslas9401se0cjx2g6mk2a3";

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (/zerodev|bundler|paymaster|useroperation|rpc/i.test(url)) {
    console.info("[Privy Arc Smoke:network]", init?.method || "GET", url);
  }
  return originalFetch(input, init);
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google"],
        appearance: {
          theme: "dark",
          accentColor: "#6d28d9",
        },
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet],
      }}
    >
      <SmartWalletsProvider>
        <App appId={appId} />
      </SmartWalletsProvider>
    </PrivyProvider>
  </React.StrictMode>
);
