import { VitestReporter } from "tdd-guard-vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["**/*.test.ts", "**/*.spec.ts"],
		exclude: ["node_modules", "dist", "**/node_modules/**"],
		reporters: [new VitestReporter(), "default"],
		passWithNoTests: true,
	},
});
