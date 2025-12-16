#!/usr/bin/env node
/**
 * Large File Warning
 *
 * TRIGGER: PreToolUse
 * MATCHER: Write|Edit|MultiEdit
 *
 * Alerts when adding files larger than configured thresholds.
 * Helps prevent accidentally committing large files.
 *
 * EXIT CODES:
 *   0 - File size OK or warning only
 *   2 - File exceeds hard limit (blocks)
 */

const fs = require("fs").promises;
const path = require("path");

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Size thresholds
const THRESHOLDS = {
	// Soft limit - warns but allows
	warnBytes: 100 * 1024,      // 100 KB
	// Hard limit - blocks
	blockBytes: 1024 * 1024,    // 1 MB
	// Line count thresholds
	warnLines: 500,
	blockLines: 2000,
};

// File patterns with custom thresholds (relaxed)
const RELAXED_PATTERNS = [
	{ pattern: /\.lock$/, warnBytes: 10 * 1024 * 1024 },      // Lock files can be large
	{ pattern: /\.json$/, warnBytes: 500 * 1024 },            // JSON can be larger
	{ pattern: /\.svg$/, warnBytes: 500 * 1024 },             // SVGs can be verbose
	{ pattern: /\.md$/, warnLines: 1000 },                    // Docs can be long
	{ pattern: /migrations?\.ts$/, warnLines: 1000 },         // Migrations can be long
];

// Patterns that should always be blocked regardless of size
const ALWAYS_BLOCK_PATTERNS = [
	/\.zip$/i,
	/\.tar$/i,
	/\.gz$/i,
	/\.rar$/i,
	/\.7z$/i,
	/\.exe$/i,
	/\.dll$/i,
	/\.so$/i,
	/\.dylib$/i,
	/\.mp4$/i,
	/\.mp3$/i,
	/\.wav$/i,
	/\.avi$/i,
	/\.mov$/i,
	/\.pdf$/i,
	/\.psd$/i,
	/\.ai$/i,
];

// Patterns that should be ignored (allowed regardless of size)
const IGNORE_PATTERNS = [
	/node_modules\//,
	/\.git\//,
	/dist\//,
	/build\//,
	/coverage\//,
];

const colors = {
	red: "\x1b[0;31m",
	green: "\x1b[0;32m",
	yellow: "\x1b[0;33m",
	blue: "\x1b[0;34m",
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

function formatBytes(bytes) {
	const units = ["B", "KB", "MB", "GB"];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function getThresholdsForFile(filePath) {
	const relativePath = path.relative(projectRoot, filePath);

	// Check if should be ignored
	if (IGNORE_PATTERNS.some(p => p.test(relativePath))) {
		return null;
	}

	// Start with defaults
	const thresholds = { ...THRESHOLDS };

	// Apply relaxed patterns
	for (const { pattern, warnBytes, blockBytes, warnLines, blockLines } of RELAXED_PATTERNS) {
		if (pattern.test(relativePath)) {
			if (warnBytes) thresholds.warnBytes = warnBytes;
			if (blockBytes) thresholds.blockBytes = blockBytes;
			if (warnLines) thresholds.warnLines = warnLines;
			if (blockLines) thresholds.blockLines = blockLines;
		}
	}

	return thresholds;
}

function shouldBlockFileType(filePath) {
	const relativePath = path.relative(projectRoot, filePath);
	const matchedPattern = ALWAYS_BLOCK_PATTERNS.find(p => p.test(relativePath));

	if (matchedPattern) {
		return {
			blocked: true,
			reason: `Binary/media file type not allowed: ${matchedPattern.source}`,
		};
	}

	return { blocked: false };
}

function getContentFromInput(toolInput) {
	// For Write tool
	if (toolInput.content !== undefined) {
		return toolInput.content;
	}

	// For Edit tool - estimate size change
	if (toolInput.new_string !== undefined) {
		return toolInput.new_string;
	}

	// For MultiEdit tool
	if (toolInput.edits) {
		return toolInput.edits.map(e => e.new_string || "").join("\n");
	}

	return null;
}

async function main() {
	const input = await parseInput();

	if (!input) {
		process.exit(0);
	}

	const { tool_name, tool_input } = input;
	const filePath = tool_input?.file_path || tool_input?.path;
	const content = getContentFromInput(tool_input);

	if (!filePath) {
		process.exit(0);
	}

	const relativePath = path.relative(projectRoot, filePath);

	// Check file type first
	const typeCheck = shouldBlockFileType(filePath);
	if (typeCheck.blocked) {
		console.error("");
		console.error(`${colors.red}📦 Large File Warning${colors.reset}`);
		console.error("────────────────────────────────────────────");
		console.error(`${colors.red}❌ Blocked: ${relativePath}${colors.reset}`);
		console.error("");
		console.error(`   ${typeCheck.reason}`);
		console.error("");
		console.error(`${colors.cyan}Suggestions:${colors.reset}`);
		console.error("   • Use Git LFS for large binary files");
		console.error("   • Store media files in cloud storage (S3, etc.)");
		console.error("   • Add to .gitignore if not needed in repo");
		console.error("");
		process.exit(2);
	}

	// Get thresholds for this file
	const thresholds = getThresholdsForFile(filePath);

	if (!thresholds) {
		// File is in ignored path
		process.exit(0);
	}

	// Calculate size
	let sizeBytes = 0;
	let lineCount = 0;

	if (content) {
		sizeBytes = Buffer.byteLength(content, "utf8");
		lineCount = content.split("\n").length;
	} else {
		// Can't determine size without content
		process.exit(0);
	}

	// Check against thresholds
	const warnings = [];
	let shouldBlock = false;

	// Check byte size
	if (sizeBytes >= thresholds.blockBytes) {
		warnings.push({
			type: "size",
			level: "block",
			message: `File size (${formatBytes(sizeBytes)}) exceeds limit (${formatBytes(thresholds.blockBytes)})`,
		});
		shouldBlock = true;
	} else if (sizeBytes >= thresholds.warnBytes) {
		warnings.push({
			type: "size",
			level: "warn",
			message: `File size (${formatBytes(sizeBytes)}) exceeds warning threshold (${formatBytes(thresholds.warnBytes)})`,
		});
	}

	// Check line count
	if (lineCount >= thresholds.blockLines) {
		warnings.push({
			type: "lines",
			level: "block",
			message: `Line count (${lineCount}) exceeds limit (${thresholds.blockLines})`,
		});
		shouldBlock = true;
	} else if (lineCount >= thresholds.warnLines) {
		warnings.push({
			type: "lines",
			level: "warn",
			message: `Line count (${lineCount}) exceeds warning threshold (${thresholds.warnLines})`,
		});
	}

	if (warnings.length === 0) {
		process.exit(0);
	}

	// Display warnings
	console.error("");
	console.error(`${colors.yellow}📦 Large File Warning${colors.reset}`);
	console.error("────────────────────────────────────────────");
	console.error(`${colors.blue}[INFO]${colors.reset} File: ${relativePath}`);
	console.error("");

	console.error(`${colors.cyan}File stats:${colors.reset}`);
	console.error(`   Size: ${formatBytes(sizeBytes)}`);
	console.error(`   Lines: ${lineCount}`);
	console.error("");

	for (const warning of warnings) {
		const color = warning.level === "block" ? colors.red : colors.yellow;
		const icon = warning.level === "block" ? "❌" : "⚠️";
		console.error(`${color}${icon} ${warning.message}${colors.reset}`);
	}

	console.error("");
	console.error(`${colors.cyan}Suggestions:${colors.reset}`);

	if (warnings.some(w => w.type === "lines")) {
		console.error("   • Split into smaller modules/components");
		console.error("   • Extract reusable functions");
		console.error("   • Move types to separate file");
	}

	if (warnings.some(w => w.type === "size")) {
		console.error("   • Remove commented-out code");
		console.error("   • Extract large data to separate files");
		console.error("   • Consider if all content is necessary");
	}

	console.error("");

	if (shouldBlock) {
		console.error(`${colors.red}⛔ Blocking due to size limits${colors.reset}`);
		process.exit(2);
	}

	console.error(`${colors.yellow}⚠️ Warning logged (not blocking)${colors.reset}`);
	process.exit(0);
}

main().catch(err => {
	console.error(`[ERROR] ${err.message}`);
	process.exit(0);
});
