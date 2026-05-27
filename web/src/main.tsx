import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import App from "./App";
import { AccountRoleProvider } from "./context/AccountRoleContext";
import { PRIVY_APP_ID } from "./config";
import { arcTestnet } from "./chains";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme: "dark", accentColor: "#00c853" },
        loginMethods: ["email", "google"],
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" }, // explicit Ethereum — required for web wallet creation
        },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet],
      }}
    >
      <SmartWalletsProvider>
        <BrowserRouter>
          <AccountRoleProvider>
            <App />
          </AccountRoleProvider>
        </BrowserRouter>
      </SmartWalletsProvider>
    </PrivyProvider>
  </React.StrictMode>
);
