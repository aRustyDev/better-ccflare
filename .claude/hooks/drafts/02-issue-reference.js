#!/usr/bin/env node
/**
 * Issue Reference Check
 *
 * TRIGGER: PreToolUse
 * MATCHER: Bash (when command contains "git commit")
 *
 * Blocks commits that don't reference a GitHub issue number.
 * Looks for patterns like: #123, Closes #123, Fixes #123, Refs #123
 *
 * EXIT CODES:
 *   0 - Issue reference found
 *   2 - No issue reference (blocks commit)
 */

const ISSUE_PATTERNS = [
	/#\d+/,                          // #123
	/closes?\s+#\d+/i,               // Closes #123, Close #123
	/fixes?\s+#\d+/i,                // Fixes #123, Fix #123
	/resolves?\s+#\d+/i,             // Resolves #123, Resolve #123
	/refs?\s+#\d+/i,                 // Refs #123, Ref #123
	/related\s+to\s+#\d+/i,          // Related to #123
	/see\s+#\d+/i,                   // See #123
	/gh-\d+/i,                       // GH-123
	/issue[:\s]+#?\d+/i,             // Issue: 123, Issue #123
];

// Commits that don't need issue references
const EXEMPT_PATTERNS = [
	/^chore\(release\):/i,           // Release commits
	/^chore\(deps\):/i,              // Dependency updates
	/^docs:/i,                       // Documentation-only
	/^style:/i,                      // Style-only changes
	/\[skip-issue\]/i,               // Explicit skip
	/^revert:/i,                     // Reverts
	/^merge/i,                       // Merge commits
	/initial commit/i,               // Initial commit
];

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

function extractCommitMessage(command) {
	const messageMatch = command.match(/-m\s+["']([^"']+)["']/);
	if (messageMatch) {
		return messageMatch[1];
	}

	const heredocMatch = command.match(/-m\s+"\$\(cat <<['"]?EOF['"]?\n([\s\S]*?)\nEOF/);
	if (heredocMatch) {
		return heredocMatch[1].trim();
	}

	return null;
}

function isExempt(message) {
	return EXEMPT_PATTERNS.some(pattern => pattern.test(message));
}

function findIssueReferences(message) {
	const references = [];

	for (const pattern of ISSUE_PATTERNS) {
		const matches = message.match(new RegExp(pattern, "gi"));
		if (matches) {
			references.push(...matches);
		}
	}

	return [...new Set(references)]; // Deduplicate
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const command = tool_input?.command || "";

	if (!command.includes("git commit")) {
		process.exit(0);
	}

	if (command.includes("--amend") && !command.includes("-m")) {
		process.exit(0);
	}

	const message = extractCommitMessage(command);

	if (!message) {
		console.error(`${colors.yellow}[WARN]${colors.reset} Could not extract commit message`);
		process.exit(0);
	}

	console.error("");
	console.error(`${colors.cyan}🔗 Issue Reference Check${colors.reset}`);
	console.error("────────────────────────────────────────────");

	// Check if exempt
	if (isExempt(message)) {
		console.error(`${colors.green}✅ Commit exempt from issue reference requirement${colors.reset}`);
		process.exit(0);
	}

	// Find issue references
	const references = findIssueReferences(message);

	if (references.length === 0) {
		console.error(`${colors.red}❌ No issue reference found in commit message${colors.reset}`);
		console.error("");
		console.error(`${colors.cyan}Your message:${colors.reset}`);
		console.error(`   "${message.split("\n")[0]}"`);
		console.error("");
		console.error(`${colors.cyan}Expected:${colors.reset} Reference an issue using one of these patterns:`);
		console.error("   • #123");
		console.error("   • Closes #123");
		console.error("   • Fixes #123");
		console.error("   • Refs #123");
		console.error("");
		console.error(`${colors.cyan}Exempt commit types:${colors.reset}`);
		console.error("   • chore(release): ...");
		console.error("   • chore(deps): ...");
		console.error("   • docs: ...");
		console.error("   • Include [skip-issue] in message");
		console.error("");
		process.exit(2);
	}

	console.error(`${colors.green}✅ Found issue reference(s): ${references.join(", ")}${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`${colors.red}[ERROR]${colors.reset} ${err.message}`);
	process.exit(0);
});
