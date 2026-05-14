// Polyfill process (no Node in extension) — must run before any Privy/viem code
import "../utils/process-polyfill";

// Polyfill Buffer globally — must run BEFORE any Privy/viem code loads
import { Buffer } from "buffer";
(window as any).Buffer = Buffer;
(globalThis as any).Buffer = Buffer;

import React, { Component, ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { App } from "./App";
import { SignTipApp } from "./SignTipApp";
import { CONFIG } from "../utils/config";
import { debugLog } from "../utils/debug";

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (/zerodev|bundler|paymaster|useroperation|rpc/i.test(url)) {
    debugLog("AA:network", init?.method || "GET", url);
  }
  return originalFetch(input, init);
};

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = String(reason?.shortMessage ?? reason?.message ?? reason ?? "").toLowerCase();
  const knownPrivyArcFactoryFailure =
    message.includes("getaddress") &&
    message.includes("returned no data");

  if (knownPrivyArcFactoryFailure) {
    debugLog("SmartWallet", "Privy smart wallet factory is unavailable on Arc", {
      chainId: CONFIG.CHAIN_ID,
      chainName: CONFIG.CHAIN_NAME,
      message: reason?.shortMessage ?? reason?.message ?? String(reason),
    });
    event.preventDefault();
  }
});

class PopupErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: "" };

  static getDerivedStateFromError(err: Error) {
    return { hasError: true, message: err.message || "Something went wrong" };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    debugLog("Popup", "Popup error boundary caught an error", {
      message: err.message,
      stack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "20px",
          background: "#0a0a0a",
          color: "#e5e5e5",
          minHeight: "400px",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}>
          <p style={{ fontSize: "16px", marginBottom: "8px" }}>Tipcoin couldn&apos;t load</p>
          <p style={{ fontSize: "12px", color: "#71767b", marginBottom: "16px" }}>{this.state.message}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 20px",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  const isSigningMode = new URLSearchParams(window.location.search).get("sign") === "tip";
  root.render(
    <React.StrictMode>
      <PopupErrorBoundary>
        <PrivyProvider
          appId={CONFIG.PRIVY_APP_ID}
          config={{
            appearance: {
              theme: "dark",
              accentColor: "#3b82f6",
            },
            loginMethods: ["email", "google"],
            embeddedWallets: {
              ethereum: { createOnLogin: "users-without-wallets" },
            },
            defaultChain: CONFIG.CHAIN,
            supportedChains: [CONFIG.CHAIN],
          }}
        >
          <SmartWalletsProvider>
            {isSigningMode ? <SignTipApp /> : <App />}
          </SmartWalletsProvider>
        </PrivyProvider>
      </PopupErrorBoundary>
    </React.StrictMode>
  );
}
