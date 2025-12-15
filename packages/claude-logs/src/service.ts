import { Logger } from "@better-ccflare/logger";
import { scanAllJSONLFiles, scanModifiedFiles, getFileMetadata } from "./scanner";
import { ClaudeLogWatcher } from "./watcher";
import type {
	ClaudeLogsServiceOptions,
	ProcessedFile,
	ScanResult,
} from "./types";

const log = new Logger("ClaudeLogsService");

// Default scan interval: 1 minute
const DEFAULT_SCAN_INTERVAL_MS = 60000;

/**
 * Repository interface for Claude logs database operations
 */
export interface ClaudeLogsRepository {
	saveEntries(entries: import("./types").ParsedLogEntry[]): Promise<void>;
	getProcessedFiles(): Promise<Map<string, ProcessedFile>>;
	markFileProcessed(file: ProcessedFile): Promise<void>;
	deleteEntriesFromFile(filePath: string): Promise<void>;
}

/**
 * Main service for managing Claude log file scanning and watching
 */
export class ClaudeLogsService {
	private repository: ClaudeLogsRepository;
	private watcher: ClaudeLogWatcher;
	private scanIntervalTimer: Timer | null = null;
	private processedFiles: Map<string, ProcessedFile> = new Map();
	private initialized = false;
	private options: Required<ClaudeLogsServiceOptions>;

	constructor(repository: ClaudeLogsRepository) {
		this.repository = repository;
		this.watcher = new ClaudeLogWatcher();
		this.options = {
			watchEnabled: false,
			scanOnStartup: true,
			scanIntervalMs: DEFAULT_SCAN_INTERVAL_MS,
		};

		// Set up watcher callback
		this.watcher.onFileChange(async (event) => {
			log.info(`File ${event.type}: ${event.filePath}`);
			await this.processModifiedFile(event.filePath);
		});
	}

	/**
	 * Initialize the service
	 */
	async initialize(options?: ClaudeLogsServiceOptions): Promise<void> {
		if (this.initialized) {
			log.warn("Service already initialized");
			return;
		}

		// Merge options
		this.options = {
			...this.options,
			...options,
		};

		log.info("Initializing Claude logs service", this.options);

		// Load processed files from database
		this.processedFiles = await this.repository.getProcessedFiles();
		log.info(`Loaded ${this.processedFiles.size} processed file records`);

		// Scan on startup if enabled
		if (this.options.scanOnStartup) {
			await this.scanAndImport();
		}

		// Start watching if enabled
		if (this.options.watchEnabled) {
			this.startWatching();
		}

		// Start periodic scanning if interval is set
		if (this.options.scanIntervalMs > 0) {
			this.startPeriodicScan();
		}

		this.initialized = true;
	}

	/**
	 * Perform a full scan of all JSONL files
	 */
	async scanAndImport(): Promise<ScanResult> {
		log.info("Starting full scan of Claude log files");

		const result = await scanAllJSONLFiles();

		if (result.entries.length > 0) {
			await this.repository.saveEntries(result.entries);
			log.info(`Saved ${result.entries.length} entries to database`);
		}

		// Update processed files tracking
		await this.updateProcessedFilesFromScan(result);

		return result;
	}

	/**
	 * Perform an incremental scan of modified files only
	 */
	async incrementalScan(): Promise<ScanResult> {
		log.debug("Starting incremental scan");

		const result = await scanModifiedFiles(this.processedFiles);

		if (result.entries.length > 0) {
			await this.repository.saveEntries(result.entries);
			log.info(`Saved ${result.entries.length} new entries to database`);
		}

		// Update processed files tracking
		await this.updateProcessedFilesFromScan(result);

		return result;
	}

	/**
	 * Start file watching
	 */
	startWatching(): void {
		if (this.watcher.watching) {
			return;
		}

		this.watcher.start();
		log.info("File watching started");
	}

	/**
	 * Stop file watching
	 */
	stopWatching(): void {
		this.watcher.stop();
		log.info("File watching stopped");
	}

	/**
	 * Check if the service is watching for changes
	 */
	get isWatching(): boolean {
		return this.watcher.watching;
	}

	/**
	 * Dispose of the service
	 */
	dispose(): void {
		// Stop watching
		this.watcher.stop();

		// Stop periodic scanning
		if (this.scanIntervalTimer) {
			clearInterval(this.scanIntervalTimer);
			this.scanIntervalTimer = null;
		}

		this.initialized = false;
		log.info("Claude logs service disposed");
	}

	/**
	 * Start periodic scanning
	 */
	private startPeriodicScan(): void {
		if (this.scanIntervalTimer) {
			return;
		}

		this.scanIntervalTimer = setInterval(async () => {
			try {
				await this.incrementalScan();
			} catch (err) {
				log.error("Error during periodic scan:", err);
			}
		}, this.options.scanIntervalMs);

		// Unref the timer so it doesn't keep the process alive
		if ("unref" in this.scanIntervalTimer) {
			(this.scanIntervalTimer as NodeJS.Timeout).unref();
		}

		log.info(
			`Periodic scanning started (interval: ${this.options.scanIntervalMs}ms)`,
		);
	}

	/**
	 * Process a single modified file
	 */
	private async processModifiedFile(filePath: string): Promise<void> {
		const metadata = await getFileMetadata(filePath);

		if (!metadata) {
			// File was deleted, remove its entries
			await this.repository.deleteEntriesFromFile(filePath);
			this.processedFiles.delete(filePath);
			return;
		}

		// Trigger incremental scan for this file
		const tempProcessed = new Map(this.processedFiles);
		tempProcessed.delete(filePath); // Force re-scan of this file

		const result = await scanModifiedFiles(tempProcessed);

		if (result.entries.length > 0) {
			await this.repository.saveEntries(result.entries);
		}

		await this.updateProcessedFilesFromScan(result);
	}

	/**
	 * Update processed files tracking from scan result
	 */
	private async updateProcessedFilesFromScan(result: ScanResult): Promise<void> {
		// Group entries by file to get line counts
		const fileEntries = new Map<string, number>();
		for (const entry of result.entries) {
			const count = fileEntries.get(entry.filePath) || 0;
			fileEntries.set(entry.filePath, count + 1);
		}

		// Update tracking for processed files
		for (const [filePath, entryCount] of fileEntries) {
			const metadata = await getFileMetadata(filePath);
			if (metadata) {
				const existing = this.processedFiles.get(filePath);
				const processedFile: ProcessedFile = {
					filePath,
					lastModifiedAt: metadata.modifiedAt,
					lastSize: metadata.size,
					lastLineCount: (existing?.lastLineCount || 0) + entryCount,
					processedAt: Date.now(),
				};

				this.processedFiles.set(filePath, processedFile);
				await this.repository.markFileProcessed(processedFile);
			}
		}
	}
}
