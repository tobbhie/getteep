const path = require("path");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");

try {
  require("dotenv").config({ path: path.resolve(__dirname, ".env") });
} catch {
  // dotenv is optional for the extension; CI can pass env directly.
}

const LOCAL_URL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;

function assertProductionEnv(env) {
  if (env.ALLOW_INSECURE_EXTENSION_BUILD === "true") return;

  const required = ["API_BASE_URL", "WEB_APP_URL", "PRIVY_APP_ID"];
  const missing = required.filter((key) => !env[key]);
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildManifest(source, isProduction) {
  const manifest = JSON.parse(source.toString());
  if (!isProduction) return JSON.stringify(manifest, null, 2);

  manifest.host_permissions = unique([
    "https://x.com/*",
    "https://twitter.com/*",
    "https://auth.privy.io/*",
    "https://*.privy.io/*",
    hostPermissionFromUrl(process.env.API_BASE_URL),
    hostPermissionFromUrl(process.env.RPC_URL || process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network"),
  ]);

  manifest.content_security_policy = {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https: wss:;",
  };

  return JSON.stringify(manifest, null, 2);
}

module.exports = (_env, argv) => {
  const isProduction = argv.mode === "production";
  if (isProduction) assertProductionEnv(process.env);

  return {
  entry: {
    content: "./src/content/index.tsx",
    background: "./src/background/index.ts",
    popup: "./src/popup/index.tsx",
    "wallet-lab": "./src/wallet-lab/index.tsx",
    "wallet-lab-sign": "./src/wallet-lab/signIndex.tsx",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true,
  },
  resolve: {
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
        use: "ts-loader",
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
            ignore: ["**/manifest.json"],
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
      "process.env.BLUR_EMAIL": JSON.stringify(process.env.BLUR_EMAIL || "false"),
      "process.env.DEBUG_TEEP": JSON.stringify(process.env.DEBUG_TEEP === "true" ? "true" : "false"),
      "process.env.DEBUG_TIPCOIN": JSON.stringify(process.env.DEBUG_TIPCOIN === "true" ? "true" : "false"),
      "process.env.WEB_APP_URL": JSON.stringify(process.env.WEB_APP_URL || "https://tipcoin.xyz"),
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
  ],
  devtool: isProduction ? false : "cheap-module-source-map",
  };
};
