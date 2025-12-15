/**
 * Types for Claude Code usage analysis API responses
 */

/**
 * Daily usage aggregation
 */
export interface DailyUsage {
	date: string; // YYYY-MM-DD
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
	totalTokens: number;
	costUsd: number;
	requestCount: number;
	sessionCount: number;
}

/**
 * Monthly usage aggregation
 */
export interface MonthlyUsage {
	month: string; // YYYY-MM
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
	totalTokens: number;
	costUsd: number;
	requestCount: number;
	sessionCount: number;
	dayCount: number;
}

/**
 * Session-based usage aggregation
 */
export interface SessionUsage {
	sessionId: string;
	projectPath: string;
	startTime: string; // ISO timestamp
	endTime: string; // ISO timestamp
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
	totalTokens: number;
	costUsd: number;
	requestCount: number;
	model: string | null;
	gitBranch: string | null;
}

/**
 * 5-hour billing block usage (matches Anthropic's rate limit windows)
 */
export interface BillingBlockUsage {
	blockStart: string; // ISO timestamp
	blockEnd: string; // ISO timestamp
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
	totalTokens: number;
	costUsd: number;
	requestCount: number;
}

/**
 * Project summary for filtering
 */
export interface ProjectSummary {
	projectPath: string;
	sessionCount: number;
	totalTokens: number;
	costUsd: number;
	lastActivity: string; // ISO timestamp
}

/**
 * Generic API response wrapper
 */
export interface UsageApiResponse<T> {
	success: boolean;
	data: T;
	pagination?: {
		page: number;
		pageSize: number;
		totalCount: number;
		totalPages: number;
	};
	meta?: {
		generatedAt: string;
		configDirs: string[];
	};
}

/**
 * Scan result response
 */
export interface ScanResultResponse {
	filesProcessed: number;
	filesSkipped: number;
	entriesFound: number;
	errors: Array<{
		filePath: string;
		line?: number;
		error: string;
	}>;
	configDirsUsed: string[];
}

/**
 * Database row types for Claude log entries
 */
export interface ClaudeLogEntryRow {
	uuid: string;
	session_id: string;
	project_path: string;
	timestamp: number;
	role: string;
	model: string | null;
	input_tokens: number;
	output_tokens: number;
	cache_creation_input_tokens: number;
	cache_read_input_tokens: number;
	total_tokens: number;
	cost_usd: number;
	git_branch: string | null;
	cwd: string | null;
	file_path: string;
	file_modified_at: number;
}

/**
 * Database row for processed files tracking
 */
export interface ClaudeProcessedFileRow {
	file_path: string;
	last_modified_at: number;
	last_size: number;
	last_line_count: number;
	processed_at: number;
}
