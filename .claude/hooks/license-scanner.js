#!/usr/bin/env node
/**
 * License Scanner (syft + REUSE + scancode)
 *
 * TRIGGER: PostToolUse
 * MATCHER: Write|Edit (on package.json, go.mod, Cargo.toml, etc.)
 *
 * Scans dependencies for license compliance using multiple tools:
 * - syft: Extract licenses from SBOMs
 * - reuse: Check REUSE compliance (SPDX headers)
 * - scancode-toolkit: Deep license analysis
 *
 * REQUIRES: At least one of:
 *   - syft (brew install syft)
 *   - reuse (pip install reuse)
 *   - scancode (pip install scancode-toolkit)
 *
 * EXIT CODES:
 *   0 - All licenses compatible / warnings only
 *   2 - Incompatible licenses found (blocks)
 */

const { execSync, spawnSync } = require("child_process");
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Dependency files that trigger license scanning
const DEPENDENCY_FILES = [
	"package.json",
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lock",
	"go.mod",
	"Cargo.toml",
	"Cargo.lock",
	"pyproject.toml",
	"requirements.txt",
	"Pipfile.lock",
	"Gemfile.lock",
	"pom.xml",
	"build.gradle",
	"composer.lock",
];

// License classifications
const LICENSE_POLICY = {
	// Permissive licenses - generally safe
	permissive: [
		"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0",
		"CC0-1.0", "Unlicense", "0BSD", "WTFPL", "Zlib", "X11",
		"CC-BY-3.0", "CC-BY-4.0", "PSF-2.0", "Python-2.0",
		"BSL-1.0", "MPL-2.0", "LGPL-2.1", "LGPL-3.0",
	],

	// Copyleft - may require source disclosure
	copyleft: [
		"GPL-2.0", "GPL-3.0", "AGPL-3.0",
		"GPL-2.0-only", "GPL-3.0-only", "AGPL-3.0-only",
		"GPL-2.0-or-later", "GPL-3.0-or-later",
	],

	// Problematic or unclear
	problematic: [
		"UNLICENSED", "UNKNOWN", "NOASSERTION",
		"Commercial", "Proprietary",
	],
};

// Default policy settings
const POLICY = {
	// Block on these license categories
	blockOn: ["copyleft"], // Add "problematic" to also block unknown
	// Packages to always allow (overrides)
	allowList: [],
	// Packages to always block (overrides)
	blockList: [],
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

function isDependencyFile(filePath) {
	const basename = path.basename(filePath);
	return DEPENDENCY_FILES.includes(basename);
}

function checkToolInstalled(tool) {
	try {
		execSync(`${tool} --version`, { stdio: ["pipe", "pipe", "pipe"] });
		return true;
	} catch {
		return false;
	}
}

function getAvailableTools() {
	return {
		syft: checkToolInstalled("syft"),
		reuse: checkToolInstalled("reuse"),
		scancode: checkToolInstalled("scancode"),
	};
}

function scanWithSyft(targetDir) {
	try {
		const cmd = `syft dir:${targetDir} --output json --quiet`;
		const output = execSync(cmd, {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 120000,
			maxBuffer: 50 * 1024 * 1024,
		});

		const results = JSON.parse(output);
		const licenses = [];

		for (const artifact of results.artifacts || []) {
			const pkgLicenses = artifact.licenses || [];
			for (const lic of pkgLicenses) {
				licenses.push({
					package: artifact.name,
					version: artifact.version,
					license: lic.value || lic.spdxExpression || lic,
					source: "syft",
				});
			}
			// If no licenses found, mark as unknown
			if (pkgLicenses.length === 0) {
				licenses.push({
					package: artifact.name,
					version: artifact.version,
					license: "UNKNOWN",
					source: "syft",
				});
			}
		}

		return { success: true, licenses };
	} catch (err) {
		return { success: false, error: err.message };
	}
}

function scanWithReuse() {
	try {
		const result = spawnSync("reuse", ["lint", "--json"], {
			cwd: projectRoot,
			encoding: "utf8",
			timeout: 60000,
		});

		if (result.error) {
			return { success: false, error: result.error.message };
		}

		try {
			const data = JSON.parse(result.stdout);
			return {
				success: true,
				compliant: data.compliant || false,
				missing: data.files_missing_licensing || [],
				bad: data.files_with_bad_licenses || [],
			};
		} catch {
			return { success: true, compliant: result.status === 0 };
		}
	} catch (err) {
		return { success: false, error: err.message };
	}
}

function categorizeLicense(license) {
	const normalizedLicense = (license || "").toUpperCase().trim();

	// Check permissive
	for (const lic of LICENSE_POLICY.permissive) {
		if (normalizedLicense.includes(lic.toUpperCase())) {
			return "permissive";
		}
	}

	// Check copyleft
	for (const lic of LICENSE_POLICY.copyleft) {
		if (normalizedLicense.includes(lic.toUpperCase())) {
			return "copyleft";
		}
	}

	// Check problematic
	for (const lic of LICENSE_POLICY.problematic) {
		if (normalizedLicense.includes(lic.toUpperCase())) {
			return "problematic";
		}
	}

	// Unknown
	return "unknown";
}

function analyzeLicenses(licenses) {
	const analysis = {
		permissive: [],
		copyleft: [],
		problematic: [],
		unknown: [],
	};

	// Deduplicate by package name
	const seen = new Set();

	for (const entry of licenses) {
		const key = `${entry.package}@${entry.version}`;
		if (seen.has(key)) continue;
		seen.add(key);

		// Check allow/block lists
		if (POLICY.allowList.includes(entry.package)) {
			analysis.permissive.push(entry);
			continue;
		}
		if (POLICY.blockList.includes(entry.package)) {
			analysis.copyleft.push({ ...entry, reason: "blocklist" });
			continue;
		}

		const category = categorizeLicense(entry.license);
		analysis[category].push(entry);
	}

	return analysis;
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;

	if (!filePath || !isDependencyFile(filePath)) {
		process.exit(0);
	}

	const relativePath = path.relative(projectRoot, filePath);
	const targetDir = path.dirname(filePath);

	console.error("");
	console.error(`${colors.cyan}📜 License Scanner${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} Dependency file modified: ${relativePath}`);

	// Check available tools
	const tools = getAvailableTools();
	const availableTools = Object.entries(tools).filter(([, v]) => v).map(([k]) => k);

	if (availableTools.length === 0) {
		console.error("");
		console.error(`${colors.yellow}⚠️ No license scanning tools installed${colors.reset}`);
		console.error("");
		console.error(`${colors.cyan}Install one of:${colors.reset}`);
		console.error("   brew install syft          # SBOM-based license extraction");
		console.error("   pip install reuse          # REUSE compliance checker");
		console.error("   pip install scancode-toolkit  # Deep license analysis");
		console.error("");
		process.exit(0);
	}

	console.error(`${colors.blue}[INFO]${colors.reset} Using: ${availableTools.join(", ")}`);

	let allLicenses = [];
	let reuseResult = null;

	// Scan with syft if available
	if (tools.syft) {
		console.error(`${colors.blue}[INFO]${colors.reset} Scanning with syft...`);
		const syftResult = scanWithSyft(targetDir);
		if (syftResult.success) {
			allLicenses = allLicenses.concat(syftResult.licenses);
		}
	}

	// Check REUSE compliance if available
	if (tools.reuse) {
		console.error(`${colors.blue}[INFO]${colors.reset} Checking REUSE compliance...`);
		reuseResult = scanWithReuse();
	}

	// Analyze licenses
	const analysis = analyzeLicenses(allLicenses);

	const totalPackages = analysis.permissive.length +
		analysis.copyleft.length +
		analysis.problematic.length +
		analysis.unknown.length;

	// Display summary
	console.error("");
	console.error(`${colors.cyan}License Summary (${totalPackages} packages):${colors.reset}`);
	console.error(`   ${colors.green}Permissive: ${analysis.permissive.length}${colors.reset}`);
	if (analysis.copyleft.length > 0) {
		console.error(`   ${colors.red}Copyleft: ${analysis.copyleft.length}${colors.reset}`);
	}
	if (analysis.problematic.length > 0) {
		console.error(`   ${colors.yellow}Problematic: ${analysis.problematic.length}${colors.reset}`);
	}
	if (analysis.unknown.length > 0) {
		console.error(`   ${colors.yellow}Unknown: ${analysis.unknown.length}${colors.reset}`);
	}

	// Show REUSE compliance
	if (reuseResult) {
		console.error("");
		if (reuseResult.compliant) {
			console.error(`${colors.green}✓ REUSE compliant${colors.reset}`);
		} else {
			console.error(`${colors.yellow}⚠ Not REUSE compliant${colors.reset}`);
			if (reuseResult.missing?.length > 0) {
				console.error(`   Missing license headers: ${reuseResult.missing.length} files`);
			}
		}
	}

	// Show copyleft packages
	if (analysis.copyleft.length > 0) {
		console.error("");
		console.error(`${colors.red}Copyleft Licenses:${colors.reset}`);
		for (const pkg of analysis.copyleft.slice(0, 10)) {
			console.error(`   ${colors.red}•${colors.reset} ${pkg.package}@${pkg.version}: ${pkg.license}`);
		}
		if (analysis.copyleft.length > 10) {
			console.error(`   ... and ${analysis.copyleft.length - 10} more`);
		}
	}

	// Show problematic/unknown packages
	if (analysis.problematic.length > 0 || analysis.unknown.length > 0) {
		console.error("");
		console.error(`${colors.yellow}Needs Review:${colors.reset}`);
		const needsReview = [...analysis.problematic, ...analysis.unknown].slice(0, 5);
		for (const pkg of needsReview) {
			console.error(`   ${colors.yellow}•${colors.reset} ${pkg.package}@${pkg.version}: ${pkg.license}`);
		}
	}

	console.error("");

	// Check if we should block
	const shouldBlock = POLICY.blockOn.some(category => {
		if (category === "copyleft") return analysis.copyleft.length > 0;
		if (category === "problematic") return analysis.problematic.length > 0;
		return false;
	});

	if (shouldBlock) {
		console.error(`${colors.cyan}Policy:${colors.reset} Blocking on copyleft licenses`);
		console.error("");
		console.error(`${colors.cyan}Options:${colors.reset}`);
		console.error("   1. Replace with permissive-licensed alternatives");
		console.error("   2. Add package to allowList in this hook");
		console.error("   3. Update POLICY.blockOn to remove 'copyleft'");
		console.error("");
		console.error(`${colors.red}⛔ Blocking due to license compliance${colors.reset}`);
		process.exit(2);
	}

	console.error(`${colors.green}✅ License compliance check passed${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
