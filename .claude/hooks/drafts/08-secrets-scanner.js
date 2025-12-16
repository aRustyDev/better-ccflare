#!/usr/bin/env node
/**
 * Secrets Scanner
 *
 * TRIGGER: PreToolUse
 * MATCHER: Write|Edit|MultiEdit
 *
 * Detects API keys, tokens, passwords, and other secrets before they're written.
 * Uses pattern matching to identify common secret formats.
 *
 * EXIT CODES:
 *   0 - No secrets detected
 *   2 - Potential secrets found (blocks)
 */

const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Files that are allowed to contain secret-like patterns
const ALLOWED_FILES = [
	/\.env\.example$/,
	/\.env\.sample$/,
	/\.env\.template$/,
	/secrets-scanner\.js$/, // This file itself
	/test.*\.(ts|js)$/,     // Test files
	/\.test\.(ts|js)$/,
	/\.spec\.(ts|js)$/,
	/mock.*\.(ts|js)$/,
	/fixture.*\.(ts|js)$/,
];

// Patterns that indicate secrets (with descriptions)
const SECRET_PATTERNS = [
	// API Keys
	{
		name: "AWS Access Key",
		pattern: /AKIA[0-9A-Z]{16}/g,
		severity: "critical",
	},
	{
		name: "AWS Secret Key",
		pattern: /[0-9a-zA-Z/+]{40}/g,
		context: /aws.*secret|secret.*key/i,
		severity: "critical",
	},
	{
		name: "GitHub Token",
		pattern: /ghp_[0-9a-zA-Z]{36}/g,
		severity: "critical",
	},
	{
		name: "GitHub OAuth",
		pattern: /gho_[0-9a-zA-Z]{36}/g,
		severity: "critical",
	},
	{
		name: "GitHub App Token",
		pattern: /ghu_[0-9a-zA-Z]{36}/g,
		severity: "critical",
	},
	{
		name: "GitLab Token",
		pattern: /glpat-[0-9a-zA-Z_-]{20}/g,
		severity: "critical",
	},
	{
		name: "Slack Token",
		pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g,
		severity: "critical",
	},
	{
		name: "Stripe Key",
		pattern: /sk_live_[0-9a-zA-Z]{24,}/g,
		severity: "critical",
	},
	{
		name: "Stripe Test Key",
		pattern: /sk_test_[0-9a-zA-Z]{24,}/g,
		severity: "high",
	},
	{
		name: "SendGrid Key",
		pattern: /SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/g,
		severity: "critical",
	},
	{
		name: "Twilio Key",
		pattern: /SK[0-9a-fA-F]{32}/g,
		severity: "critical",
	},
	{
		name: "OpenAI Key",
		pattern: /sk-[0-9a-zA-Z]{48}/g,
		severity: "critical",
	},
	{
		name: "Anthropic Key",
		pattern: /sk-ant-[0-9a-zA-Z_-]{90,}/g,
		severity: "critical",
	},

	// Generic patterns
	{
		name: "Private Key",
		pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
		severity: "critical",
	},
	{
		name: "Generic API Key",
		pattern: /api[_-]?key[_-]?[=:]["']?[0-9a-zA-Z]{20,}["']?/gi,
		severity: "high",
	},
	{
		name: "Generic Secret",
		pattern: /(?:secret|password|passwd|pwd)[_-]?[=:]["']?[^\s"']{8,}["']?/gi,
		severity: "high",
		exclude: /example|placeholder|your[_-]?|<.*>|\*{3,}|\.{3,}/i,
	},
	{
		name: "Bearer Token",
		pattern: /Bearer\s+[0-9a-zA-Z_-]{20,}/g,
		severity: "high",
	},
	{
		name: "Basic Auth",
		pattern: /Basic\s+[A-Za-z0-9+/=]{20,}/g,
		severity: "high",
	},
	{
		name: "JWT Token",
		pattern: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
		severity: "high",
	},

	// Database URLs with credentials
	{
		name: "Database URL with Password",
		pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s"']+/gi,
		severity: "critical",
	},
];

const colors = {
	red: "\x1b[0;31m",
	green: "\x1b[0;32m",
	yellow: "\x1b[0;33m",
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
	return ALLOWED_FILES.some(pattern => pattern.test(relativePath));
}

function scanContent(content, filePath) {
	const findings = [];

	for (const { name, pattern, severity, context, exclude } of SECRET_PATTERNS) {
		// Reset regex state
		pattern.lastIndex = 0;

		let match;
		while ((match = pattern.exec(content)) !== null) {
			const matchedText = match[0];

			// Skip if matches exclusion pattern
			if (exclude && exclude.test(matchedText)) {
				continue;
			}

			// If context is required, check surrounding text
			if (context) {
				const start = Math.max(0, match.index - 50);
				const end = Math.min(content.length, match.index + matchedText.length + 50);
				const surrounding = content.slice(start, end);
				if (!context.test(surrounding)) {
					continue;
				}
			}

			// Find line number
			const lines = content.slice(0, match.index).split("\n");
			const lineNumber = lines.length;

			// Mask the secret
			const masked = maskSecret(matchedText);

			findings.push({
				name,
				severity,
				line: lineNumber,
				masked,
				length: matchedText.length,
			});
		}
	}

	return findings;
}

function maskSecret(secret) {
	if (secret.length <= 8) {
		return "*".repeat(secret.length);
	}

	const visible = Math.min(4, Math.floor(secret.length / 4));
	return secret.slice(0, visible) + "*".repeat(secret.length - visible * 2) + secret.slice(-visible);
}

function getContentFromInput(toolInput) {
	// For Write tool
	if (toolInput.content) {
		return toolInput.content;
	}

	// For Edit tool
	if (toolInput.new_string) {
		return toolInput.new_string;
	}

	// For MultiEdit tool
	if (toolInput.edits) {
		return toolInput.edits.map(e => e.new_string || "").join("\n");
	}

	return null;
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
	const findings = scanContent(content, filePath);

	if (findings.length === 0) {
		process.exit(0);
	}

	// Group findings by severity
	const critical = findings.filter(f => f.severity === "critical");
	const high = findings.filter(f => f.severity === "high");

	console.error("");
	console.error(`${colors.red}🔐 Secrets Scanner${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.red}❌ Potential secrets detected in: ${relativePath}${colors.reset}`);
	console.error("");

	if (critical.length > 0) {
		console.error(`${colors.red}CRITICAL (${critical.length}):${colors.reset}`);
		critical.forEach(f => {
			console.error(`   ${colors.red}•${colors.reset} Line ${f.line}: ${f.name}`);
			console.error(`     ${colors.magenta}${f.masked}${colors.reset}`);
		});
		console.error("");
	}

	if (high.length > 0) {
		console.error(`${colors.yellow}HIGH (${high.length}):${colors.reset}`);
		high.forEach(f => {
			console.error(`   ${colors.yellow}•${colors.reset} Line ${f.line}: ${f.name}`);
			console.error(`     ${colors.magenta}${f.masked}${colors.reset}`);
		});
		console.error("");
	}

	console.error(`${colors.cyan}Recommendations:${colors.reset}`);
	console.error("   1. Use environment variables instead of hardcoded secrets");
	console.error("   2. Add secrets to .env and .env to .gitignore");
	console.error("   3. Use a secrets manager for production");
	console.error("");
	console.error(`${colors.cyan}To allow this file:${colors.reset}`);
	console.error("   • Rename to .env.example (for templates)");
	console.error("   • Add to test files (*.test.ts, *.spec.ts)");
	console.error("");

	// Block on any critical finding
	if (critical.length > 0) {
		console.error(`${colors.red}⛔ Blocking due to critical secrets${colors.reset}`);
		process.exit(2);
	}

	// Warn but allow high severity if no critical
	console.error(`${colors.yellow}⚠️ Warning: High severity findings (not blocking)${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
