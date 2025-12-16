#!/usr/bin/env node
/**
 * Docker Compose Validator
 *
 * TRIGGER: PostToolUse
 * MATCHER: Write|Edit|MultiEdit (on *compose*.yml, *compose*.yaml)
 *
 * Validates Docker Compose files for syntax and configuration errors.
 * Uses `docker compose config` to check validity.
 *
 * REQUIRES: docker compose (Docker Desktop or docker-compose-plugin)
 *
 * EXIT CODES:
 *   0 - Valid compose file
 *   2 - Invalid compose file (blocks)
 */

const { execSync } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Common compose file patterns
const COMPOSE_PATTERNS = [
	/compose\.ya?ml$/i,
	/docker-compose\.ya?ml$/i,
	/compose\..+\.ya?ml$/i,
	/docker-compose\..+\.ya?ml$/i,
];

// Validation checks beyond docker compose config
const BEST_PRACTICE_CHECKS = [
	{
		name: "version-deprecated",
		pattern: /^version:\s*["']?[23]\./m,
		message: "The 'version' key is deprecated in Compose v2+",
		severity: "warning",
	},
	{
		name: "latest-tag",
		pattern: /image:\s*[^\n]*:latest/m,
		message: "Using ':latest' tag - consider pinning to specific version",
		severity: "warning",
	},
	{
		name: "no-restart-policy",
		pattern: /services:[\s\S]*?(?=services:|$)/,
		antiPattern: /restart:/,
		message: "No restart policy defined - containers won't restart on failure",
		severity: "info",
	},
	{
		name: "privileged-mode",
		pattern: /privileged:\s*true/i,
		message: "Running in privileged mode - security risk",
		severity: "warning",
	},
	{
		name: "host-network",
		pattern: /network_mode:\s*["']?host["']?/i,
		message: "Using host network mode - may expose ports unintentionally",
		severity: "info",
	},
	{
		name: "root-user",
		pattern: /user:\s*["']?(?:0|root)["']?/i,
		message: "Running as root user",
		severity: "info",
	},
];

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

function isComposeFile(filePath) {
	const basename = path.basename(filePath);
	return COMPOSE_PATTERNS.some(pattern => pattern.test(basename));
}

function checkDockerInstalled() {
	try {
		execSync("docker compose version", { stdio: ["pipe", "pipe", "pipe"] });
		return true;
	} catch {
		try {
			execSync("docker-compose version", { stdio: ["pipe", "pipe", "pipe"] });
			return "legacy";
		} catch {
			return false;
		}
	}
}

function validateCompose(filePath) {
	const composeCmd = checkDockerInstalled();

	if (!composeCmd) {
		return { success: false, error: "Docker Compose not installed" };
	}

	const cmd = composeCmd === "legacy"
		? `docker-compose -f "${filePath}" config --quiet`
		: `docker compose -f "${filePath}" config --quiet`;

	try {
		execSync(cmd, {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});

		return { success: true, valid: true };
	} catch (err) {
		const errorMessage = err.stderr || err.stdout || err.message;
		return { success: true, valid: false, error: errorMessage };
	}
}

async function checkBestPractices(filePath) {
	const issues = [];

	try {
		const content = await fs.readFile(filePath, "utf8");

		for (const check of BEST_PRACTICE_CHECKS) {
			if (check.antiPattern) {
				// Check if pattern exists WITHOUT antiPattern
				if (check.pattern.test(content) && !check.antiPattern.test(content)) {
					issues.push({
						name: check.name,
						message: check.message,
						severity: check.severity,
					});
				}
			} else if (check.pattern.test(content)) {
				issues.push({
					name: check.name,
					message: check.message,
					severity: check.severity,
				});
			}
		}
	} catch (err) {
		// Can't read file, skip best practice checks
	}

	return issues;
}

function extractServiceInfo(filePath) {
	try {
		const composeCmd = checkDockerInstalled();
		if (!composeCmd) return null;

		const cmd = composeCmd === "legacy"
			? `docker-compose -f "${filePath}" config --services`
			: `docker compose -f "${filePath}" config --services`;

		const output = execSync(cmd, {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});

		return output.trim().split("\n").filter(Boolean);
	} catch {
		return null;
	}
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;

	if (!filePath || !isComposeFile(filePath)) {
		process.exit(0);
	}

	const relativePath = path.relative(projectRoot, filePath);

	console.error("");
	console.error(`${colors.cyan}🐙 Docker Compose Validator${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} Validating: ${relativePath}`);

	// Check if docker compose is installed
	const dockerInstalled = checkDockerInstalled();
	if (!dockerInstalled) {
		console.error("");
		console.error(`${colors.yellow}⚠️ Docker Compose not installed${colors.reset}`);
		console.error("");
		console.error(`${colors.cyan}Install with:${colors.reset}`);
		console.error("   Docker Desktop (includes compose)");
		console.error("   apt-get install docker-compose-plugin");
		console.error("");
		process.exit(0);
	}

	// Validate syntax
	const validation = validateCompose(filePath);

	if (!validation.valid) {
		console.error("");
		console.error(`${colors.red}❌ Invalid Compose file${colors.reset}`);
		console.error("");

		// Parse and display error
		const errorLines = validation.error?.split("\n").filter(Boolean) || [];
		for (const line of errorLines.slice(0, 10)) {
			console.error(`   ${colors.red}${line}${colors.reset}`);
		}

		console.error("");
		console.error(`${colors.cyan}Common fixes:${colors.reset}`);
		console.error("   • Check indentation (YAML is whitespace-sensitive)");
		console.error("   • Ensure all referenced services exist");
		console.error("   • Verify environment variable syntax");
		console.error("   • Check for missing colons after keys");
		console.error("");
		console.error(`${colors.red}⛔ Blocking due to invalid Compose syntax${colors.reset}`);
		process.exit(2);
	}

	// Show services
	const services = extractServiceInfo(filePath);
	if (services && services.length > 0) {
		console.error(`${colors.blue}[INFO]${colors.reset} Services: ${services.join(", ")}`);
	}

	// Check best practices
	const issues = await checkBestPractices(filePath);

	if (issues.length > 0) {
		console.error("");
		const warnings = issues.filter(i => i.severity === "warning");
		const infos = issues.filter(i => i.severity === "info");

		if (warnings.length > 0) {
			console.error(`${colors.yellow}Warnings (${warnings.length}):${colors.reset}`);
			for (const issue of warnings) {
				console.error(`   ${colors.yellow}•${colors.reset} [${issue.name}] ${issue.message}`);
			}
		}

		if (infos.length > 0) {
			console.error("");
			console.error(`${colors.blue}Suggestions (${infos.length}):${colors.reset}`);
			for (const issue of infos) {
				console.error(`   ${colors.blue}•${colors.reset} [${issue.name}] ${issue.message}`);
			}
		}
	}

	console.error("");
	console.error(`${colors.green}✅ Compose file is valid${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
