#!/usr/bin/env node
/**
 * Dockerfile Linter (hadolint)
 *
 * TRIGGER: PostToolUse
 * MATCHER: Write|Edit|MultiEdit (on Dockerfile*)
 *
 * Lints Dockerfiles using hadolint to enforce best practices.
 * Catches common issues like missing USER directive, unpinned versions, etc.
 *
 * REQUIRES: hadolint (brew install hadolint / apt-get install hadolint)
 *
 * EXIT CODES:
 *   0 - No errors (warnings allowed)
 *   2 - Errors found (blocks)
 */

const { execSync } = require("child_process");
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Severity levels
const SEVERITY = {
	error: "error",
	warning: "warning",
	info: "info",
	style: "style",
};

// Rules to ignore (customize as needed)
const IGNORED_RULES = [
	// "DL3008", // Pin versions in apt-get install
	// "DL3018", // Pin versions in apk add
];

// Severity threshold for blocking
const BLOCK_ON = ["error"]; // Add "warning" to block on warnings too

const colors = {
	red: "\x1b[0;31m",
	green: "\x1b[0;32m",
	yellow: "\x1b[0;33m",
	blue: "\x1b[0;34m",
	cyan: "\x1b[0;36m",
	magenta: "\x1b[0;35m",
	reset: "\x1b[0m",
};

async function parseInput() {
	let data = "";
	for await (const chunk of process.stdin) {
		data += chunk;
	}
	return data.trim() ? JSON.parse(data) : null;
}

function isDockerfile(filePath) {
	const basename = path.basename(filePath);
	return (
		basename === "Dockerfile" ||
		basename.startsWith("Dockerfile.") ||
		basename.endsWith(".dockerfile")
	);
}

function checkHadolintInstalled() {
	try {
		execSync("hadolint --version", { stdio: ["pipe", "pipe", "pipe"] });
		return true;
	} catch {
		return false;
	}
}

function runHadolint(filePath) {
	const ignoreFlags = IGNORED_RULES.map(rule => `--ignore ${rule}`).join(" ");

	try {
		const cmd = `hadolint --format json ${ignoreFlags} "${filePath}"`;
		const output = execSync(cmd, {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});

		return { success: true, results: JSON.parse(output || "[]") };
	} catch (err) {
		// hadolint returns non-zero if issues found
		if (err.stdout) {
			try {
				return { success: true, results: JSON.parse(err.stdout) };
			} catch {
				// Parse error
			}
		}
		if (err.stderr) {
			return { success: false, error: err.stderr };
		}
		return { success: false, error: err.message };
	}
}

function categorizeResults(results) {
	const categorized = {
		error: [],
		warning: [],
		info: [],
		style: [],
	};

	for (const result of results) {
		const level = result.level?.toLowerCase() || "warning";
		if (categorized[level]) {
			categorized[level].push(result);
		} else {
			categorized.warning.push(result);
		}
	}

	return categorized;
}

function formatRule(result) {
	const rule = result.code || "unknown";
	const line = result.line || "?";
	const message = result.message || "Unknown issue";
	return { rule, line, message };
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;

	if (!filePath || !isDockerfile(filePath)) {
		process.exit(0);
	}

	const relativePath = path.relative(projectRoot, filePath);

	console.error("");
	console.error(`${colors.cyan}🐳 Dockerfile Linter (hadolint)${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} Linting: ${relativePath}`);

	// Check if hadolint is installed
	if (!checkHadolintInstalled()) {
		console.error("");
		console.error(`${colors.yellow}⚠️ hadolint not installed${colors.reset}`);
		console.error("");
		console.error(`${colors.cyan}Install with:${colors.reset}`);
		console.error("   brew install hadolint       # macOS");
		console.error("   apt-get install hadolint    # Debian/Ubuntu");
		console.error("   scoop install hadolint      # Windows");
		console.error("");
		process.exit(0);
	}

	const { success, results, error } = runHadolint(filePath);

	if (!success) {
		console.error(`${colors.red}[ERROR]${colors.reset} hadolint failed: ${error}`);
		process.exit(0);
	}

	if (!results || results.length === 0) {
		console.error(`${colors.green}✅ No issues found${colors.reset}`);
		process.exit(0);
	}

	const categorized = categorizeResults(results);
	const errorCount = categorized.error.length;
	const warningCount = categorized.warning.length;
	const infoCount = categorized.info.length + categorized.style.length;

	// Display errors
	if (errorCount > 0) {
		console.error("");
		console.error(`${colors.red}Errors (${errorCount}):${colors.reset}`);
		for (const result of categorized.error) {
			const { rule, line, message } = formatRule(result);
			console.error(`   ${colors.red}•${colors.reset} Line ${line}: [${rule}] ${message}`);
		}
	}

	// Display warnings
	if (warningCount > 0) {
		console.error("");
		console.error(`${colors.yellow}Warnings (${warningCount}):${colors.reset}`);
		for (const result of categorized.warning.slice(0, 10)) {
			const { rule, line, message } = formatRule(result);
			console.error(`   ${colors.yellow}•${colors.reset} Line ${line}: [${rule}] ${message}`);
		}
		if (warningCount > 10) {
			console.error(`   ... and ${warningCount - 10} more warnings`);
		}
	}

	// Display info/style count
	if (infoCount > 0) {
		console.error("");
		console.error(`${colors.blue}Info/Style: ${infoCount} suggestions${colors.reset}`);
	}

	console.error("");

	// Common fixes
	console.error(`${colors.cyan}Common fixes:${colors.reset}`);
	console.error("   • DL3008: Pin apt package versions (package=version)");
	console.error("   • DL3018: Pin apk package versions (package=version)");
	console.error("   • DL3025: Use JSON notation for CMD/ENTRYPOINT");
	console.error("   • DL4006: Set SHELL for pipefail in RUN");
	console.error("");
	console.error(`${colors.cyan}Documentation:${colors.reset} https://github.com/hadolint/hadolint#rules`);
	console.error("");

	// Check if we should block
	const shouldBlock = BLOCK_ON.some(level => categorized[level]?.length > 0);

	if (shouldBlock) {
		console.error(`${colors.red}⛔ Blocking due to Dockerfile errors${colors.reset}`);
		process.exit(2);
	}

	console.error(`${colors.yellow}⚠️ Warnings found (not blocking)${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
