const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const zlib = require("zlib");

const extensionRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(extensionRoot, "release");
const buildRoot = path.join(releaseRoot, "build");
const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
const zipPath = path.join(releaseRoot, `teep-extension-v${packageJson.version}.zip`);
const hashPath = `${zipPath}.sha256`;
const contextPath = path.join(releaseRoot, "build-context.json");
const fixedZipDate = new Date("2026-01-01T00:00:00Z");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function localUrl(value) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value || "");
}

function requireReleaseEnvironment() {
  const required = ["API_BASE_URL", "WEB_APP_URL", "PRIVY_APP_ID", "TIP_CONTRACT_ADDRESS", "USDC_ADDRESS"];
  const missing = required.filter((name) => !process.env[name]);
  if (!process.env.WALLET_FACTORY_ADDRESS && !process.env.FACTORY_ADDRESS) {
    missing.push("WALLET_FACTORY_ADDRESS");
  }
  if (missing.length) {
    fail(
      `Release build requires explicit production environment values: ${missing.join(", ")}. ` +
      "Set them in the command environment; the local extension .env is intentionally not accepted."
    );
  }
  for (const name of ["API_BASE_URL", "WEB_APP_URL", "RECEIPT_BASE_URL"]) {
    if (localUrl(process.env[name])) {
      fail(`Release build cannot use local ${name}: ${process.env[name]}`);
    }
  }
}

function hostPermissionFromUrl(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}/*`;
}

function expectedHostPermissions() {
  return [
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
  ].filter((value, index, values) => values.indexOf(value) === index);
}

function walkFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    else files.push(fullPath);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function build() {
  requireReleaseEnvironment();
  fs.rmSync(releaseRoot, { recursive: true, force: true });
  fs.mkdirSync(buildRoot, { recursive: true });

  const webpackCli = require.resolve("webpack-cli/bin/cli.js", { paths: [extensionRoot] });
  const result = spawnSync(
    process.execPath,
    [webpackCli, "--mode", "production", "--config", path.join(extensionRoot, "webpack.config.js")],
    {
      cwd: extensionRoot,
      env: {
        ...process.env,
        EXTENSION_OUTPUT_DIR: buildRoot,
        EXTENSION_RELEASE_BUILD: "true",
        ALLOW_INSECURE_EXTENSION_BUILD: "false",
        DEBUG_TEEP: "false",
        DEBUG_TIPCOIN: "false",
      },
      stdio: "inherit",
    }
  );
  if (result.status !== 0) fail(`Release webpack build failed with exit code ${result.status}.`);
  fs.writeFileSync(
    contextPath,
    `${JSON.stringify({ expectedHostPermissions: expectedHostPermissions() }, null, 2)}\n`,
    "utf8"
  );
  console.log(`Fresh release build created at ${buildRoot}`);
}

function verify() {
  if (!fs.existsSync(buildRoot)) fail("Release build directory does not exist. Run build:release first.");

  const requiredFiles = [
    "manifest.json",
    "popup.html",
    "popup.js",
    "background.js",
    "content.js",
    "icon16.png",
    "icon48.png",
    "icon128.png",
  ];
  const missing = requiredFiles.filter((name) => !fs.existsSync(path.join(buildRoot, name)));
  if (missing.length) fail(`Release artifact is missing required files: ${missing.join(", ")}`);

  const files = walkFiles(buildRoot);
  const relativeFiles = files.map((file) => path.relative(buildRoot, file).replace(/\\/g, "/"));
  const forbiddenFiles = relativeFiles.filter(
    (name) => name.endsWith(".map") || name.toLowerCase().includes("wallet-lab")
  );
  if (forbiddenFiles.length) fail(`Release artifact contains forbidden files: ${forbiddenFiles.join(", ")}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(buildRoot, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3) fail("Release manifest must use Manifest V3.");
  if (manifest.web_accessible_resources) fail("Release manifest must not expose web-accessible resources.");

  const unexpectedPermissions = (manifest.permissions || []).filter((permission) => permission !== "storage");
  if (unexpectedPermissions.length) {
    fail(`Release manifest contains unexpected permissions: ${unexpectedPermissions.join(", ")}`);
  }

  if (!fs.existsSync(contextPath)) {
    fail("Release build context is missing. Re-run build:release before verification.");
  }
  const context = JSON.parse(fs.readFileSync(contextPath, "utf8"));
  const actualHosts = [...(manifest.host_permissions || [])].sort();
  const expectedHosts = [...context.expectedHostPermissions].sort();
  if (JSON.stringify(actualHosts) !== JSON.stringify(expectedHosts)) {
    fail(
      "Release manifest host permissions do not match the build environment.\n" +
      `Expected: ${expectedHosts.join(", ")}\nActual: ${actualHosts.join(", ")}`
    );
  }

  const forbiddenText = [
    { label: "localhost", pattern: /https?:\/\/localhost(?::\d+)?/i },
    { label: "127.0.0.1", pattern: /https?:\/\/127\.0\.0\.1(?::\d+)?/i },
    { label: "IPv6 loopback", pattern: /https?:\/\/\[::1\](?::\d+)?/i },
    { label: "wallet lab", pattern: /wallet-lab/i },
    { label: "TIP_REQUEST_LAB", pattern: /TIP_REQUEST_LAB/ },
    { label: "source map reference", pattern: /sourceMappingURL=/ },
    { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  ];
  const textFiles = files.filter((file) => /\.(?:css|html|js|json|txt)$/i.test(file));
  const textFailures = [];
  for (const file of textFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const check of forbiddenText) {
      if (check.pattern.test(content)) {
        textFailures.push(`${path.relative(buildRoot, file)} (${check.label})`);
      }
    }
  }
  if (textFailures.length) {
    fail(`Release artifact verification failed:\n- ${textFailures.join("\n- ")}`);
  }

  console.log(`Release artifact verification passed (${relativeFiles.length} files).`);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function createDeterministicZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const timestamp = dosDateTime(fixedZipDate);

  for (const file of files) {
    const nameBuffer = Buffer.from(path.relative(buildRoot, file).replace(/\\/g, "/"), "utf8");
    const data = fs.readFileSync(file);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.day, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.day, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(0o100644 << 16, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function packageRelease() {
  verify();
  fs.mkdirSync(releaseRoot, { recursive: true });
  const zip = createDeterministicZip(walkFiles(buildRoot));
  fs.writeFileSync(zipPath, zip);
  const hash = crypto.createHash("sha256").update(zip).digest("hex");
  fs.writeFileSync(hashPath, `${hash}  ${path.basename(zipPath)}\n`, "utf8");
  console.log(`Release ZIP created: ${zipPath}`);
  console.log(`SHA-256: ${hash}`);
}

const command = process.argv[2];
if (command === "build") build();
else if (command === "verify") verify();
else if (command === "package") packageRelease();
else fail("Usage: node scripts/release.js <build|verify|package>");
