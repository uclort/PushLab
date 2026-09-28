import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const account = "dev.pushlab.app.tauri-updater";
const service = "PushLab.TauriUpdater";
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const keyPath = join(homedir(), ".tauri", "pushlab-updater.key");
const environment = { ...process.env };

if (!environment.TAURI_SIGNING_PRIVATE_KEY) {
  if (process.platform !== "darwin" || !existsSync(keyPath)) {
    throw new Error("缺少更新签名密钥。请先运行 npm run setup:updater，或在 CI 配置 Tauri 签名环境变量。");
  }
  const password = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-a", account, "-s", service, "-w"],
    { encoding: "utf8" },
  );
  if (password.status !== 0) {
    throw new Error(password.stderr || "无法从 macOS 钥匙串读取更新密钥密码");
  }
  environment.TAURI_SIGNING_PRIVATE_KEY = keyPath;
  environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = password.stdout.trim();
}

const executableDirectory = join(projectRoot, "node_modules", ".bin");
environment.PATH = `${executableDirectory}${delimiter}${environment.PATH ?? ""}`;
const build = spawnSync("tauri", ["build", ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: environment,
  stdio: "inherit",
});
process.exit(build.status ?? 1);
