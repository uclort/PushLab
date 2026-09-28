import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");
const packageInfo = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
	version: string;
};
const version = packageInfo.version;
const artifact = join(projectRoot, "artifacts", "PushLab-macos-arm64.dmg");
const releaseNotes = join(projectRoot, "docs", "release-notes", `${version}.md`);
const generateAppcast = join(projectRoot, "vendor", "SparkleTools", "generate_appcast");
const output = join(projectRoot, "appcast.xml");

if (!existsSync(artifact)) throw new Error(`未找到更新包：${artifact}`);
if (!existsSync(releaseNotes)) throw new Error(`未找到版本说明：${releaseNotes}`);
if (!existsSync(generateAppcast)) throw new Error(`未找到 Sparkle 工具：${generateAppcast}`);

const staging = mkdtempSync(join(tmpdir(), "pushlab-appcast-"));
try {
	const stagedArtifact = join(staging, "PushLab-macos-arm64.dmg");
	copyFileSync(artifact, stagedArtifact);
	copyFileSync(releaseNotes, join(staging, "PushLab-macos-arm64.md"));

	const result = Bun.spawnSync([
		generateAppcast,
		"--account", "dev.pushlab.app",
		"--download-url-prefix", `https://github.com/uclort/PushLab/releases/download/v${version}/`,
		"--link", "https://github.com/uclort/PushLab",
		"--maximum-versions", "3",
		"--maximum-deltas", "0",
		"--embed-release-notes",
		"-o", output,
		staging,
	]);
	if (result.exitCode !== 0) {
		throw new Error(new TextDecoder().decode(result.stderr) || "生成 Sparkle Appcast 失败");
	}
	console.log(`已生成 Sparkle Appcast：${output}`);
} finally {
	rmSync(staging, { recursive: true, force: true });
}
