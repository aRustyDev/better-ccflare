#!/usr/bin/env node
/**
 * Secret Scanner (gitleaks)
 *
 * TRIGGER: PreToolUse
 * MATCHER: Write|Edit|MultiEdit
 *
 * Scans file content for secrets using gitleaks before writing.
 * More comprehensive than the basic secrets-scanner hook (08).
 *
 * REQUIRES: gitleaks (brew install gitleaks / go install github.com/gitleaks/gitleaks/v8@latest)
 *
 * EXIT CODES:
 *   0 - No secrets detected
 *   2 - Secrets found (blocks)
 */

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Files that are allowed to contain secret-like patterns
const ALLOWED_PATTERNS = [
	/\.env\.example$/,
	/\.env\.sample$/,
	/\.env\.template$/,
	/secret.*scanner.*\.js$/, // This file and related
	/gitleaks.*\.toml$/,      // Gitleaks config
	/\.gitleaks.*\.toml$/,
	/test.*\.(ts|js)$/,       // Test files
	/\.test\.(ts|js)$/,
	/\.spec\.(ts|js)$/,
	/mock.*\.(ts|js)$/,
	/fixture.*\.(ts|js)$/,
];

// Gitleaks rules to ignore (add rule IDs as needed)
const IGNORED_RULES = [
	// "generic-api-key", // Uncomment to ignore generic API key detection
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

function isAllowedFile(filePath) {
	const relativePath = path.relative(projectRoot, filePath);
	return ALLOWED_PATTERNS.some(pattern => pattern.test(relativePath));
}

function checkGitleaksInstalled() {
	try {
		execSync("gitleaks version", { stdio: ["pipe", "pipe", "pipe"] });
		return true;
	} catch {
		return false;
	}
}

function getContentFromInput(toolInput) {
	if (toolInput.content !== undefined) {
		return toolInput.content;
	}
	if (toolInput.new_string !== undefined) {
		return toolInput.new_string;
	}
	if (toolInput.edits) {
		return toolInput.edits.map(e => e.new_string || "").join("\n");
	}
	return null;
}

function scanWithGitleaks(content, filePath) {
	// Create a temporary file with the content
	const tempDir = os.tmpdir();
	const tempFile = path.join(tempDir, `gitleaks-scan-${Date.now()}-${path.basename(filePath)}`);

	try {
		fs.writeFileSync(tempFile, content);

		// Run gitleaks on the temp file
		const result = spawnSync("gitleaks", [
			"detect",
			"--source", tempDir,
			"--no-git",
			"--report-format", "json",
			"--exit-code", "0", // Don't exit non-zero, we'll check the output
		], {
			cwd: projectRoot,
			encoding: "utf8",
			timeout: 30000,
		});

		// Clean up temp file
		fs.unlinkSync(tempFile);

		if (result.error) {
			return { success: false, error: result.error.message };
		}

		// Try to find findings in stdout
		try {
			// gitleaks outputs findings to stdout as JSON array
			const findings = JSON.parse(result.stdout || "[]");
			// Filter to only findings from our temp file
			const relevantFindings = findings.filter(f =>
				f.File?.includes(path.basename(filePath)) ||
				f.file?.includes(path.basename(filePath))
			);
			return { success: true, findings: relevantFindings };
		} catch {
			return { success: true, findings: [] };
		}
	} catch (err) {
		// Clean up temp file on error
		try {
			fs.unlinkSync(tempFile);
		} catch {
			// Ignore cleanup errors
		}
		return { success: false, error: err.message };
	}
}

function scanContentDirectly(content) {
	// Alternative: scan content directly using stdin
	try {
		const result = spawnSync("gitleaks", [
			"detect",
			"--pipe",
			"--report-format", "json",
		], {
			input: content,
			encoding: "utf8",
			timeout: 30000,
		});

		if (result.error) {
			return { success: false, error: result.error.message };
		}

		try {
			const findings = JSON.parse(result.stdout || "[]");
			return { success: true, findings };
		} catch {
			// Check if gitleaks found secrets (exit code 1)
			if (result.status === 1) {
				return { success: true, findings: [{ RuleID: "unknown", Description: "Secret detected" }] };
			}
			return { success: true, findings: [] };
		}
	} catch (err) {
		return { success: false, error: err.message };
	}
}

function filterIgnoredRules(findings) {
	if (IGNORED_RULES.length === 0) {
		return findings;
	}
	return findings.filter(f => !IGNORED_RULES.includes(f.RuleID || f.ruleID));
}

function maskSecret(secret) {
	if (!secret || secret.length <= 8) {
		return "*".repeat(secret?.length || 8);
	}
	const visible = Math.min(4, Math.floor(secret.length / 4));
	return secret.slice(0, visible) + "*".repeat(secret.length - visible * 2) + secret.slice(-visible);
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;
	const content = getContentFromInput(tool_input);

	if (!filePath || !content) {
		process.exit(0);
	}

	// Skip allowed files
	if (isAllowedFile(filePath)) {
		process.exit(0);
	}

	const relativePath = path.relative(projectRoot, filePath);

	// Check if gitleaks is installed
	if (!checkGitleaksInstalled()) {
		// Fall back silently - the basic secrets scanner (08) will catch common cases
		process.exit(0);
	}

	// Scan content
	let scanResult = scanContentDirectly(content);

	// If pipe mode fails, try file-based scanning
	if (!scanResult.success) {
		scanResult = scanWithGitleaks(content, filePath);
	}

	if (!scanResult.success) {
		// Don't block on scan failures
		process.exit(0);
	}

	const findings = filterIgnoredRules(scanResult.findings || []);

	if (findings.length === 0) {
		process.exit(0);
	}

	// Display findings
	console.error("");
	console.error(`${colors.red}🔐 Secret Scanner (gitleaks)${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.red}❌ Secrets detected in: ${relativePath}${colors.reset}`);
	console.error("");

	console.error(`${colors.red}Findings (${findings.length}):${colors.reset}`);
	for (const finding of findings.slice(0, 10)) {
		const ruleId = finding.RuleID || finding.ruleID || "unknown";
		const description = finding.Description || finding.description || "Secret detected";
		const line = finding.StartLine || finding.startLine || "?";
		const secret = finding.Secret || finding.secret || finding.Match || finding.match;

		console.error(`   ${colors.red}•${colors.reset} [${ruleId}] ${description}`);
		console.error(`     Line: ${line}`);
		if (secret) {
			console.error(`     Match: ${colors.magenta}${maskSecret(secret)}${colors.reset}`);
		}
	}

	if (findings.length > 10) {
		console.error(`   ... and ${findings.length - 10} more findings`);
	}

	console.error("");
	console.error(`${colors.cyan}Recommendations:${colors.reset}`);
	console.error("   1. Use environment variables instead of hardcoded secrets");
	console.error("   2. Add secrets to .env file (ensure .env is in .gitignore)");
	console.error("   3. Use a secrets manager (AWS Secrets Manager, HashiCorp Vault)");
	console.error("");
	console.error(`${colors.cyan}To scan manually:${colors.reset}`);
	console.error(`   gitleaks detect --source ${path.dirname(relativePath) || "."}`);
	console.error("");
	console.error(`${colors.cyan}To ignore a rule:${colors.reset}`);
	console.error("   Add rule ID to IGNORED_RULES in this hook");
	console.error("   Or create a .gitleaks.toml config file");
	console.error("");
	console.error(`${colors.red}⛔ Blocking due to detected secrets${colors.reset}`);
	process.exit(2);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
