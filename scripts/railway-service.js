const { spawnSync } = require("node:child_process");

const action = process.argv[2];
const serviceName = (
  process.env.TEEP_RAILWAY_SERVICE ||
  process.env.RAILWAY_SERVICE_NAME ||
  ""
).toLowerCase();

function resolveService() {
  if (["backend", "web", "x-agent"].includes(serviceName)) {
    return serviceName;
  }
  if (serviceName.includes("x-agent") || serviceName.includes("x_agent")) {
    return "x-agent";
  }
  if (serviceName.includes("web") || serviceName.includes("frontend")) {
    return "web";
  }
  if (serviceName.includes("backend") || serviceName.includes("api")) {
    return "backend";
  }

  throw new Error(
    "Unable to determine Railway service. Set TEEP_RAILWAY_SERVICE to backend, web, or x-agent.",
  );
}

function npm(args) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status || 0;
}

const service = resolveService();
console.log(`[railway] ${action} for ${service} (${serviceName || "unnamed service"})`);

switch (action) {
  case "build":
    if (service === "backend") npm(["run", "backend:build"]);
    if (service === "web") npm(["run", "web:build:prod"]);
    if (service === "x-agent") npm(["run", "x-agent:build"]);
    break;

  case "migrate":
    if (service === "backend") {
      npm(["run", "backend:db:migrate:prod"]);
    } else {
      console.log(`[railway] Skipping database migration for ${service}.`);
    }
    break;

  case "start":
    if (service === "backend") npm(["run", "start", "--workspace=backend"]);
    if (service === "web") {
      npm([
        "run",
        "preview",
        "--workspace=web",
        "--",
        "--host",
        "0.0.0.0",
        "--port",
        process.env.PORT || "4173",
      ]);
    }
    if (service === "x-agent") npm(["run", "start", "--workspace=x-agent"]);
    break;

  default:
    throw new Error("Expected action: build, migrate, or start.");
}
