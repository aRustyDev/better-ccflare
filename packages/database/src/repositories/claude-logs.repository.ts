import type { Database } from "bun:sqlite";
import type {
	ClaudeLogEntryRow,
	ClaudeProcessedFileRow,
	DailyUsage,
	MonthlyUsage,
	SessionUsage,
	BillingBlockUsage,
	ProjectSummary,
} from "@better-ccflare/types";
import { BaseRepository } from "./base.repository";

/**
 * Parsed log entry from the claude-logs package
 */
export interface ParsedLogEntry {
	uuid: string;
	sessionId: string;
	projectPath: string;
	timestamp: number;
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
 * Processed file tracking info
 */
export interface ProcessedFile {
	filePath: string;
	lastModifiedAt: number;
	lastSize: number;
	lastLineCount: number;
	processedAt: number;
}

/**
 * Repository for Claude log entries database operations
 */
export class ClaudeLogsRepository extends BaseRepository<ClaudeLogEntryRow> {
	constructor(db: Database) {
		super(db);
	}

	/**
	 * Save a single log entry (upsert)
	 */
	saveEntry(entry: ParsedLogEntry): void {
		this.run(
			`INSERT OR REPLACE INTO claude_log_entries (
				uuid, session_id, project_path, timestamp, role, model,
				input_tokens, output_tokens, cache_creation_input_tokens,
				cache_read_input_tokens, total_tokens, cost_usd,
				git_branch, cwd, file_path, file_modified_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entry.uuid,
				entry.sessionId,
				entry.projectPath,
				entry.timestamp,
				entry.role,
				entry.model,
				entry.inputTokens,
				entry.outputTokens,
				entry.cacheCreationInputTokens,
				entry.cacheReadInputTokens,
				entry.totalTokens,
				entry.costUsd,
				entry.gitBranch,
				entry.cwd,
				entry.filePath,
				entry.fileModifiedAt,
			],
		);
	}

	/**
	 * Save multiple log entries in a transaction
	 */
	async saveEntries(entries: ParsedLogEntry[]): Promise<void> {
		if (entries.length === 0) return;

		const insertStmt = this.db.prepare(
			`INSERT OR REPLACE INTO claude_log_entries (
				uuid, session_id, project_path, timestamp, role, model,
				input_tokens, output_tokens, cache_creation_input_tokens,
				cache_read_input_tokens, total_tokens, cost_usd,
				git_branch, cwd, file_path, file_modified_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);

		const transaction = this.db.transaction((entries: ParsedLogEntry[]) => {
			for (const entry of entries) {
				insertStmt.run(
					entry.uuid,
					entry.sessionId,
					entry.projectPath,
					entry.timestamp,
					entry.role,
					entry.model,
					entry.inputTokens,
					entry.outputTokens,
					entry.cacheCreationInputTokens,
					entry.cacheReadInputTokens,
					entry.totalTokens,
					entry.costUsd,
					entry.gitBranch,
					entry.cwd,
					entry.filePath,
					entry.fileModifiedAt,
				);
			}
		});

		transaction(entries);
	}

	/**
	 * Get daily usage aggregation
	 */
	getDailyUsage(
		startDate?: string,
		endDate?: string,
		project?: string,
	): DailyUsage[] {
		let sql = `
			SELECT
				date(timestamp / 1000, 'unixepoch', 'localtime') as date,
				SUM(input_tokens) as inputTokens,
				SUM(output_tokens) as outputTokens,
				SUM(cache_creation_input_tokens) as cacheCreationInputTokens,
				SUM(cache_read_input_tokens) as cacheReadInputTokens,
				SUM(total_tokens) as totalTokens,
				SUM(cost_usd) as costUsd,
				COUNT(*) as requestCount,
				COUNT(DISTINCT session_id) as sessionCount
			FROM claude_log_entries
			WHERE 1=1
		`;
		const params: (string | number)[] = [];

		if (startDate) {
			sql += ` AND date(timestamp / 1000, 'unixepoch', 'localtime') >= ?`;
			params.push(startDate);
		}
		if (endDate) {
			sql += ` AND date(timestamp / 1000, 'unixepoch', 'localtime') <= ?`;
			params.push(endDate);
		}
		if (project) {
			sql += ` AND project_path = ?`;
			params.push(project);
		}

		sql += ` GROUP BY date ORDER BY date DESC`;

		return this.query<DailyUsage>(sql, params);
	}

	/**
	 * Get monthly usage aggregation
	 */
	getMonthlyUsage(startMonth?: string, endMonth?: string): MonthlyUsage[] {
		let sql = `
			SELECT
				strftime('%Y-%m', timestamp / 1000, 'unixepoch', 'localtime') as month,
				SUM(input_tokens) as inputTokens,
				SUM(output_tokens) as outputTokens,
				SUM(cache_creation_input_tokens) as cacheCreationInputTokens,
				SUM(cache_read_input_tokens) as cacheReadInputTokens,
				SUM(total_tokens) as totalTokens,
				SUM(cost_usd) as costUsd,
				COUNT(*) as requestCount,
				COUNT(DISTINCT session_id) as sessionCount,
				COUNT(DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime')) as dayCount
			FROM claude_log_entries
			WHERE 1=1
		`;
		const params: string[] = [];

		if (startMonth) {
			sql += ` AND strftime('%Y-%m', timestamp / 1000, 'unixepoch', 'localtime') >= ?`;
			params.push(startMonth);
		}
		if (endMonth) {
			sql += ` AND strftime('%Y-%m', timestamp / 1000, 'unixepoch', 'localtime') <= ?`;
			params.push(endMonth);
		}

		sql += ` GROUP BY month ORDER BY month DESC`;

		return this.query<MonthlyUsage>(sql, params);
	}

	/**
	 * Get session-based usage with pagination
	 */
	getSessionUsage(
		limit = 50,
		offset = 0,
		project?: string,
	): { sessions: SessionUsage[]; totalCount: number } {
		let countSql = `SELECT COUNT(DISTINCT session_id) as count FROM claude_log_entries WHERE 1=1`;
		let sql = `
			SELECT
				session_id as sessionId,
				project_path as projectPath,
				MIN(timestamp) as startTime,
				MAX(timestamp) as endTime,
				SUM(input_tokens) as inputTokens,
				SUM(output_tokens) as outputTokens,
				SUM(cache_creation_input_tokens) as cacheCreationInputTokens,
				SUM(cache_read_input_tokens) as cacheReadInputTokens,
				SUM(total_tokens) as totalTokens,
				SUM(cost_usd) as costUsd,
				COUNT(*) as requestCount,
				MAX(model) as model,
				MAX(git_branch) as gitBranch
			FROM claude_log_entries
			WHERE 1=1
		`;
		const params: (string | number)[] = [];
		const countParams: string[] = [];

		if (project) {
			sql += ` AND project_path = ?`;
			countSql += ` AND project_path = ?`;
			params.push(project);
			countParams.push(project);
		}

		sql += ` GROUP BY session_id ORDER BY endTime DESC LIMIT ? OFFSET ?`;
		params.push(limit, offset);

		const sessions = this.query<SessionUsage>(sql, params).map((s) => ({
			...s,
			startTime: new Date(s.startTime as unknown as number).toISOString(),
			endTime: new Date(s.endTime as unknown as number).toISOString(),
		}));

		const countResult = this.get<{ count: number }>(countSql, countParams);
		const totalCount = countResult?.count || 0;

		return { sessions, totalCount };
	}

	/**
	 * Get 5-hour billing block usage (matches Anthropic's rate limit windows)
	 */
	getBillingBlockUsage(
		startTime?: number,
		endTime?: number,
	): BillingBlockUsage[] {
		// 5 hours in milliseconds
		const blockSize = 5 * 60 * 60 * 1000;

		let sql = `
			SELECT
				(timestamp / ${blockSize}) * ${blockSize} as blockStart,
				((timestamp / ${blockSize}) + 1) * ${blockSize} as blockEnd,
				SUM(input_tokens) as inputTokens,
				SUM(output_tokens) as outputTokens,
				SUM(cache_creation_input_tokens) as cacheCreationInputTokens,
				SUM(cache_read_input_tokens) as cacheReadInputTokens,
				SUM(total_tokens) as totalTokens,
				SUM(cost_usd) as costUsd,
				COUNT(*) as requestCount
			FROM claude_log_entries
			WHERE 1=1
		`;
		const params: number[] = [];

		if (startTime) {
			sql += ` AND timestamp >= ?`;
			params.push(startTime);
		}
		if (endTime) {
			sql += ` AND timestamp <= ?`;
			params.push(endTime);
		}

		sql += ` GROUP BY blockStart ORDER BY blockStart DESC`;

		return this.query<BillingBlockUsage>(sql, params).map((b) => ({
			...b,
			blockStart: new Date(b.blockStart as unknown as number).toISOString(),
			blockEnd: new Date(b.blockEnd as unknown as number).toISOString(),
		}));
	}

	/**
	 * Get list of unique projects
	 */
	getProjects(): ProjectSummary[] {
		const sql = `
			SELECT
				project_path as projectPath,
				COUNT(DISTINCT session_id) as sessionCount,
				SUM(total_tokens) as totalTokens,
				SUM(cost_usd) as costUsd,
				MAX(timestamp) as lastActivity
			FROM claude_log_entries
			GROUP BY project_path
			ORDER BY lastActivity DESC
		`;

		return this.query<ProjectSummary>(sql).map((p) => ({
			...p,
			lastActivity: new Date(p.lastActivity as unknown as number).toISOString(),
		}));
	}

	/**
	 * Get all processed files for incremental scanning
	 */
	async getProcessedFiles(): Promise<Map<string, ProcessedFile>> {
		const rows = this.query<ClaudeProcessedFileRow>(
			`SELECT * FROM claude_processed_files`,
		);

		const map = new Map<string, ProcessedFile>();
		for (const row of rows) {
			map.set(row.file_path, {
				filePath: row.file_path,
				lastModifiedAt: row.last_modified_at,
				lastSize: row.last_size,
				lastLineCount: row.last_line_count,
				processedAt: row.processed_at,
			});
		}

		return map;
	}

	/**
	 * Mark a file as processed
	 */
	async markFileProcessed(file: ProcessedFile): Promise<void> {
		this.run(
			`INSERT OR REPLACE INTO claude_processed_files
			(file_path, last_modified_at, last_size, last_line_count, processed_at)
			VALUES (?, ?, ?, ?, ?)`,
			[
				file.filePath,
				file.lastModifiedAt,
				file.lastSize,
				file.lastLineCount,
				file.processedAt,
			],
		);
	}

	/**
	 * Delete all entries from a specific file (for re-processing)
	 */
	async deleteEntriesFromFile(filePath: string): Promise<void> {
		this.run(`DELETE FROM claude_log_entries WHERE file_path = ?`, [filePath]);
		this.run(`DELETE FROM claude_processed_files WHERE file_path = ?`, [
			filePath,
		]);
	}

	/**
	 * Get total entry count
	 */
	getTotalEntryCount(): number {
		const result = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM claude_log_entries`,
		);
		return result?.count || 0;
	}

	/**
	 * Get total cost across all entries
	 */
	getTotalCost(): number {
		const result = this.get<{ total: number }>(
			`SELECT SUM(cost_usd) as total FROM claude_log_entries`,
		);
		return result?.total || 0;
	}
}
