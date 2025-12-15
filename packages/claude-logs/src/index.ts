// Main service
export { ClaudeLogsService, type ClaudeLogsRepository } from "./service";

// Watcher
export { ClaudeLogWatcher } from "./watcher";

// Scanner
export {
	scanAllJSONLFiles,
	scanModifiedFiles,
	getFileMetadata,
} from "./scanner";

// Parser
export {
	parseLine,
	parseJSONLContent,
	parseJSONLContentFromLine,
} from "./parser";

// Paths
export {
	getClaudeConfigDirs,
	getProjectsDir,
	extractProjectPath,
} from "./paths";

// Types
export type {
	RawLogEntry,
	ParsedLogEntry,
	ProcessedFile,
	ScanResult,
	ScanError,
	ClaudeLogsServiceOptions,
	FileWatchEvent,
	FileWatchEventData,
} from "./types";
