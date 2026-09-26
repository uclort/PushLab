import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

if (process.env["ELECTROBUN_OS"] !== "macos") process.exit(0);
if (process.env["ELECTROBUN_BUILD_ENV"] !== "stable") process.exit(0);

const buildDirectory = process.env["ELECTROBUN_BUILD_DIR"];
const artifactDirectory = process.env["ELECTROBUN_ARTIFACT_DIR"];
if (!buildDirectory || !artifactDirectory) {
	throw new Error("缺少 Electrobun build/artifact 目录");
}

const wrapperName = readdirSync(buildDirectory).find((name) => name.endsWith(".app"));
if (!wrapperName) throw new Error(`未在 ${buildDirectory} 找到稳定版 App`);

const wrapper = join(buildDirectory, wrapperName);
const resources = join(wrapper, "Contents", "Resources");
const metadata = JSON.parse(readFileSync(join(resources, "metadata.json"), "utf8")) as {
	hash: string;
	name: string;
};
const archive = join(resources, `${metadata.hash}.tar.zst`);
if (!existsSync(archive)) throw new Error(`安装器缺少应用归档：${archive}`);

const staging = mkdtempSync(join(tmpdir(), "pushlab-direct-dmg-"));
const output = join(artifactDirectory, "PushLab-macos-arm64.dmg");
try {
	const extract = Bun.spawnSync(["/usr/bin/tar", "--zstd", "-xf", archive, "-C", staging]);
	if (extract.exitCode !== 0) {
		throw new Error(new TextDecoder().decode(extract.stderr) || "解压实际 App 失败");
	}

	const appName = readdirSync(staging).find((name) => name.endsWith(".app"));
	if (!appName) throw new Error("归档内未找到实际 App");
	const appPath = join(staging, appName);

	Bun.spawnSync(["/usr/bin/xattr", "-cr", appPath]);
	const sign = Bun.spawnSync(["/usr/bin/codesign", "--force", "--deep", "--sign", "-", appPath]);
	if (sign.exitCode !== 0) {
		throw new Error(new TextDecoder().decode(sign.stderr) || "签名实际 App 失败");
	}

	symlinkSync("/Applications", join(staging, "Applications"));
	rmSync(output, { force: true });
	const dmg = Bun.spawnSync([
		"/usr/bin/hdiutil",
		"create",
		"-volname", metadata.name,
		"-srcfolder", staging,
		"-ov",
		"-format", "ULFO",
		output,
	]);
	if (dmg.exitCode !== 0) {
		throw new Error(new TextDecoder().decode(dmg.stderr) || "创建直装 DMG 失败");
	}
	console.log(`已生成无 Setup 弹窗的拖拽安装包：${output}`);
} finally {
	rmSync(staging, { recursive: true, force: true });
}
