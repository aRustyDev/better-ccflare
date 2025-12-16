#!/usr/bin/env node
/**
 * Test Coverage Gate
 *
 * TRIGGER: PreToolUse
 * MATCHER: Bash (when command contains "git push" or "git merge")
 *
 * Blocks pushes/merges if test coverage drops below configured threshold.
 * Compares current coverage against baseline or minimum requirement.
 *
 * EXIT CODES:
 *   0 - Coverage meets threshold
 *   2 - Coverage below threshold (blocks)
 */

const { execSync } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Default coverage thresholds
const THRESHOLDS = {
	lines: 70,
	branches: 60,
	functions: 70,
	statements: 70,
};

const colors = {
	red: "\x1b[0;31m",
	green: "\x1b[0;32m",
	yellow: "\x1b[0;33m",
	cyan: "\x1b[0;36m",
	reset: "\x1b[0m",
};

async function parseInput() {
	let data = "";
	for await (const chunk of process.stdin) {
		data += chunk;
	}
	return data.trim() ? JSON.parse(data) : null;
}

async function loadThresholds() {
	// Try to load custom thresholds from package.json or config
	const configPaths = [
		path.join(projectRoot, ".claude/hooks/hook-config.json"),
		path.join(projectRoot, "package.json"),
	];

	for (const configPath of configPaths) {
		try {
			const content = await fs.readFile(configPath, "utf8");
			const config = JSON.parse(content);

			// Check hook-config.json format
			if (config.coverageThresholds) {
				return { ...THRESHOLDS, ...config.coverageThresholds };
			}

			// Check package.json jest/vitest format
			if (config.jest?.coverageThreshold?.global) {
				return { ...THRESHOLDS, ...config.jest.coverageThreshold.global };
			}
		} catch (err) {
			// Continue to next config
		}
	}

	return THRESHOLDS;
}

function runCoverageCheck() {
	// Try different test runners
	const commands = [
		{ cmd: "bun run test -- --coverage --json 2>/dev/null", name: "bun/vitest" },
		{ cmd: "npx vitest run --coverage --reporter=json 2>/dev/null", name: "vitest" },
		{ cmd: "npx jest --coverage --json --silent 2>/dev/null", name: "jest" },
	];

	for (const { cmd, name } of commands) {
		try {
			const output = execSync(cmd, {
				cwd: projectRoot,
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 120000, // 2 minute timeout
			});

			return { runner: name, output, success: true };
		} catch (err) {
			if (err.stdout) {
				return { runner: name, output: err.stdout, success: true };
			}
			// Try next runner
		}
	}

	return { runner: null, output: null, success: false };
}

async function readCoverageFromFile() {
	// Try to read coverage from file if command output didn't work
	const coveragePaths = [
		path.join(projectRoot, "coverage/coverage-summary.json"),
		path.join(projectRoot, "coverage/coverage-final.json"),
	];

	for (const coveragePath of coveragePaths) {
		try {
			const content = await fs.readFile(coveragePath, "utf8");
			const data = JSON.parse(content);

			if (data.total) {
				return {
					lines: data.total.lines?.pct || 0,
					branches: data.total.branches?.pct || 0,
					functions: data.total.functions?.pct || 0,
					statements: data.total.statements?.pct || 0,
				};
			}
		} catch (err) {
			// Try next path
		}
	}

	return null;
}

function parseCoverageOutput(output, runner) {
	try {
		const data = JSON.parse(output);

		// Vitest format
		if (data.coverage?.total) {
			const total = data.coverage.total;
			return {
				lines: total.lines?.pct || 0,
				branches: total.branches?.pct || 0,
				functions: total.functions?.pct || 0,
				statements: total.statements?.pct || 0,
			};
		}

		// Jest format
		if (data.coverageMap) {
			const summary = data.coverageMap.total || data.coverageMap;
			return {
				lines: summary.lines?.pct || 0,
				branches: summary.branches?.pct || 0,
				functions: summary.functions?.pct || 0,
				statements: summary.statements?.pct || 0,
			};
		}

		return null;
	} catch (err) {
		return null;
	}
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const command = tool_input?.command || "";

	// Check if this is a push or merge command
	const isPushOrMerge =
		command.includes("git push") ||
		command.includes("git merge") ||
		command.includes("gh pr merge");

	if (!isPushOrMerge) {
		process.exit(0);
	}

	console.error("");
	console.error(`${colors.cyan}📊 Test Coverage Gate${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} Checking test coverage before ${command.includes("push") ? "push" : "merge"}...`);

	const thresholds = await loadThresholds();

	// Run coverage
	console.error(`${colors.blue}[INFO]${colors.reset} Running tests with coverage...`);
	const { runner, output, success } = runCoverageCheck();

	let coverage = null;

	if (success && output) {
		coverage = parseCoverageOutput(output, runner);
	}

	if (!coverage) {
		// Try reading from file
		coverage = await readCoverageFromFile();
	}

	if (!coverage) {
		console.error(`${colors.yellow}⚠️ Could not determine test coverage${colors.reset}`);
		console.error("   No test runner found or coverage not configured.");
		console.error("");
		console.error(`${colors.cyan}To enable coverage:${colors.reset}`);
		console.error("   1. Add vitest with @vitest/coverage-v8");
		console.error("   2. Or add jest with coverage configuration");
		console.error("");
		process.exit(0); // Don't block if we can't check
	}

	if (runner) {
		console.error(`${colors.blue}[INFO]${colors.reset} Using ${runner}`);
	}

	// Display coverage
	console.error("");
	console.error(`${colors.cyan}Coverage Results:${colors.reset}`);

	const failures = [];

	for (const [metric, threshold] of Object.entries(thresholds)) {
		const actual = coverage[metric] || 0;
		const passed = actual >= threshold;
		const color = passed ? colors.green : colors.red;
		const icon = passed ? "✓" : "✗";

		console.error(`   ${color}${icon}${colors.reset} ${metric}: ${actual.toFixed(1)}% (threshold: ${threshold}%)`);

		if (!passed) {
			failures.push({
				metric,
				actual,
				threshold,
				gap: threshold - actual,
			});
		}
	}

	if (failures.length > 0) {
		console.error("");
		console.error(`${colors.red}❌ Coverage below threshold${colors.reset}`);
		console.error("");
		console.error(`${colors.cyan}Failing metrics:${colors.reset}`);
		failures.forEach(f => {
			console.error(`   • ${f.metric}: needs +${f.gap.toFixed(1)}% more coverage`);
		});
		console.error("");
		console.error(`${colors.cyan}To fix:${colors.reset}`);
		console.error("   1. Add tests for uncovered code");
		console.error("   2. Or adjust thresholds in .claude/hooks/hook-config.json");
		console.error("");
		process.exit(2);
	}

	console.error("");
	console.error(`${colors.green}✅ Coverage meets all thresholds${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
