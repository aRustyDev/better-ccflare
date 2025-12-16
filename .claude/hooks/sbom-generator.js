#!/usr/bin/env node
/**
 * SBOM Generator (syft)
 *
 * TRIGGER: PostToolUse
 * MATCHER: Write|Edit (on package.json, Dockerfile, go.mod, etc.)
 *
 * Generates Software Bill of Materials (SBOM) when dependency files change.
 * Outputs SBOM in SPDX or CycloneDX format for compliance/auditing.
 *
 * REQUIRES: syft (brew install syft / curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh)
 *
 * EXIT CODES:
 *   0 - Always (non-blocking, informational)
 */

const { execSync } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Files that indicate dependency/build changes
const TRIGGER_FILES = [
	// JavaScript/Node
	"package.json",
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lock",
	// Python
	"requirements.txt",
	"Pipfile.lock",
	"poetry.lock",
	"pyproject.toml",
	// Go
	"go.mod",
	"go.sum",
	// Rust
	"Cargo.lock",
	"Cargo.toml",
	// Ruby
	"Gemfile.lock",
	// Java
	"pom.xml",
	"build.gradle",
	// Docker
	"Dockerfile",
	// .NET
	"packages.lock.json",
];

// SBOM output configuration
const SBOM_CONFIG = {
	outputDir: ".sbom",
	formats: ["spdx-json", "cyclonedx-json"],
	// Set to true to auto-generate SBOM files
	autoGenerate: false,
};

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

function isTriggerFile(filePath) {
	const basename = path.basename(filePath);
	return TRIGGER_FILES.some(pattern => {
		if (basename === pattern) return true;
		if (pattern.startsWith("Dockerfile") && basename.startsWith("Dockerfile")) return true;
		return false;
	});
}

function checkSyftInstalled() {
	try {
		execSync("syft version", { stdio: ["pipe", "pipe", "pipe"] });
		return true;
	} catch {
		return false;
	}
}

function runSyftScan(targetDir) {
	try {
		const cmd = `syft dir:${targetDir} --output json --quiet`;
		const output = execSync(cmd, {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 120000,
			maxBuffer: 50 * 1024 * 1024,
		});

		return { success: true, results: JSON.parse(output) };
	} catch (err) {
		if (err.stdout) {
			try {
				return { success: true, results: JSON.parse(err.stdout) };
			} catch {
				// Parse error
			}
		}
		return { success: false, error: err.stderr || err.message };
	}
}

async function generateSBOM(targetDir, format, outputPath) {
	try {
		const cmd = `syft dir:${targetDir} --output ${format}=${outputPath}`;
		execSync(cmd, {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 120000,
		});
		return { success: true };
	} catch (err) {
		return { success: false, error: err.stderr || err.message };
	}
}

function analyzeSBOM(results) {
	const artifacts = results.artifacts || [];
	const summary = {
		totalPackages: artifacts.length,
		byType: {},
		byLanguage: {},
		topPackages: [],
	};

	for (const artifact of artifacts) {
		// Count by type
		const type = artifact.type || "unknown";
		summary.byType[type] = (summary.byType[type] || 0) + 1;

		// Count by language
		const language = artifact.language || "unknown";
		summary.byLanguage[language] = (summary.byLanguage[language] || 0) + 1;
	}

	// Get top packages by name
	summary.topPackages = artifacts
		.slice(0, 10)
		.map(a => ({
			name: a.name,
			version: a.version,
			type: a.type,
		}));

	return summary;
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;

	if (!filePath || !isTriggerFile(filePath)) {
		process.exit(0);
	}

	const relativePath = path.relative(projectRoot, filePath);
	const targetDir = path.dirname(filePath);
	const relativeDir = path.relative(projectRoot, targetDir) || ".";

	console.error("");
	console.error(`${colors.cyan}📦 SBOM Generator (syft)${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} Dependency file modified: ${relativePath}`);

	// Check if syft is installed
	if (!checkSyftInstalled()) {
		console.error("");
		console.error(`${colors.yellow}⚠️ syft not installed${colors.reset}`);
		console.error("");
		console.error(`${colors.cyan}Install with:${colors.reset}`);
		console.error("   brew install syft                     # macOS");
		console.error("   curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin");
		console.error("");
		process.exit(0);
	}

	console.error(`${colors.blue}[INFO]${colors.reset} Scanning ${relativeDir} for packages...`);

	const { success, results, error } = runSyftScan(targetDir);

	if (!success) {
		console.error(`${colors.yellow}⚠️ SBOM scan failed: ${error}${colors.reset}`);
		process.exit(0);
	}

	const summary = analyzeSBOM(results);

	// Display summary
	console.error("");
	console.error(`${colors.cyan}SBOM Summary:${colors.reset}`);
	console.error(`   Total packages: ${summary.totalPackages}`);

	if (Object.keys(summary.byType).length > 0) {
		console.error("");
		console.error(`${colors.magenta}By Type:${colors.reset}`);
		for (const [type, count] of Object.entries(summary.byType)) {
			console.error(`   ${type}: ${count}`);
		}
	}

	if (Object.keys(summary.byLanguage).length > 0) {
		console.error("");
		console.error(`${colors.magenta}By Language:${colors.reset}`);
		for (const [lang, count] of Object.entries(summary.byLanguage)) {
			if (lang !== "unknown") {
				console.error(`   ${lang}: ${count}`);
			}
		}
	}

	// Auto-generate SBOM files if enabled
	if (SBOM_CONFIG.autoGenerate) {
		const outputDir = path.join(projectRoot, SBOM_CONFIG.outputDir);

		try {
			await fs.mkdir(outputDir, { recursive: true });

			console.error("");
			console.error(`${colors.cyan}Generating SBOM files:${colors.reset}`);

			for (const format of SBOM_CONFIG.formats) {
				const ext = format.includes("spdx") ? "spdx.json" : "cdx.json";
				const outputPath = path.join(outputDir, `sbom.${ext}`);
				const result = await generateSBOM(targetDir, format, outputPath);

				if (result.success) {
					console.error(`   ${colors.green}✓${colors.reset} ${path.relative(projectRoot, outputPath)}`);
				} else {
					console.error(`   ${colors.red}✗${colors.reset} Failed to generate ${format}`);
				}
			}
		} catch (err) {
			console.error(`${colors.yellow}⚠️ Could not create SBOM output directory${colors.reset}`);
		}
	}

	console.error("");
	console.error(`${colors.cyan}Generate SBOM manually:${colors.reset}`);
	console.error(`   syft dir:${relativeDir} -o spdx-json=sbom.spdx.json`);
	console.error(`   syft dir:${relativeDir} -o cyclonedx-json=sbom.cdx.json`);

	console.error("");
	console.error(`${colors.green}✅ SBOM analysis complete${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
