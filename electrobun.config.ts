import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "PushLab",
		identifier: "dev.pushlab.app",
		version: "0.1.2",
	},
	build: {
		mainProcess: "bun",
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
			"assets/pushlab-icon-1024.png": "views/mainview/pushlab-icon.png",
		},
		mac: { bundleCEF: false },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	},
	scripts: {
		postBuild: "scripts/prepare-macos-bundle.ts",
		postWrap: "scripts/prepare-macos-bundle.ts",
		postPackage: "scripts/package-direct-dmg.ts",
	},
} satisfies ElectrobunConfig;
