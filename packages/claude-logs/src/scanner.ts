import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Logger } from "@better-ccflare/logger";
import { getClaudeConfigDirs, getProjectsDir, extractProjectPath } from "./paths";
import { parseJSONLContent, parseJSONLContentFromLine } from "./parser";
import type { ParsedLogEntry, ProcessedFile, ScanError, ScanResult } from "./types";

const log = new Logger("ClaudeLogScanner");

/**
 * Recursively find all .jsonl files in a directory
 */
async function findJSONLFiles(dir: string): Promise<string[]> {
	const files: string[] = [];

	try {
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				// Recursively scan subdirectories
				const subFiles = await findJSONLFiles(fullPath);
				files.push(...subFiles);
			} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				files.push(fullPath);
			}
		}
	} catch (err) {
		// Directory might not exist or be inaccessible
		log.debug(`Could not read directory ${dir}: ${err}`);
	}

	return files;
}

/**
 * Scan all Claude config directories for JSONL files
 *
 * @returns ScanResult with all parsed entries
 */
export async function scanAllJSONLFiles(): Promise<ScanResult> {
	const configDirs = getClaudeConfigDirs();
	const entries: ParsedLogEntry[] = [];
	const errors: ScanError[] = [];
	let filesProcessed = 0;
	let filesSkipped = 0;

	if (configDirs.length === 0) {
		log.warn("No Claude config directories found");
		return {
			entries: [],
			filesProcessed: 0,
			filesSkipped: 0,
			entriesFound: 0,
			errors: [],
			configDirsUsed: [],
		};
	}

	log.info(`Scanning ${configDirs.length} config directories: ${configDirs.join(", ")}`);

	for (const configDir of configDirs) {
		const projectsDir = getProjectsDir(configDir);

		try {
			const jsonlFiles = await findJSONLFiles(projectsDir);
			log.info(`Found ${jsonlFiles.length} JSONL files in ${projectsDir}`);

			for (const filePath of jsonlFiles) {
				try {
					const fileStat = await stat(filePath);
					const content = await readFile(filePath, "utf-8");
					const projectPath = extractProjectPath(filePath, configDirs);

					const result = parseJSONLContent(
						content,
						filePath,
						projectPath,
						fileStat.mtimeMs,
					);

					entries.push(...result.entries);
					errors.push(...result.errors);
					filesProcessed++;

					if (result.entries.length > 0) {
						log.debug(
							`Parsed ${result.entries.length} entries from ${filePath}`,
						);
					}
				} catch (err) {
					errors.push({
						filePath,
						error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
					});
					filesSkipped++;
				}
			}
		} catch (err) {
			log.warn(`Could not scan ${projectsDir}: ${err}`);
		}
	}

	log.info(
		`Scan complete: ${filesProcessed} files processed, ${entries.length} entries found, ${errors.length} errors`,
	);

	return {
		entries,
		filesProcessed,
		filesSkipped,
		entriesFound: entries.length,
		errors,
		configDirsUsed: configDirs,
	};
}

/**
 * Scan only modified files since last processing
 *
 * @param processedFiles - Map of file path to ProcessedFile metadata
 * @returns ScanResult with only new/modified entries
 */
export async function scanModifiedFiles(
	processedFiles: Map<string, ProcessedFile>,
): Promise<ScanResult> {
	const configDirs = getClaudeConfigDirs();
	const entries: ParsedLogEntry[] = [];
	const errors: ScanError[] = [];
	let filesProcessed = 0;
	let filesSkipped = 0;

	if (configDirs.length === 0) {
		return {
			entries: [],
			filesProcessed: 0,
			filesSkipped: 0,
			entriesFound: 0,
			errors: [],
			configDirsUsed: [],
		};
	}

	for (const configDir of configDirs) {
		const projectsDir = getProjectsDir(configDir);

		try {
			const jsonlFiles = await findJSONLFiles(projectsDir);

			for (const filePath of jsonlFiles) {
				try {
					const fileStat = await stat(filePath);
					const processed = processedFiles.get(filePath);

					// Skip if file hasn't changed
					if (
						processed &&
						processed.lastModifiedAt >= fileStat.mtimeMs &&
						processed.lastSize === fileStat.size
					) {
						filesSkipped++;
						continue;
					}

					const content = await readFile(filePath, "utf-8");
					const projectPath = extractProjectPath(filePath, configDirs);

					// If we have processed this file before, only parse new lines
					if (processed && processed.lastLineCount > 0) {
						const result = parseJSONLContentFromLine(
							content,
							filePath,
							projectPath,
							fileStat.mtimeMs,
							processed.lastLineCount,
						);

						entries.push(...result.entries);
						errors.push(...result.errors);
					} else {
						// Full parse for new files
						const result = parseJSONLContent(
							content,
							filePath,
							projectPath,
							fileStat.mtimeMs,
						);

						entries.push(...result.entries);
						errors.push(...result.errors);
					}

					filesProcessed++;
				} catch (err) {
					errors.push({
						filePath,
						error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
					});
					filesSkipped++;
				}
			}
		} catch (err) {
			log.warn(`Could not scan ${projectsDir}: ${err}`);
		}
	}

	return {
		entries,
		filesProcessed,
		filesSkipped,
		entriesFound: entries.length,
		errors,
		configDirsUsed: configDirs,
	};
}

/**
 * Get file metadata for tracking
 */
export async function getFileMetadata(
	filePath: string,
): Promise<{ modifiedAt: number; size: number } | null> {
	try {
		const fileStat = await stat(filePath);
		return {
			modifiedAt: fileStat.mtimeMs,
			size: fileStat.size,
		};
	} catch {
		return null;
	}
}
