#!/usr/bin/env node
/**
 * Branch Name Validator
 *
 * TRIGGER: PreToolUse
 * MATCHER: Bash (when command contains "git checkout -b" or "git branch")
 *
 * Ensures new branches follow naming conventions:
 * - feat/description
 * - fix/description
 * - docs/description
 * - refactor/description
 * - test/description
 * - chore/description
 *
 * EXIT CODES:
 *   0 - Valid branch name
 *   2 - Invalid branch name (blocks)
 */

const VALID_PREFIXES = [
	"feat",      // New feature
	"fix",       // Bug fix
	"docs",      // Documentation
	"style",     // Formatting
	"refactor",  // Code restructuring
	"perf",      // Performance
	"test",      // Tests
	"build",     // Build system
	"ci",        // CI configuration
	"chore",     // Maintenance
	"hotfix",    // Urgent fix
	"release",   // Release branch
	"revert",    // Revert changes
];

// Branches that don't need prefixes
const EXEMPT_BRANCHES = [
	"main",
	"master",
	"develop",
	"dev",
	"staging",
	"production",
	"prod",
];

const BRANCH_PATTERN = new RegExp(`^(${VALID_PREFIXES.join("|")})/[a-z0-9][a-z0-9-]*[a-z0-9]$`);

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

function extractBranchName(command) {
	// git checkout -b branch-name
	const checkoutMatch = command.match(/git\s+checkout\s+-b\s+([^\s]+)/);
	if (checkoutMatch) {
		return checkoutMatch[1];
	}

	// git branch branch-name
	const branchMatch = command.match(/git\s+branch\s+([^\s-][^\s]*)/);
	if (branchMatch) {
		return branchMatch[1];
	}

	// git switch -c branch-name
	const switchMatch = command.match(/git\s+switch\s+-c\s+([^\s]+)/);
	if (switchMatch) {
		return switchMatch[1];
	}

	return null;
}

function validateBranchName(branchName) {
	const errors = [];

	// Check if exempt
	if (EXEMPT_BRANCHES.includes(branchName)) {
		return { valid: true, errors: [] };
	}

	// Check prefix
	const hasValidPrefix = VALID_PREFIXES.some(prefix => branchName.startsWith(`${prefix}/`));
	if (!hasValidPrefix) {
		errors.push(`Branch must start with a valid prefix: ${VALID_PREFIXES.join(", ")}`);
	}

	// Check format
	if (!BRANCH_PATTERN.test(branchName)) {
		if (hasValidPrefix) {
			errors.push("Branch name after prefix should be lowercase kebab-case (e.g., feat/add-login)");
		}
	}

	// Check for invalid characters
	if (/[A-Z]/.test(branchName)) {
		errors.push("Branch name should be lowercase");
	}

	if (/[_\s]/.test(branchName)) {
		errors.push("Use hyphens instead of underscores or spaces");
	}

	// Check length
	if (branchName.length > 50) {
		errors.push(`Branch name too long (${branchName.length} chars). Max 50 characters.`);
	}

	return { valid: errors.length === 0, errors };
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const command = tool_input?.command || "";

	// Check if this is a branch creation command
	const isCreatingBranch =
		command.includes("git checkout -b") ||
		command.includes("git switch -c") ||
		(command.includes("git branch") && !command.includes("-d") && !command.includes("--delete"));

	if (!isCreatingBranch) {
		process.exit(0);
	}

	const branchName = extractBranchName(command);

	if (!branchName) {
		console.error(`${colors.yellow}[WARN]${colors.reset} Could not extract branch name`);
		process.exit(0);
	}

	console.error("");
	console.error(`${colors.cyan}🌿 Branch Name Validator${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} Checking branch: ${branchName}`);

	const { valid, errors } = validateBranchName(branchName);

	if (!valid) {
		console.error("");
		console.error(`${colors.red}❌ Invalid branch name: "${branchName}"${colors.reset}`);
		console.error("");
		errors.forEach(err => {
			console.error(`   ${colors.red}•${colors.reset} ${err}`);
		});
		console.error("");
		console.error(`${colors.cyan}Valid format:${colors.reset} <prefix>/<description>`);
		console.error(`${colors.cyan}Valid prefixes:${colors.reset} ${VALID_PREFIXES.join(", ")}`);
		console.error("");
		console.error(`${colors.cyan}Examples:${colors.reset}`);
		console.error("   feat/add-user-authentication");
		console.error("   fix/resolve-login-bug");
		console.error("   docs/update-api-readme");
		console.error("   chore/upgrade-dependencies");
		console.error("");
		process.exit(2);
	}

	console.error(`${colors.green}✅ Branch name valid${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
