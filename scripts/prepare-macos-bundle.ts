import { readdirSync } from "node:fs";
import { join } from "node:path";

if (process.env["ELECTROBUN_OS"] !== "macos") process.exit(0);

const buildDirectory = process.env["ELECTROBUN_BUILD_DIR"];
const wrapperBundle = process.env["ELECTROBUN_WRAPPER_BUNDLE_PATH"];
if (!buildDirectory && !wrapperBundle) throw new Error("缺少 macOS build 目录");

const appBundlePath = wrapperBundle ?? (() => {
	const appBundle = readdirSync(buildDirectory!, { withFileTypes: true }).find(
		(entry) => entry.isDirectory() && entry.name.endsWith(".app"),
	);
	if (!appBundle) throw new Error(`未在 ${buildDirectory} 中找到 .app`);
	return join(buildDirectory!, appBundle.name);
})();

if (!wrapperBundle) {
	const source = join(import.meta.dir, "..", "native", "keychain-helper.m");
	const output = join(appBundlePath, "Contents", "MacOS", "libPushLabKeychain.dylib");
	const result = Bun.spawnSync([
		"/usr/bin/clang", "-dynamiclib", "-fobjc-arc", "-framework", "Foundation",
		"-framework", "Security", "-o", output, source,
	]);
	if (result.exitCode !== 0) {
		throw new Error(`编译钥匙串辅助库失败：${new TextDecoder().decode(result.stderr)}`);
	}
	console.log("已编译：libPushLabKeychain.dylib");
}

const infoPlist = join(appBundlePath, "Contents", "Info.plist");
const updates: string[][] = [
	["-replace", "CFBundleDevelopmentRegion", "-string", "zh_CN"],
	["-replace", "CFBundleLocalizations", "-json", '["zh-Hans","zh-CN"]'],
	["-replace", "CFBundleAllowMixedLocalizations", "-bool", "YES"],
];
for (const update of updates) {
	const result = Bun.spawnSync(["/usr/bin/plutil", ...update, infoPlist]);
	if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}
console.log("macOS 语言配置完成：zh_CN");
