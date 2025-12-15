import { watch, type FSWatcher } from "node:fs";
import { Logger } from "@better-ccflare/logger";
import { getClaudeConfigDirs, getProjectsDir } from "./paths";
import type { FileWatchEvent, FileWatchEventData } from "./types";

const log = new Logger("ClaudeLogWatcher");

// Debounce delay for rapid file events
const DEBOUNCE_MS = 500;

type WatcherCallback = (event: FileWatchEventData) => void;

/**
 * File watcher for Claude log directories
 *
 * Watches for .jsonl file changes in Claude config directories
 * and emits debounced events.
 */
export class ClaudeLogWatcher {
	private watchers: FSWatcher[] = [];
	private callbacks: WatcherCallback[] = [];
	private debounceTimers: Map<string, Timer> = new Map();
	private isWatching = false;

	/**
	 * Add a callback for file events
	 */
	onFileChange(callback: WatcherCallback): void {
		this.callbacks.push(callback);
	}

	/**
	 * Start watching Claude config directories
	 */
	start(): void {
		if (this.isWatching) {
			return;
		}

		const configDirs = getClaudeConfigDirs();

		if (configDirs.length === 0) {
			log.warn("No Claude config directories found to watch");
			return;
		}

		for (const configDir of configDirs) {
			const projectsDir = getProjectsDir(configDir);

			try {
				const watcher = watch(
					projectsDir,
					{ recursive: true },
					(eventType, filename) => {
						if (!filename || !filename.endsWith(".jsonl")) {
							return;
						}

						const filePath = `${projectsDir}/${filename}`;
						this.handleFileEvent(eventType as "rename" | "change", filePath);
					},
				);

				watcher.on("error", (err) => {
					log.error(`Watcher error for ${projectsDir}:`, err);
				});

				this.watchers.push(watcher);
				log.info(`Watching for changes in ${projectsDir}`);
			} catch (err) {
				log.warn(`Could not watch ${projectsDir}: ${err}`);
			}
		}

		this.isWatching = true;
	}

	/**
	 * Stop watching all directories
	 */
	stop(): void {
		for (const watcher of this.watchers) {
			watcher.close();
		}
		this.watchers = [];

		// Clear all debounce timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();

		this.isWatching = false;
		log.info("Stopped watching Claude log directories");
	}

	/**
	 * Check if currently watching
	 */
	get watching(): boolean {
		return this.isWatching;
	}

	/**
	 * Handle raw file events with debouncing
	 */
	private handleFileEvent(
		eventType: "rename" | "change",
		filePath: string,
	): void {
		// Clear existing timer for this file
		const existingTimer = this.debounceTimers.get(filePath);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// Set new debounced timer
		const timer = setTimeout(() => {
			this.debounceTimers.delete(filePath);
			this.emitEvent(eventType, filePath);
		}, DEBOUNCE_MS);

		this.debounceTimers.set(filePath, timer);
	}

	/**
	 * Emit debounced event to all callbacks
	 */
	private emitEvent(eventType: "rename" | "change", filePath: string): void {
		// Map fs.watch event types to our event types
		let type: FileWatchEvent;

		if (eventType === "rename") {
			// "rename" can mean created or deleted - we'd need to check if file exists
			// For simplicity, treat as modified and let the scanner handle it
			type = "modified";
		} else {
			type = "modified";
		}

		const eventData: FileWatchEventData = {
			type,
			filePath,
			timestamp: Date.now(),
		};

		log.debug(`File ${type}: ${filePath}`);

		for (const callback of this.callbacks) {
			try {
				callback(eventData);
			} catch (err) {
				log.error("Error in watcher callback:", err);
			}
		}
	}
}
