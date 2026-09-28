import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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

function run(command: string[], errorMessage: string) {
	const result = Bun.spawnSync(command);
	if (result.exitCode !== 0) {
		throw new Error(`${errorMessage}：${new TextDecoder().decode(result.stderr)}`);
	}
}

function setPlistValue(plist: string, key: string, type: string, value: string) {
	const replace = Bun.spawnSync(["/usr/bin/plutil", "-replace", key, type, value, plist]);
	if (replace.exitCode === 0) return;
	run(["/usr/bin/plutil", "-insert", key, type, value, plist], `写入 ${key} 失败`);
}

if (!wrapperBundle) {
	const source = join(import.meta.dir, "..", "native", "keychain-helper.m");
	const output = join(appBundlePath, "Contents", "MacOS", "libPushLabKeychain.dylib");
	run([
		"/usr/bin/clang", "-dynamiclib", "-fobjc-arc", "-framework", "Foundation",
		"-framework", "Security", "-o", output, source,
	], "编译钥匙串辅助库失败");
	console.log("已编译：libPushLabKeychain.dylib");

	const frameworksDirectory = join(appBundlePath, "Contents", "Frameworks");
	const sparkleSource = join(import.meta.dir, "..", "vendor", "Sparkle.framework");
	const sparkleTarget = join(frameworksDirectory, "Sparkle.framework");
	mkdirSync(frameworksDirectory, { recursive: true });
	rmSync(sparkleTarget, { recursive: true, force: true });
	run(["/usr/bin/ditto", sparkleSource, sparkleTarget], "复制 Sparkle.framework 失败");

	const updaterContents = join(appBundlePath, "Contents", "Library", "PushLabUpdater.app", "Contents");
	const updaterMacOS = join(updaterContents, "MacOS");
	const updaterInfo = join(updaterContents, "Info.plist");
	const updaterExecutable = join(updaterMacOS, "PushLabUpdater");
	mkdirSync(updaterMacOS, { recursive: true });
	copyFileSync(join(import.meta.dir, "..", "native", "updater-info.plist"), updaterInfo);
	run([
		"/usr/bin/clang",
		"-fobjc-arc",
		"-fblocks",
		"-mmacosx-version-min=12.0",
		"-framework", "Cocoa",
		"-F", frameworksDirectory,
		"-framework", "Sparkle",
		"-Wl,-rpath,@executable_path/../../../../Frameworks",
		"-o", updaterExecutable,
		join(import.meta.dir, "..", "native", "updater.m"),
	], "编译 Sparkle 更新辅助程序失败");
	console.log("已集成：Sparkle.framework 2.10.0");
}

const infoPlist = join(appBundlePath, "Contents", "Info.plist");
const updates: Array<[key: string, type: string, value: string]> = [
	["CFBundleDevelopmentRegion", "-string", "zh_CN"],
	["CFBundleLocalizations", "-json", '["zh-Hans","zh-CN"]'],
	["CFBundleAllowMixedLocalizations", "-bool", "YES"],
];
for (const [key, type, value] of updates) {
	setPlistValue(infoPlist, key, type, value);
}
console.log("macOS 语言配置完成：zh_CN");

if (!wrapperBundle) {
	const versionResult = Bun.spawnSync(["/usr/bin/plutil", "-extract", "CFBundleVersion", "raw", infoPlist]);
	if (versionResult.exitCode !== 0) throw new Error("读取 App 版本失败");
	const version = new TextDecoder().decode(versionResult.stdout).trim();
	const sparkleUpdates: Array<[key: string, type: string, value: string]> = [
		["CFBundleShortVersionString", "-string", version],
		["LSMinimumSystemVersion", "-string", "12.0"],
		["SUFeedURL", "-string", "https://github.com/uclort/PushLab/releases/latest/download/appcast.xml"],
		["SUPublicEDKey", "-string", "ByGJIESWKBIOv9npbLp3uPliX9NTioF1js6DfdN14OE="],
		["SUEnableAutomaticChecks", "-bool", "NO"],
		["SURequireSignedFeed", "-bool", "YES"],
		["SUVerifyUpdateBeforeExtraction", "-bool", "YES"],
	];
	for (const [key, type, value] of sparkleUpdates) {
		setPlistValue(infoPlist, key, type, value);
	}

	const updaterInfo = join(appBundlePath, "Contents", "Library", "PushLabUpdater.app", "Contents", "Info.plist");
	setPlistValue(updaterInfo, "CFBundleShortVersionString", "-string", version);
	setPlistValue(updaterInfo, "CFBundleVersion", "-string", version);
	console.log(`Sparkle 更新配置完成：${version}`);
}
