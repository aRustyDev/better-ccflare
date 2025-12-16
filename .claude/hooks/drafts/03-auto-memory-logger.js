#!/usr/bin/env node
/**
 * Auto-Memory Logger
 *
 * TRIGGER: PostToolUse
 * MATCHER: Write|Edit|MultiEdit (on significant files)
 *
 * Automatically logs important decisions and changes to the memory graph.
 * Detects architectural changes, API modifications, and configuration updates.
 *
 * NOTE: This hook logs to a local file. To actually save to memory graph,
 * you would need to integrate with your memory MCP server.
 *
 * EXIT CODES:
 *   0 - Always (non-blocking, informational only)
 */

const fs = require("fs").promises;
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Patterns that indicate important changes worth logging
const SIGNIFICANT_PATTERNS = {
	architecture: [
		/packages\/[^/]+\/package\.json$/,   // New package
		/tsconfig.*\.json$/,                  // TypeScript config
		/\.claude\/.*\.json$/,                // Claude config
		/docker-compose.*\.yml$/,             // Docker config
	],
	api: [
		/handlers\/.*\.ts$/,                  // API handlers
		/router\.ts$/,                        // Router changes
		/routes\/.*\.ts$/,                    // Route definitions
		/\/api\/.*\.ts$/,                     // API files
	],
	database: [
		/migrations?\.ts$/,                   // Database migrations
		/schema\.ts$/,                        // Schema definitions
		/repositories\/.*\.ts$/,              // Repository changes
		/models?\/.*\.ts$/,                   // Model changes
	],
	config: [
		/config\/.*\.(ts|json)$/,             // Configuration files
		/\.env\.example$/,                    // Environment examples
		/settings\.json$/,                    // Settings
	],
	security: [
		/auth.*\.ts$/,                        // Authentication
		/permissions?\.ts$/,                  // Permissions
		/middleware\/.*\.ts$/,                // Middleware
	],
};

const colors = {
	blue: "\x1b[0;34m",
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

function categorizeChange(filePath) {
	const relativePath = path.relative(projectRoot, filePath);

	for (const [category, patterns] of Object.entries(SIGNIFICANT_PATTERNS)) {
		for (const pattern of patterns) {
			if (pattern.test(relativePath)) {
				return category;
			}
		}
	}

	return null;
}

function generateMemoryEntry(filePath, category, toolName) {
	const relativePath = path.relative(projectRoot, filePath);
	const timestamp = new Date().toISOString();

	const categoryDescriptions = {
		architecture: "Architectural change",
		api: "API modification",
		database: "Database/schema change",
		config: "Configuration update",
		security: "Security-related change",
	};

	return {
		timestamp,
		category,
		description: categoryDescriptions[category] || "Code change",
		file: relativePath,
		action: toolName,
		project: path.basename(projectRoot),
	};
}

async function appendToMemoryLog(entry) {
	const logDir = path.join(projectRoot, ".claude", "memory-log");
	const logFile = path.join(logDir, "decisions.jsonl");

	try {
		await fs.mkdir(logDir, { recursive: true });
		await fs.appendFile(logFile, JSON.stringify(entry) + "\n");
		return true;
	} catch (err) {
		return false;
	}
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_name, tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;

	if (!filePath) {
		process.exit(0);
	}

	const category = categorizeChange(filePath);

	if (!category) {
		// Not a significant file, skip silently
		process.exit(0);
	}

	console.error("");
	console.error(`${colors.cyan}📝 Auto-Memory Logger${colors.reset}`);
	console.error("────────────────────────────────────────────");

	const entry = generateMemoryEntry(filePath, category, tool_name);

	console.error(`${colors.blue}[INFO]${colors.reset} Detected ${colors.yellow}${category}${colors.reset} change:`);
	console.error(`   File: ${entry.file}`);
	console.error(`   Action: ${entry.action}`);

	const saved = await appendToMemoryLog(entry);

	if (saved) {
		console.error(`${colors.green}✅ Logged to .claude/memory-log/decisions.jsonl${colors.reset}`);
		console.error("");
		console.error(`${colors.yellow}💡 TIP:${colors.reset} Consider documenting this decision:`);

		switch (category) {
			case "architecture":
				console.error("   - Why was this structural change made?");
				console.error("   - What alternatives were considered?");
				break;
			case "api":
				console.error("   - Is this a breaking change?");
				console.error("   - Update API documentation if needed");
				break;
			case "database":
				console.error("   - Is a migration needed?");
				console.error("   - Consider data compatibility");
				break;
			case "config":
				console.error("   - Document any new environment variables");
				console.error("   - Update .env.example if needed");
				break;
			case "security":
				console.error("   - Has this been security reviewed?");
				console.error("   - Consider threat model implications");
				break;
		}
	} else {
		console.error(`${colors.yellow}⚠️ Could not write to memory log${colors.reset}`);
	}

	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
