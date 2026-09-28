export default {
	scripts: {
		install: ["hutch", "install", "--frozen-lockfile"],
		start: ["hutch", "electrobun", "dev"],
		dev: ["hutch", "electrobun", "dev", "--watch"],
		build: ["hutch", "electrobun", "build", "--env=stable"],
		appcast: ["hutch", "scripts/generate-sparkle-appcast.ts"],
		test: ["hutch", "test", "src/bun/apns.test.ts"],
	},
	electrobun: {
		version: "2.0.1",
	},
};
