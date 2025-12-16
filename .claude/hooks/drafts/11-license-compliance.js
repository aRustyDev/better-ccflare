#!/usr/bin/env node
/**
 * License Compliance
 *
 * TRIGGER: PostToolUse
 * MATCHER: Write|Edit (on package.json)
 *
 * Verifies new dependencies have compatible licenses.
 * Blocks packages with copyleft licenses in proprietary projects.
 *
 * EXIT CODES:
 *   0 - All licenses compatible
 *   2 - Incompatible license found (blocks)
 */

const { execSync } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// License classifications
const LICENSE_CATEGORIES = {
	// Permissive - generally safe for any use
	permissive: [
		"MIT",
		"ISC",
		"BSD-2-Clause",
		"BSD-3-Clause",
		"Apache-2.0",
		"CC0-1.0",
		"Unlicense",
		"0BSD",
		"WTFPL",
		"Zlib",
		"CC-BY-3.0",
		"CC-BY-4.0",
	],

	// Weak copyleft - need to share changes to the library
	weakCopyleft: [
		"LGPL-2.0",
		"LGPL-2.1",
		"LGPL-3.0",
		"MPL-2.0",
		"EPL-1.0",
		"EPL-2.0",
	],

	// Strong copyleft - may require sharing entire codebase
	strongCopyleft: [
		"GPL-2.0",
		"GPL-3.0",
		"AGPL-3.0",
		"AGPL-3.0-only",
		"GPL-2.0-only",
		"GPL-3.0-only",
		"EUPL-1.2",
	],

	// Problematic or unclear
	problematic: [
		"UNLICENSED",
		"UNKNOWN",
		"SEE LICENSE IN",
		"Custom",
	],
};

// Default policy (can be overridden in config)
const DEFAULT_POLICY = {
	// Allow these categories
	allowed: ["permissive", "weakCopyleft"],
	// Block these categories
	blocked: ["strongCopyleft"],
	// Warn about these
	warned: ["problematic"],
	// Specific package overrides
	overrides: {},
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

function isPackageJson(filePath) {
	return path.basename(filePath) === "package.json";
}

async function loadPolicy() {
	// Try to load custom policy from config
	const configPath = path.join(projectRoot, ".claude/hooks/hook-config.json");

	try {
		const content = await fs.readFile(configPath, "utf8");
		const config = JSON.parse(content);
		if (config.licensePolicy) {
			return { ...DEFAULT_POLICY, ...config.licensePolicy };
		}
	} catch (err) {
		// Use default
	}

	return DEFAULT_POLICY;
}

function categorizeLicense(license) {
	const normalizedLicense = license?.toUpperCase().trim() || "UNKNOWN";

	for (const [category, licenses] of Object.entries(LICENSE_CATEGORIES)) {
		if (licenses.some(l => normalizedLicense.includes(l.toUpperCase()))) {
			return category;
		}
	}

	// Check for common variations
	if (/MIT/i.test(license)) return "permissive";
	if (/BSD/i.test(license)) return "permissive";
	if (/APACHE/i.test(license)) return "permissive";
	if (/GPL/i.test(license)) return "strongCopyleft";
	if (/LGPL/i.test(license)) return "weakCopyleft";

	return "problematic";
}

async function getPackageLicenses() {
	// Try using license-checker or similar tools
	const commands = [
		{ cmd: "npx license-checker --json 2>/dev/null", name: "license-checker" },
		{ cmd: "npx legally --json 2>/dev/null", name: "legally" },
	];

	for (const { cmd, name } of commands) {
		try {
			const output = execSync(cmd, {
				cwd: projectRoot,
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 60000,
			});

			const data = JSON.parse(output);
			return { tool: name, licenses: data, success: true };
		} catch (err) {
			if (err.stdout) {
				try {
					return { tool: name, licenses: JSON.parse(err.stdout), success: true };
				} catch {
					// Parse error
				}
			}
		}
	}

	return { tool: null, licenses: null, success: false };
}

async function getNewDependencies() {
	// Read current package.json to identify recent additions
	// This is a simplified approach - ideally compare with git diff
	try {
		const pkgPath = path.join(projectRoot, "package.json");
		const content = await fs.readFile(pkgPath, "utf8");
		const pkg = JSON.parse(content);

		const deps = {};
		if (pkg.dependencies) {
			for (const [name, version] of Object.entries(pkg.dependencies)) {
				deps[name] = version;
			}
		}
		if (pkg.devDependencies) {
			for (const [name, version] of Object.entries(pkg.devDependencies)) {
				deps[name] = version;
			}
		}

		return deps;
	} catch (err) {
		return {};
	}
}

function checkLicenseCompliance(licenses, policy) {
	const results = {
		allowed: [],
		blocked: [],
		warned: [],
	};

	for (const [packageName, info] of Object.entries(licenses)) {
		// Skip if it's the project itself
		if (packageName.includes(projectRoot)) continue;

		const license = typeof info === "string" ? info : (info.licenses || info.license || "UNKNOWN");
		const category = categorizeLicense(license);

		// Check for override
		const baseName = packageName.split("@")[0].replace(/^.*\//, "");
		if (policy.overrides[baseName]) {
			const override = policy.overrides[baseName];
			if (override === "allow") {
				results.allowed.push({ package: packageName, license, category, overridden: true });
				continue;
			}
			if (override === "block") {
				results.blocked.push({ package: packageName, license, category, overridden: true });
				continue;
			}
		}

		// Apply policy
		if (policy.blocked.includes(category)) {
			results.blocked.push({ package: packageName, license, category });
		} else if (policy.warned.includes(category)) {
			results.warned.push({ package: packageName, license, category });
		} else {
			results.allowed.push({ package: packageName, license, category });
		}
	}

	return results;
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;

	if (!filePath || !isPackageJson(filePath)) {
		process.exit(0);
	}

	console.error("");
	console.error(`${colors.cyan}📜 License Compliance Check${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} package.json modified, checking licenses...`);

	const policy = await loadPolicy();
	const { tool, licenses, success } = await getPackageLicenses();

	if (!success) {
		console.error(`${colors.yellow}⚠️ Could not check licenses${colors.reset}`);
		console.error("   Install license-checker: npm install -g license-checker");
		console.error("");
		process.exit(0);
	}

	console.error(`${colors.blue}[INFO]${colors.reset} Using ${tool}`);

	const results = checkLicenseCompliance(licenses, policy);

	// Display summary
	const total = results.allowed.length + results.blocked.length + results.warned.length;
	console.error(`${colors.blue}[INFO]${colors.reset} Checked ${total} packages`);
	console.error("");

	// Show blocked packages
	if (results.blocked.length > 0) {
		console.error(`${colors.red}❌ Blocked licenses (${results.blocked.length}):${colors.reset}`);
		results.blocked.forEach(pkg => {
			const override = pkg.overridden ? " [override]" : "";
			console.error(`   ${colors.red}•${colors.reset} ${pkg.package}`);
			console.error(`     License: ${pkg.license} (${pkg.category})${override}`);
		});
		console.error("");
	}

	// Show warned packages
	if (results.warned.length > 0) {
		console.error(`${colors.yellow}⚠️ Needs review (${results.warned.length}):${colors.reset}`);
		results.warned.slice(0, 5).forEach(pkg => {
			console.error(`   ${colors.yellow}•${colors.reset} ${pkg.package}: ${pkg.license}`);
		});
		if (results.warned.length > 5) {
			console.error(`   ... and ${results.warned.length - 5} more`);
		}
		console.error("");
	}

	// Show allowed summary
	console.error(`${colors.green}✓ Compatible licenses: ${results.allowed.length}${colors.reset}`);
	console.error("");

	// Block if any blocked licenses
	if (results.blocked.length > 0) {
		console.error(`${colors.cyan}Policy:${colors.reset}`);
		console.error(`   Blocked categories: ${policy.blocked.join(", ")}`);
		console.error("");
		console.error(`${colors.cyan}To allow a specific package:${colors.reset}`);
		console.error("   Add to .claude/hooks/hook-config.json:");
		console.error(`   { "licensePolicy": { "overrides": { "package-name": "allow" } } }`);
		console.error("");
		console.error(`${colors.red}⛔ Blocking due to incompatible licenses${colors.reset}`);
		process.exit(2);
	}

	console.error(`${colors.green}✅ All licenses compatible${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
