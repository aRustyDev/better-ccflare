#!/usr/bin/env node
/**
 * Import Cycle Detector
 *
 * TRIGGER: PostToolUse
 * MATCHER: Write|Edit|MultiEdit (on .ts/.js files)
 *
 * Warns about circular dependencies in TypeScript/JavaScript imports.
 * Uses madge or manual analysis to detect import cycles.
 *
 * EXIT CODES:
 *   0 - No cycles detected (or warning only)
 *   2 - Cycles detected (optional blocking mode)
 */

const { execSync } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Configuration
const CONFIG = {
	// Set to true to block on cycles
	blockOnCycles: false,
	// Only analyze these directories
	includeDirs: ["src", "packages", "apps", "lib"],
	// Ignore these directories
	ignoreDirs: ["node_modules", "dist", "build", ".next", "coverage"],
	// File extensions to analyze
	extensions: [".ts", ".tsx", ".js", ".jsx"],
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

function isSourceFile(filePath) {
	const ext = path.extname(filePath);
	if (!CONFIG.extensions.includes(ext)) {
		return false;
	}

	const relativePath = path.relative(projectRoot, filePath);

	// Check if in included directory
	const inIncluded = CONFIG.includeDirs.some(dir =>
		relativePath.startsWith(dir + "/") || relativePath.startsWith(dir + path.sep)
	);

	// Check if in ignored directory
	const inIgnored = CONFIG.ignoreDirs.some(dir =>
		relativePath.includes(dir + "/") || relativePath.includes(dir + path.sep)
	);

	return inIncluded && !inIgnored;
}

function runMadge(filePath) {
	// Try to use madge if installed
	try {
		const relativePath = path.relative(projectRoot, filePath);
		const dir = path.dirname(relativePath);

		// Run madge on the directory containing the file
		const output = execSync(`npx madge --circular --json "${dir}"`, {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 30000,
		});

		return { success: true, output: JSON.parse(output) };
	} catch (err) {
		if (err.stdout) {
			try {
				return { success: true, output: JSON.parse(err.stdout) };
			} catch {
				// Parse error
			}
		}
		return { success: false, output: null };
	}
}

async function extractImports(filePath) {
	try {
		const content = await fs.readFile(filePath, "utf8");
		const imports = [];

		// Match ES6 imports
		const esImportPattern = /import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?["']([^"']+)["']/g;
		let match;
		while ((match = esImportPattern.exec(content)) !== null) {
			imports.push(match[1]);
		}

		// Match require statements
		const requirePattern = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
		while ((match = requirePattern.exec(content)) !== null) {
			imports.push(match[1]);
		}

		// Match dynamic imports
		const dynamicPattern = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
		while ((match = dynamicPattern.exec(content)) !== null) {
			imports.push(match[1]);
		}

		return imports;
	} catch (err) {
		return [];
	}
}

function resolveImportPath(importPath, fromFile) {
	// Skip node modules
	if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
		return null;
	}

	const fromDir = path.dirname(fromFile);
	let resolved = path.resolve(fromDir, importPath);

	// Try adding extensions
	for (const ext of CONFIG.extensions) {
		const withExt = resolved + ext;
		try {
			require("fs").accessSync(withExt);
			return withExt;
		} catch {
			// Try next
		}
	}

	// Try index files
	for (const ext of CONFIG.extensions) {
		const indexPath = path.join(resolved, `index${ext}`);
		try {
			require("fs").accessSync(indexPath);
			return indexPath;
		} catch {
			// Try next
		}
	}

	return null;
}

async function buildDependencyGraph(entryFile, visited = new Set(), graph = new Map()) {
	if (visited.has(entryFile)) {
		return graph;
	}

	visited.add(entryFile);
	const imports = await extractImports(entryFile);
	const resolvedImports = [];

	for (const imp of imports) {
		const resolved = resolveImportPath(imp, entryFile);
		if (resolved && isSourceFile(resolved)) {
			resolvedImports.push(resolved);
			await buildDependencyGraph(resolved, visited, graph);
		}
	}

	graph.set(entryFile, resolvedImports);
	return graph;
}

function findCycles(graph) {
	const cycles = [];
	const visited = new Set();
	const recursionStack = new Set();

	function dfs(node, path = []) {
		if (recursionStack.has(node)) {
			// Found a cycle
			const cycleStart = path.indexOf(node);
			const cycle = path.slice(cycleStart).concat(node);
			cycles.push(cycle);
			return;
		}

		if (visited.has(node)) {
			return;
		}

		visited.add(node);
		recursionStack.add(node);

		const deps = graph.get(node) || [];
		for (const dep of deps) {
			dfs(dep, [...path, node]);
		}

		recursionStack.delete(node);
	}

	for (const node of graph.keys()) {
		visited.clear();
		recursionStack.clear();
		dfs(node);
	}

	// Deduplicate cycles
	const uniqueCycles = [];
	const seen = new Set();

	for (const cycle of cycles) {
		const key = [...cycle].sort().join("::");
		if (!seen.has(key)) {
			seen.add(key);
			uniqueCycles.push(cycle);
		}
	}

	return uniqueCycles;
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;

	if (!filePath || !isSourceFile(filePath)) {
		process.exit(0);
	}

	const relativePath = path.relative(projectRoot, filePath);

	console.error("");
	console.error(`${colors.cyan}🔄 Import Cycle Detector${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} Checking imports in: ${relativePath}`);

	// Try madge first
	const madgeResult = runMadge(filePath);

	let cycles = [];

	if (madgeResult.success && Array.isArray(madgeResult.output)) {
		cycles = madgeResult.output;
		if (cycles.length > 0) {
			console.error(`${colors.blue}[INFO]${colors.reset} Using madge for analysis`);
		}
	} else {
		// Fallback to manual analysis
		console.error(`${colors.blue}[INFO]${colors.reset} Using manual import analysis`);
		const graph = await buildDependencyGraph(filePath);
		const detectedCycles = findCycles(graph);

		// Format cycles for display
		cycles = detectedCycles.map(cycle =>
			cycle.map(f => path.relative(projectRoot, f))
		);
	}

	if (cycles.length === 0) {
		console.error(`${colors.green}✅ No circular dependencies detected${colors.reset}`);
		process.exit(0);
	}

	// Display cycles
	console.error("");
	console.error(`${colors.yellow}⚠️ Found ${cycles.length} circular dependency chain(s):${colors.reset}`);
	console.error("");

	cycles.forEach((cycle, index) => {
		console.error(`${colors.magenta}Cycle ${index + 1}:${colors.reset}`);
		if (Array.isArray(cycle)) {
			cycle.forEach((file, i) => {
				const arrow = i < cycle.length - 1 ? " →" : " ↺";
				console.error(`   ${file}${arrow}`);
			});
		} else {
			console.error(`   ${cycle}`);
		}
		console.error("");
	});

	console.error(`${colors.cyan}How to fix:${colors.reset}`);
	console.error("   1. Extract shared code to a separate module");
	console.error("   2. Use dependency injection");
	console.error("   3. Move types to a separate file");
	console.error("   4. Use dynamic imports for lazy loading");
	console.error("");

	if (CONFIG.blockOnCycles) {
		console.error(`${colors.red}⛔ Blocking due to circular dependencies${colors.reset}`);
		process.exit(2);
	}

	console.error(`${colors.yellow}⚠️ Warning logged (not blocking)${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
