import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const account = "dev.pushlab.app.tauri-updater";
const service = "PushLab.TauriUpdater";
const keyPath = join(homedir(), ".tauri", "pushlab-updater.key");
const publicKeyPath = `${keyPath}.pub`;
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(projectRoot, "src-tauri", "tauri.conf.json");

if (process.platform !== "darwin") {
  throw new Error("本地签名密钥初始化当前仅支持 macOS；CI 请直接配置 TAURI_SIGNING_PRIVATE_KEY。");
}

if (!existsSync(keyPath) || !existsSync(publicKeyPath)) {
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  const password = randomBytes(36).toString("base64url");
  const generated = spawnSync(
    "npx",
    ["tauri", "signer", "generate", "--ci", "--password", password, "--write-keys", keyPath],
    { cwd: projectRoot, encoding: "utf8" },
  );
  if (generated.status !== 0) {
    throw new Error(generated.stderr || generated.stdout || "生成 Tauri 更新签名密钥失败");
  }
  const saved = spawnSync(
    "/usr/bin/security",
    ["add-generic-password", "-U", "-a", account, "-s", service, "-w", password],
    { encoding: "utf8" },
  );
  if (saved.status !== 0) {
    throw new Error(saved.stderr || "无法将更新密钥密码保存到 macOS 钥匙串");
  }
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
config.plugins.updater.pubkey = readFileSync(publicKeyPath, "utf8").trim();
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Tauri 更新公钥已写入：${configPath}`);
console.log(`私钥保存在：${keyPath}`);
console.log(`私钥密码保存在 macOS 钥匙串服务：${service}`);
