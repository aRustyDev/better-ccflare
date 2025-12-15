#!/usr/bin/env node
/**
 * Quality Check Hook for better-ccflare
 * Adapted from bartolli/claude-code-typescript-hooks for Biome
 *
 * EXIT CODES:
 *   0 - Success (all checks passed)
 *   1 - General error (missing dependencies, etc.)
 *   2 - Quality issues found - ALL must be fixed (blocking)
 */

const fs = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");

/**
 * Get project root using CLAUDE_PROJECT_DIR environment variable
 * @returns {string} Project root directory
 */
function getProjectRoot() {
	return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

const projectRoot = getProjectRoot();

// ANSI color codes
const colors = {
	red: "\x1b[0;31m",
	green: "\x1b[0;32m",
	yellow: "\x1b[0;33m",
	blue: "\x1b[0;34m",
	cyan: "\x1b[0;36m",
	reset: "\x1b[0m",
};

/**
 * Load configuration from JSON file
 * @returns {Object} Configuration object
 */
function loadConfig() {
	let fileConfig = {};

	try {
		const configPath = path.join(__dirname, "hook-config.json");
		if (require("fs").existsSync(configPath)) {
			fileConfig = JSON.parse(require("fs").readFileSync(configPath, "utf8"));
		}
	} catch (e) {
		// Config file not found or invalid, use defaults
	}

	return {
		typescriptEnabled: fileConfig.typescript?.enabled ?? true,
		biomeEnabled: fileConfig.biome?.enabled ?? true,
		biomeAutofix: fileConfig.biome?.autofix ?? true,
		autofixSilent: fileConfig.general?.autofixSilent ?? true,
		debug: fileConfig.general?.debug ?? false,
		ignorePatterns: fileConfig.ignore?.paths || [],
		_fileConfig: fileConfig,
	};
}

const config = loadConfig();

// Logging functions
const log = {
	info: (msg) => console.error(`${colors.blue}[INFO]${colors.reset} ${msg}`),
	error: (msg) => console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`),
	success: (msg) => console.error(`${colors.green}[OK]${colors.reset} ${msg}`),
	warning: (msg) =>
		console.error(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
	debug: (msg) => {
		if (config.debug) {
			console.error(`${colors.cyan}[DEBUG]${colors.reset} ${msg}`);
		}
	},
};

/**
 * Quality checker for a single file
 */
class QualityChecker {
	constructor(filePath) {
		this.filePath = filePath;
		this.errors = [];
		this.autofixes = [];
	}

	/**
	 * Run all quality checks
	 */
	async checkAll() {
		if (config.typescriptEnabled) {
			await this.checkTypeScript();
		}

		if (config.biomeEnabled) {
			await this.checkBiome();
		}

		await this.checkCommonIssues();

		return {
			errors: this.errors,
			autofixes: this.autofixes,
		};
	}

	/**
	 * Check TypeScript compilation
	 */
	async checkTypeScript() {
		log.info("Running TypeScript type check...");

		try {
			execSync("bunx tsc --noEmit 2>&1", {
				cwd: projectRoot,
				encoding: "utf8",
				stdio: "pipe",
			});
			log.success("TypeScript compilation passed");
		} catch (error) {
			// Filter for errors in the edited file
			const output = error.stdout || error.stderr || "";
			const relativePath = path.relative(projectRoot, this.filePath);

			const fileErrors = output
				.split("\n")
				.filter((line) => line.includes(relativePath));

			if (fileErrors.length > 0) {
				this.errors.push(`TypeScript errors in edited file:`);
				fileErrors.forEach((line) => {
					console.error(`  ${colors.red}❌${colors.reset} ${line}`);
				});
			} else {
				// Errors in other files - just warn
				log.warning("TypeScript errors in other files (not blocking)");
			}
		}
	}

	/**
	 * Check Biome linting and formatting
	 */
	async checkBiome() {
		log.info("Running Biome check...");

		try {
			if (config.biomeAutofix) {
				// Try to auto-fix first
				try {
					execSync(`bunx biome check --write "${this.filePath}" 2>&1`, {
						cwd: projectRoot,
						encoding: "utf8",
						stdio: "pipe",
					});
					log.success("Biome check passed (auto-fixed if needed)");
					this.autofixes.push("Biome auto-fixed formatting/linting issues");
				} catch (fixError) {
					// Auto-fix failed, check what issues remain
					const output = fixError.stdout || fixError.stderr || "";
					if (output.includes("error")) {
						this.errors.push(`Biome found issues that couldn't be auto-fixed:`);
						console.error(output);
					}
				}
			} else {
				// Just check without fixing
				execSync(`bunx biome check "${this.filePath}" 2>&1`, {
					cwd: projectRoot,
					encoding: "utf8",
					stdio: "pipe",
				});
				log.success("Biome check passed");
			}
		} catch (error) {
			const output = error.stdout || error.stderr || "";
			this.errors.push(`Biome found issues in ${this.filePath}`);
			console.error(output);
		}
	}

	/**
	 * Check for common code issues
	 */
	async checkCommonIssues() {
		log.info("Checking for common issues...");

		try {
			const content = await fs.readFile(this.filePath, "utf8");
			const lines = content.split("\n");
			let foundIssues = false;

			// Check for debugger statements
			lines.forEach((line, index) => {
				if (/\bdebugger\b/.test(line) && !line.trim().startsWith("//")) {
					this.errors.push(
						`Found debugger statement at line ${index + 1} - remove before committing`,
					);
					console.error(`  Line ${index + 1}: ${line.trim()}`);
					foundIssues = true;
				}
			});

			// Check for 'as any' (warning only)
			const asAnyRule = config._fileConfig.rules?.asAny || {};
			if (asAnyRule.enabled !== false) {
				lines.forEach((line, index) => {
					if (line.includes("as any") && !line.trim().startsWith("//")) {
						log.warning(
							`'as any' usage at line ${index + 1}: ${asAnyRule.message || "Prefer proper types"}`,
						);
					}
				});
			}

			// Check for TODO/FIXME comments (info only)
			lines.forEach((line, index) => {
				if (/\b(TODO|FIXME|HACK)\b/.test(line)) {
					log.warning(`Found TODO/FIXME comment at line ${index + 1}`);
				}
			});

			if (!foundIssues) {
				log.success("No common issues found");
			}
		} catch (error) {
			log.debug(`Common issues check error: ${error.message}`);
		}
	}
}

/**
 * Parse JSON input from stdin
 */
async function parseJsonInput() {
	let inputData = "";

	for await (const chunk of process.stdin) {
		inputData += chunk;
	}

	if (!inputData.trim()) {
		log.warning("No JSON input provided.");
		process.exit(0);
	}

	try {
		return JSON.parse(inputData);
	} catch (error) {
		log.error(`Failed to parse JSON input: ${error.message}`);
		process.exit(1);
	}
}

/**
 * Extract file path from tool input
 */
function extractFilePath(input) {
	const { tool_input } = input;
	if (!tool_input) {
		return null;
	}
	return tool_input.file_path || tool_input.path || tool_input.notebook_path || null;
}

/**
 * Check if file exists
 */
async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if file is a source file
 */
function isSourceFile(filePath) {
	return /\.(ts|tsx|js|jsx)$/.test(filePath);
}

/**
 * Check if file should be ignored
 */
function shouldIgnore(filePath) {
	const relativePath = path.relative(projectRoot, filePath);
	return config.ignorePatterns.some((pattern) => relativePath.includes(pattern));
}

/**
 * Print summary
 */
function printSummary(errors, autofixes) {
	if (autofixes.length > 0) {
		console.error(`\n${colors.blue}═══ Auto-fixes Applied ═══${colors.reset}`);
		autofixes.forEach((fix) => {
			console.error(`${colors.green}✨${colors.reset} ${fix}`);
		});
	}

	if (errors.length > 0) {
		console.error(`\n${colors.blue}═══ Quality Check Summary ═══${colors.reset}`);
		errors.forEach((error) => {
			console.error(`${colors.red}❌${colors.reset} ${error}`);
		});
		console.error(`\n${colors.red}Found ${errors.length} issue(s) that MUST be fixed!${colors.reset}`);
	}
}

/**
 * Main entry point
 */
async function main() {
	const hookVersion = config._fileConfig.version || "1.0.0";
	console.error("");
	console.error(`📦 better-ccflare Quality Check v${hookVersion}`);
	console.error("────────────────────────────────────────────");

	const input = await parseJsonInput();
	const filePath = extractFilePath(input);

	if (!filePath) {
		log.warning("No file path found in input.");
		process.exit(0);
	}

	if (!(await fileExists(filePath))) {
		log.info(`File does not exist: ${filePath}`);
		process.exit(0);
	}

	if (!isSourceFile(filePath)) {
		log.info(`Skipping non-source file: ${filePath}`);
		process.exit(0);
	}

	if (shouldIgnore(filePath)) {
		log.info(`Skipping ignored file: ${filePath}`);
		process.exit(0);
	}

	console.error(`🔍 Validating: ${path.basename(filePath)}`);
	console.error("────────────────────────────────────────────");

	const checker = new QualityChecker(filePath);
	const { errors, autofixes } = await checker.checkAll();

	printSummary(errors, autofixes);

	if (errors.length > 0) {
		console.error(`\n${colors.red}🛑 FAILED - Fix issues above! 🛑${colors.reset}`);
		process.exit(2);
	} else {
		console.error(`\n${colors.green}✅ Quality check passed for ${path.basename(filePath)}${colors.reset}`);
		process.exit(0);
	}
}

process.on("unhandledRejection", (error) => {
	log.error(`Unhandled error: ${error.message}`);
	process.exit(1);
});

main().catch((error) => {
	log.error(`Fatal error: ${error.message}`);
	process.exit(1);
});
