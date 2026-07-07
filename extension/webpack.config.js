const path = require("path");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");

if (process.env.EXTENSION_RELEASE_BUILD !== "true") {
  try {
    require("dotenv").config({ path: path.resolve(__dirname, ".env") });
  } catch {
    // dotenv is optional for the extension; CI can pass env directly.
  }
}

const LOCAL_URL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;

function assertProductionEnv(env) {
  if (env.ALLOW_INSECURE_EXTENSION_BUILD === "true") return;

  const required = ["API_BASE_URL", "WEB_APP_URL", "PRIVY_APP_ID", "TIP_CONTRACT_ADDRESS", "USDC_ADDRESS"];
  const missing = required.filter((key) => !env[key]);
  if (!env.WALLET_FACTORY_ADDRESS && !env.FACTORY_ADDRESS) {
    missing.push("WALLET_FACTORY_ADDRESS");
  }
  if (missing.length) {
    throw new Error(`Production extension build is missing required env: ${missing.join(", ")}`);
  }

  for (const key of ["API_BASE_URL", "WEB_APP_URL", "RECEIPT_BASE_URL"]) {
    if (env[key] && LOCAL_URL_RE.test(env[key])) {
      throw new Error(`Production extension build cannot use a local ${key}: ${env[key]}`);
    }
  }

  if (env.DEBUG_TEEP === "true" || env.DEBUG_TIPCOIN === "true") {
    throw new Error("Production extension build cannot enable DEBUG_TEEP or DEBUG_TIPCOIN.");
  }
}

function hostPermissionFromUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

function cspSourceFromUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function walletLabReleaseGuard(isProduction) {
  return {
    apply(compiler) {
      if (!isProduction) return;

      compiler.hooks.thisCompilation.tap("WalletLabReleaseGuard", (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: "WalletLabReleaseGuard",
            stage: webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
          },
          (assets) => {
            const prohibitedAssets = Object.keys(assets).filter((name) => name.includes("wallet-lab"));
            const backgroundSource = assets["background.js"]?.source().toString() || "";
            const prohibitedBackgroundMarkers = [
              "TIP_REQUEST_LAB",
              "wallet-lab",
            ].filter((marker) => backgroundSource.includes(marker));

            if (prohibitedAssets.length || prohibitedBackgroundMarkers.length) {
              const details = [
                prohibitedAssets.length ? `assets: ${prohibitedAssets.join(", ")}` : null,
                prohibitedBackgroundMarkers.length
                  ? `background markers: ${prohibitedBackgroundMarkers.join(", ")}`
                  : null,
              ].filter(Boolean).join("; ");

              compilation.errors.push(
                new Error(`Production extension contains wallet lab diagnostics (${details}).`)
              );
            }
          }
        );
      });
    },
  };
}

function buildManifest(source, isProduction) {
  const manifest = JSON.parse(source.toString());
  if (!isProduction) return JSON.stringify(manifest, null, 2);

  manifest.host_permissions = unique([
    "https://x.com/*",
    "https://twitter.com/*",
    "https://auth.privy.io/*",
    "https://*.privy.io/*",
    "https://*.privy.systems/*",
    "https://explorer-api.walletconnect.com/*",
    "https://*.zerodev.app/*",
    "https://*.pimlico.io/*",
    hostPermissionFromUrl(process.env.API_BASE_URL),
    hostPermissionFromUrl(process.env.RPC_URL || process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network"),
  ]);

  const connectSources = unique([
    "'self'",
    "https://auth.privy.io",
    "https://*.privy.io",
    // Privy selects per-chain RPC hosts under this domain at runtime.
    "https://*.privy.systems",
    "wss://*.privy.systems",
    // Privy queries WalletConnect's registry while initializing wallet clients.
    "https://explorer-api.walletconnect.com",
    // Kernel bundler/paymaster endpoints are tenant-specific subdomains.
    "https://*.zerodev.app",
    "https://*.pimlico.io",
    cspSourceFromUrl(process.env.API_BASE_URL),
    cspSourceFromUrl(process.env.RPC_URL || process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network"),
  ]);
  manifest.content_security_policy = {
    extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src ${connectSources.join(" ")};`,
  };
  delete manifest.web_accessible_resources;

  return JSON.stringify(manifest, null, 2);
}

module.exports = (_env, argv) => {
  const isProduction = argv.mode === "production";
  if (isProduction) assertProductionEnv(process.env);
  const outputPath = process.env.EXTENSION_OUTPUT_DIR
    ? path.resolve(process.env.EXTENSION_OUTPUT_DIR)
    : path.resolve(__dirname, "dist");

  const entry = {
    content: "./src/content/index.tsx",
    background: "./src/background/index.ts",
    popup: "./src/popup/index.tsx",
    ...(!isProduction
      ? {
          "wallet-lab": "./src/wallet-lab/index.tsx",
          "wallet-lab-sign": "./src/wallet-lab/signIndex.tsx",
        }
      : {}),
  };

  const publicCopyIgnore = [
    "**/manifest.json",
    ...(isProduction ? ["**/wallet-lab.html", "**/wallet-lab-sign.html"] : []),
  ];

  return {
  entry,
  output: {
    path: outputPath,
    filename: "[name].js",
    clean: true,
  },
  resolve: {
    modules: [path.resolve(__dirname, "node_modules"), "node_modules"],
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    fallback: {
      buffer: require.resolve("buffer/"),
      crypto: false,
      stream: false,
      util: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true,
          },
        },
        include: [
          path.resolve(__dirname, "src"),
          path.resolve(__dirname, "node_modules/@teep/shared"),
          path.resolve(__dirname, "../shared"),
        ],
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
           from: "public",
           to: ".",
           globOptions: {
             ignore: publicCopyIgnore,
           },
        },
        {
          from: "public/manifest.json",
          to: "manifest.json",
          transform: (content) => buildManifest(content, isProduction),
        },
      ],
    }),
    // Provide Buffer globally — required by Privy/viem dependencies at runtime
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
    // Inject env variables at build time (DEBUG_TEEP=true enables full debug mode)
    // For local dev: WEB_APP_URL=http://localhost:5174 npm run build
     new webpack.DefinePlugin({
       "process.env.NODE_ENV": JSON.stringify(isProduction ? "production" : "development"),
       "process.env.ENABLE_WALLET_LAB": JSON.stringify(isProduction ? "false" : "true"),
      "process.env.BLUR_EMAIL": JSON.stringify(process.env.BLUR_EMAIL || "false"),
      "process.env.DEBUG_TEEP": JSON.stringify(process.env.DEBUG_TEEP === "true" ? "true" : "false"),
      "process.env.DEBUG_TIPCOIN": JSON.stringify(process.env.DEBUG_TIPCOIN === "true" ? "true" : "false"),
      "process.env.WEB_APP_URL": JSON.stringify(process.env.WEB_APP_URL || "https://getteep.xyz"),
      "process.env.API_BASE_URL": JSON.stringify(process.env.API_BASE_URL || "http://127.0.0.1:3001"),
      "process.env.RPC_URL": JSON.stringify(process.env.RPC_URL || ""),
      "process.env.ARC_RPC_URL": JSON.stringify(process.env.ARC_RPC_URL || ""),
      "process.env.PRIVY_APP_ID": JSON.stringify(process.env.PRIVY_APP_ID || ""),
      "process.env.USDC_ADDRESS": JSON.stringify(process.env.USDC_ADDRESS || ""),
      "process.env.TIP_CONTRACT_ADDRESS": JSON.stringify(process.env.TIP_CONTRACT_ADDRESS || ""),
      "process.env.WALLET_FACTORY_ADDRESS": JSON.stringify(process.env.WALLET_FACTORY_ADDRESS || ""),
      "process.env.FACTORY_ADDRESS": JSON.stringify(process.env.FACTORY_ADDRESS || ""),
      "process.env.REFERRAL_REGISTRY_ADDRESS": JSON.stringify(process.env.REFERRAL_REGISTRY_ADDRESS || ""),
      "process.env.FUNDING_ENV": JSON.stringify(process.env.FUNDING_ENV || "arcTestnet"),
      "process.env.FAUCET_URL": JSON.stringify(process.env.FAUCET_URL || ""),
      "process.env.ENABLE_FIAT_ONRAMP": JSON.stringify(process.env.ENABLE_FIAT_ONRAMP === "true" ? "true" : "false"),
      "process.env.ENABLE_FIAT_OFFRAMP": JSON.stringify(process.env.ENABLE_FIAT_OFFRAMP === "true" ? "true" : "false"),
      "process.env.ONRAMP_URL": JSON.stringify(process.env.ONRAMP_URL || ""),
      "process.env.OFFRAMP_URL": JSON.stringify(process.env.OFFRAMP_URL || ""),
       "process.env.RECEIPT_BASE_URL": JSON.stringify(process.env.RECEIPT_BASE_URL || ""),
     }),
     walletLabReleaseGuard(isProduction),
   ],
  devtool: isProduction ? false : "cheap-module-source-map",
  };
};
