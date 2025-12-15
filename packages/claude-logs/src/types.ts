/**
 * Raw JSONL log entry structure from Claude Code log files
 */
export interface RawLogEntry {
	uuid: string;
	sessionId: string;
	timestamp: string; // ISO-8601
	message?: {
		role?: "user" | "assistant";
		model?: string;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
		};
	};
	costUSD?: number;
	gitBranch?: string;
	cwd?: string;
}

/**
 * Parsed and normalized log entry ready for database storage
 */
export interface ParsedLogEntry {
	uuid: string;
	sessionId: string;
	projectPath: string;
	timestamp: number; // Unix timestamp ms
	role: string;
	model: string | null;
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
	totalTokens: number;
	costUsd: number;
	gitBranch: string | null;
	cwd: string | null;
	filePath: string;
	fileModifiedAt: number;
}

/**
 * File metadata for incremental processing
 */
export interface ProcessedFile {
	filePath: string;
	lastModifiedAt: number;
	lastSize: number;
	lastLineCount: number;
	processedAt: number;
}

/**
 * Result from scanning JSONL files
 */
export interface ScanResult {
	entries: ParsedLogEntry[];
	filesProcessed: number;
	filesSkipped: number;
	entriesFound: number;
	errors: ScanError[];
	configDirsUsed: string[];
}

/**
 * Error during scanning
 */
export interface ScanError {
	filePath: string;
	line?: number;
	error: string;
}

/**
 * Options for the ClaudeLogsService
 */
export interface ClaudeLogsServiceOptions {
	watchEnabled?: boolean;
	scanOnStartup?: boolean;
	scanIntervalMs?: number;
}

/**
 * File watcher event types
 */
export type FileWatchEvent = "created" | "modified" | "deleted";

/**
 * File watcher event data
 */
export interface FileWatchEventData {
	type: FileWatchEvent;
	filePath: string;
	timestamp: number;
}
