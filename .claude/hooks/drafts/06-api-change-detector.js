#!/usr/bin/env node
/**
 * API Change Detector
 *
 * TRIGGER: PostToolUse
 * MATCHER: Write|Edit|MultiEdit (on handler/router files)
 *
 * Detects changes to API handlers and reminds to update documentation.
 * Tracks new endpoints, modified signatures, and breaking changes.
 *
 * EXIT CODES:
 *   0 - Always (non-blocking, reminder only)
 */

const fs = require("fs").promises;
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Patterns that indicate API files
const API_FILE_PATTERNS = [
	/handlers?\/.*\.ts$/,
	/routes?\/.*\.ts$/,
	/router\.ts$/,
	/controllers?\/.*\.ts$/,
	/endpoints?\/.*\.ts$/,
	/api\/.*\.ts$/,
];

// Patterns to detect in file content
const ENDPOINT_PATTERNS = {
	httpMethods: /\.(get|post|put|patch|delete|head|options)\s*\(/gi,
	handlers: /handlers\.set\s*\(\s*["']([^"']+)["']/g,
	express: /router\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g,
	hono: /app\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g,
};

// Patterns that indicate breaking changes
const BREAKING_CHANGE_INDICATORS = [
	/remove|delete|deprecate/i,
	/breaking/i,
	/rename/i,
	/change.*signature/i,
	/required.*parameter/i,
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

function isApiFile(filePath) {
	return API_FILE_PATTERNS.some(pattern => pattern.test(filePath));
}

async function extractEndpoints(filePath) {
	try {
		const content = await fs.readFile(filePath, "utf8");
		const endpoints = new Set();

		// Extract handler definitions (this project's pattern)
		const handlerMatches = content.matchAll(/handlers\.set\s*\(\s*["']([^"']+)["']/g);
		for (const match of handlerMatches) {
			endpoints.add(match[1]);
		}

		// Extract express-style routes
		const expressMatches = content.matchAll(/\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g);
		for (const match of expressMatches) {
			endpoints.add(`${match[1].toUpperCase()}:${match[2]}`);
		}

		return Array.from(endpoints);
	} catch (err) {
		return [];
	}
}

function detectPotentialBreakingChanges(content) {
	const warnings = [];

	for (const pattern of BREAKING_CHANGE_INDICATORS) {
		if (pattern.test(content)) {
			warnings.push(`Possible breaking change detected (matched: ${pattern.source})`);
		}
	}

	// Check for removed exports
	if (/^-\s*export/m.test(content)) {
		warnings.push("Removed export detected - may affect consumers");
	}

	// Check for changed function signatures
	if (/^-\s*(async\s+)?function|^-.*=.*=>/m.test(content)) {
		warnings.push("Function signature may have changed");
	}

	return warnings;
}

async function findDocFiles() {
	const docPatterns = [
		"docs/api*.md",
		"docs/API*.md",
		"API.md",
		"docs/api-http.md",
		"README.md",
		"docs/index.md",
	];

	const existing = [];

	for (const pattern of docPatterns) {
		const fullPath = path.join(projectRoot, pattern);
		try {
			await fs.access(fullPath);
			existing.push(pattern);
		} catch {
			// File doesn't exist
		}
	}

	return existing;
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;

	if (!filePath || !isApiFile(filePath)) {
		process.exit(0);
	}

	const relativePath = path.relative(projectRoot, filePath);

	console.error("");
	console.error(`${colors.cyan}📡 API Change Detector${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} API file modified: ${relativePath}`);

	// Extract endpoints from file
	const endpoints = await extractEndpoints(filePath);

	if (endpoints.length > 0) {
		console.error("");
		console.error(`${colors.magenta}Endpoints in this file:${colors.reset}`);
		endpoints.forEach(ep => {
			console.error(`   • ${ep}`);
		});
	}

	// Read file content to detect changes
	let content = "";
	try {
		content = await fs.readFile(filePath, "utf8");
	} catch (err) {
		// Can't read file
	}

	// Check for breaking changes
	const breakingWarnings = detectPotentialBreakingChanges(content);

	if (breakingWarnings.length > 0) {
		console.error("");
		console.error(`${colors.red}⚠️ Potential breaking changes:${colors.reset}`);
		breakingWarnings.forEach(warn => {
			console.error(`   ${colors.red}•${colors.reset} ${warn}`);
		});
	}

	// Find documentation files
	const docFiles = await findDocFiles();

	console.error("");
	console.error(`${colors.yellow}📝 Documentation Reminder:${colors.reset}`);
	console.error("");

	if (docFiles.length > 0) {
		console.error("   Consider updating these files:");
		docFiles.forEach(doc => {
			console.error(`   ${colors.cyan}•${colors.reset} ${doc}`);
		});
	} else {
		console.error("   No API documentation files found.");
		console.error("   Consider creating: docs/api.md or API.md");
	}

	console.error("");
	console.error(`${colors.yellow}Checklist:${colors.reset}`);
	console.error("   [ ] Update endpoint documentation");
	console.error("   [ ] Update request/response examples");
	console.error("   [ ] Note any breaking changes in CHANGELOG");
	console.error("   [ ] Update API version if needed");

	if (breakingWarnings.length > 0) {
		console.error("");
		console.error(`${colors.red}Breaking changes require:${colors.reset}`);
		console.error("   [ ] Major version bump");
		console.error("   [ ] Migration guide");
		console.error("   [ ] Consumer notification");
	}

	console.error("");
	console.error(`${colors.green}✅ Reminder logged (non-blocking)${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
