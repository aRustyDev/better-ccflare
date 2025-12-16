#!/usr/bin/env node
/**
 * Dependency Audit
 *
 * TRIGGER: PostToolUse
 * MATCHER: Write|Edit (on package.json files)
 *
 * Runs security audit after package.json changes to detect vulnerabilities.
 * Uses `bun audit` or `npm audit` depending on available tooling.
 *
 * EXIT CODES:
 *   0 - No vulnerabilities or non-package.json file
 *   2 - Critical/High vulnerabilities found (blocks)
 */

const { execSync } = require("child_process");
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const colors = {
	red: "\x1b[0;31m",
	green: "\x1b[0;32m",
	yellow: "\x1b[0;33m",
	cyan: "\x1b[0;36m",
	reset: "\x1b[0m",
};

// Severity levels that should block
const BLOCKING_SEVERITIES = ["critical", "high"];

async function parseInput() {
	let data = "";
	for await (const chunk of process.stdin) {
		data += chunk;
	}
	return data.trim() ? JSON.parse(data) : null;
}

function isPackageJson(filePath) {
	return path.basename(filePath) === "package.json";
}

function runAudit() {
	// Try bun first, fallback to npm
	const commands = [
		{ cmd: "bun audit --json 2>/dev/null", name: "bun" },
		{ cmd: "npm audit --json 2>/dev/null", name: "npm" },
	];

	for (const { cmd, name } of commands) {
		try {
			const output = execSync(cmd, {
				cwd: projectRoot,
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
			});

			return { tool: name, output, success: true };
		} catch (err) {
			// npm audit returns non-zero if vulnerabilities found
			if (err.stdout) {
				return { tool: name, output: err.stdout, success: true };
			}
			// Try next command
		}
	}

	return { tool: null, output: null, success: false };
}

function parseAuditResults(output, tool) {
	try {
		const data = JSON.parse(output);

		if (tool === "npm") {
			// npm audit format
			const vulnerabilities = data.vulnerabilities || {};
			const summary = {
				critical: 0,
				high: 0,
				moderate: 0,
				low: 0,
				info: 0,
				total: 0,
				packages: [],
			};

			for (const [pkg, info] of Object.entries(vulnerabilities)) {
				summary[info.severity] = (summary[info.severity] || 0) + 1;
				summary.total++;
				summary.packages.push({
					name: pkg,
					severity: info.severity,
					via: info.via?.map(v => typeof v === "string" ? v : v.title).join(", ") || "unknown",
				});
			}

			return summary;
		}

		// Bun audit format (similar structure)
		if (data.vulnerabilities) {
			return parseAuditResults(output, "npm");
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
	const filePath = tool_input?.file_path || tool_input?.path;

	if (!filePath || !isPackageJson(filePath)) {
		process.exit(0);
	}

	console.error("");
	console.error(`${colors.cyan}🔒 Dependency Security Audit${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} package.json modified, running security audit...`);

	const { tool, output, success } = runAudit();

	if (!success) {
		console.error(`${colors.yellow}⚠️ Could not run security audit (bun/npm not available)${colors.reset}`);
		process.exit(0);
	}

	console.error(`${colors.blue}[INFO]${colors.reset} Using ${tool} audit`);

	const results = parseAuditResults(output, tool);

	if (!results) {
		console.error(`${colors.yellow}⚠️ Could not parse audit results${colors.reset}`);
		process.exit(0);
	}

	if (results.total === 0) {
		console.error(`${colors.green}✅ No vulnerabilities found${colors.reset}`);
		process.exit(0);
	}

	// Display summary
	console.error("");
	console.error(`${colors.yellow}Vulnerability Summary:${colors.reset}`);
	if (results.critical > 0) {
		console.error(`   ${colors.red}Critical: ${results.critical}${colors.reset}`);
	}
	if (results.high > 0) {
		console.error(`   ${colors.red}High: ${results.high}${colors.reset}`);
	}
	if (results.moderate > 0) {
		console.error(`   ${colors.yellow}Moderate: ${results.moderate}${colors.reset}`);
	}
	if (results.low > 0) {
		console.error(`   Low: ${results.low}`);
	}

	// Show affected packages
	if (results.packages.length > 0) {
		console.error("");
		console.error(`${colors.cyan}Affected packages:${colors.reset}`);
		results.packages.slice(0, 10).forEach(pkg => {
			const severityColor = BLOCKING_SEVERITIES.includes(pkg.severity) ? colors.red : colors.yellow;
			console.error(`   ${severityColor}• ${pkg.name}${colors.reset} (${pkg.severity}): ${pkg.via}`);
		});
		if (results.packages.length > 10) {
			console.error(`   ... and ${results.packages.length - 10} more`);
		}
	}

	// Check for blocking severities
	const blockingCount = results.critical + results.high;

	if (blockingCount > 0) {
		console.error("");
		console.error(`${colors.red}❌ Found ${blockingCount} critical/high severity vulnerabilities${colors.reset}`);
		console.error("");
		console.error(`${colors.cyan}To fix:${colors.reset}`);
		console.error(`   ${tool} audit fix`);
		console.error("");
		console.error(`${colors.cyan}To see details:${colors.reset}`);
		console.error(`   ${tool} audit`);
		console.error("");
		process.exit(2); // Block on critical/high
	}

	console.error("");
	console.error(`${colors.yellow}⚠️ Found ${results.total} vulnerability(ies), but none critical/high${colors.reset}`);
	console.error(`${colors.green}✅ Allowing commit (review vulnerabilities when possible)${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
