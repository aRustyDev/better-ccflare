#!/usr/bin/env node
/**
 * Conventional Commit Enforcer
 *
 * TRIGGER: PreToolUse
 * MATCHER: Bash (when command contains "git commit")
 *
 * Validates commit messages follow conventional commit format:
 * - Header: <type>(<scope>): <description>
 * - Body: Keep-a-changelog format (Added, Changed, Fixed, Removed)
 *
 * EXIT CODES:
 *   0 - Valid commit message
 *   2 - Invalid format (blocks commit)
 */

const VALID_TYPES = [
	"feat",     // New feature
	"fix",      // Bug fix
	"docs",     // Documentation
	"style",    // Formatting (no code change)
	"refactor", // Code restructuring
	"perf",     // Performance improvement
	"test",     // Tests
	"build",    // Build system
	"ci",       // CI configuration
	"chore",    // Maintenance
	"revert",   // Revert previous commit
];

const HEADER_PATTERN = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?:\s.{1,72}$/;

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
	// Match -m "message" or -m 'message' patterns
	const messageMatch = command.match(/-m\s+["']([^"']+)["']/);
	if (messageMatch) {
		return messageMatch[1];
	}

	// Match heredoc pattern: -m "$(cat <<'EOF' ... EOF)"
	const heredocMatch = command.match(/-m\s+"\$\(cat <<['"]?EOF['"]?\n([\s\S]*?)\nEOF/);
	if (heredocMatch) {
		return heredocMatch[1].trim();
	}

	return null;
}

function validateHeader(header) {
	const errors = [];

	if (!HEADER_PATTERN.test(header)) {
		errors.push("Header doesn't match pattern: <type>(<scope>): <description>");

		// Provide specific feedback
		const typeMatch = header.match(/^(\w+)/);
		if (typeMatch && !VALID_TYPES.includes(typeMatch[1])) {
			errors.push(`Invalid type '${typeMatch[1]}'. Valid types: ${VALID_TYPES.join(", ")}`);
		}

		if (header.length > 72) {
			errors.push(`Header too long (${header.length} chars). Max 72 characters.`);
		}

		if (!header.includes(":")) {
			errors.push("Missing colon after type/scope");
		}
	}

	return errors;
}

function validateBody(body) {
	const warnings = [];

	if (!body || body.trim().length === 0) {
		warnings.push("No body provided. Consider adding changelog-style sections.");
		return warnings;
	}

	const validSections = ["### Added", "### Changed", "### Fixed", "### Removed", "### Deprecated", "### Security"];
	const hasChangelogSection = validSections.some(section => body.includes(section));

	if (!hasChangelogSection) {
		warnings.push("Body doesn't contain changelog sections (### Added, ### Changed, ### Fixed, ### Removed)");
	}

	return warnings;
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const command = tool_input?.command || "";

	// Only check git commit commands
	if (!command.includes("git commit")) {
		process.exit(0);
	}

	// Skip if --amend without new message
	if (command.includes("--amend") && !command.includes("-m")) {
		process.exit(0);
	}

	const message = extractCommitMessage(command);

	if (!message) {
		console.error(`${colors.yellow}[WARN]${colors.reset} Could not extract commit message from command`);
		process.exit(0); // Don't block if we can't parse
	}

	console.error("");
	console.error(`${colors.cyan}📝 Conventional Commit Check${colors.reset}`);
	console.error("────────────────────────────────────────────");

	const lines = message.split("\n");
	const header = lines[0];
	const body = lines.slice(2).join("\n"); // Skip blank line after header

	// Validate header (blocking)
	const headerErrors = validateHeader(header);

	if (headerErrors.length > 0) {
		console.error(`${colors.red}❌ Invalid commit header:${colors.reset}`);
		console.error(`   "${header}"`);
		console.error("");
		headerErrors.forEach(err => {
			console.error(`   ${colors.red}•${colors.reset} ${err}`);
		});
		console.error("");
		console.error(`${colors.cyan}Expected format:${colors.reset}`);
		console.error("   <type>(<scope>): <description>");
		console.error("");
		console.error(`${colors.cyan}Example:${colors.reset}`);
		console.error("   feat(auth): add OAuth2 login support");
		console.error("");
		process.exit(2); // Block the commit
	}

	// Validate body (warnings only)
	const bodyWarnings = validateBody(body);

	if (bodyWarnings.length > 0) {
		console.error(`${colors.yellow}⚠️ Body suggestions:${colors.reset}`);
		bodyWarnings.forEach(warn => {
			console.error(`   ${colors.yellow}•${colors.reset} ${warn}`);
		});
		console.error("");
	}

	console.error(`${colors.green}✅ Commit message format valid${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`${colors.red}[ERROR]${colors.reset} ${err.message}`);
	process.exit(0); // Don't block on hook errors
});
