import type { ParsedLogEntry, RawLogEntry, ScanError } from "./types";

/**
 * Parse a single JSONL line into a log entry
 *
 * @param line - A single line from a JSONL file
 * @param filePath - Path to the source file
 * @param projectPath - Extracted project path
 * @param fileModifiedAt - File modification timestamp
 * @param lineNumber - Line number for error reporting
 * @returns ParsedLogEntry or null if line is invalid/empty
 */
export function parseLine(
	line: string,
	filePath: string,
	projectPath: string,
	fileModifiedAt: number,
	lineNumber?: number,
): { entry: ParsedLogEntry | null; error: ScanError | null } {
	const trimmed = line.trim();

	// Skip empty lines
	if (!trimmed) {
		return { entry: null, error: null };
	}

	try {
		const raw = JSON.parse(trimmed) as RawLogEntry;

		// Validate required fields
		if (!raw.uuid || !raw.sessionId || !raw.timestamp) {
			return {
				entry: null,
				error: {
					filePath,
					line: lineNumber,
					error: "Missing required fields (uuid, sessionId, or timestamp)",
				},
			};
		}

		// Parse timestamp
		const timestamp = new Date(raw.timestamp).getTime();
		if (Number.isNaN(timestamp)) {
			return {
				entry: null,
				error: {
					filePath,
					line: lineNumber,
					error: `Invalid timestamp: ${raw.timestamp}`,
				},
			};
		}

		// Extract usage data
		const usage = raw.message?.usage || {};
		const inputTokens = usage.input_tokens || 0;
		const outputTokens = usage.output_tokens || 0;
		const cacheCreationInputTokens = usage.cache_creation_input_tokens || 0;
		const cacheReadInputTokens = usage.cache_read_input_tokens || 0;
		const totalTokens =
			inputTokens +
			outputTokens +
			cacheCreationInputTokens +
			cacheReadInputTokens;

		const entry: ParsedLogEntry = {
			uuid: raw.uuid,
			sessionId: raw.sessionId,
			projectPath,
			timestamp,
			role: raw.message?.role || "unknown",
			model: raw.message?.model || null,
			inputTokens,
			outputTokens,
			cacheCreationInputTokens,
			cacheReadInputTokens,
			totalTokens,
			costUsd: raw.costUSD || 0,
			gitBranch: raw.gitBranch || null,
			cwd: raw.cwd || null,
			filePath,
			fileModifiedAt,
		};

		return { entry, error: null };
	} catch (err) {
		return {
			entry: null,
			error: {
				filePath,
				line: lineNumber,
				error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
			},
		};
	}
}

/**
 * Parse entire JSONL file content
 *
 * @param content - Full file content
 * @param filePath - Path to the source file
 * @param projectPath - Extracted project path
 * @param fileModifiedAt - File modification timestamp
 * @returns Array of parsed entries and any errors
 */
export function parseJSONLContent(
	content: string,
	filePath: string,
	projectPath: string,
	fileModifiedAt: number,
): { entries: ParsedLogEntry[]; errors: ScanError[] } {
	const entries: ParsedLogEntry[] = [];
	const errors: ScanError[] = [];

	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const { entry, error } = parseLine(
			lines[i],
			filePath,
			projectPath,
			fileModifiedAt,
			i + 1,
		);

		if (entry) {
			entries.push(entry);
		}
		if (error) {
			errors.push(error);
		}
	}

	return { entries, errors };
}

/**
 * Parse JSONL content starting from a specific line (for incremental updates)
 *
 * @param content - Full file content
 * @param filePath - Path to the source file
 * @param projectPath - Extracted project path
 * @param fileModifiedAt - File modification timestamp
 * @param startLine - Line number to start from (0-indexed)
 * @returns Array of parsed entries and any errors
 */
export function parseJSONLContentFromLine(
	content: string,
	filePath: string,
	projectPath: string,
	fileModifiedAt: number,
	startLine: number,
): { entries: ParsedLogEntry[]; errors: ScanError[]; lineCount: number } {
	const entries: ParsedLogEntry[] = [];
	const errors: ScanError[] = [];

	const lines = content.split("\n");
	const lineCount = lines.length;

	for (let i = startLine; i < lines.length; i++) {
		const { entry, error } = parseLine(
			lines[i],
			filePath,
			projectPath,
			fileModifiedAt,
			i + 1,
		);

		if (entry) {
			entries.push(entry);
		}
		if (error) {
			errors.push(error);
		}
	}

	return { entries, errors, lineCount };
}
