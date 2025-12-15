import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

/**
 * Get Claude config directories to scan for log files
 *
 * Priority:
 * 1. CLAUDE_CONFIG_DIR env var (comma-separated for multiple paths)
 * 2. ~/.claude (legacy path)
 * 3. ~/.config/claude (XDG-compliant path)
 *
 * @returns Array of existing config directory paths
 */
export function getClaudeConfigDirs(): string[] {
	const dirs: string[] = [];

	// 1. Check env var first (supports comma-separated paths for Docker mounts)
	const envDirs = process.env.CLAUDE_CONFIG_DIR;
	if (envDirs) {
		const paths = envDirs.split(",").map((p) => p.trim());
		for (const p of paths) {
			if (p && existsSync(p)) {
				dirs.push(p);
			}
		}
	}

	// 2. Check legacy path (~/.claude)
	const legacyPath = join(homedir(), ".claude");
	if (existsSync(legacyPath) && !dirs.includes(legacyPath)) {
		dirs.push(legacyPath);
	}

	// 3. Check XDG path (~/.config/claude)
	const xdgPath = join(homedir(), ".config", "claude");
	if (existsSync(xdgPath) && !dirs.includes(xdgPath)) {
		dirs.push(xdgPath);
	}

	return dirs;
}

/**
 * Get the projects subdirectory for a config dir
 * @param configDir - The base config directory
 * @returns Path to the projects directory
 */
export function getProjectsDir(configDir: string): string {
	return join(configDir, "projects");
}

/**
 * Extract project path from a JSONL file path
 *
 * Given: /home/user/.claude/projects/my-project/session-123.jsonl
 * Returns: my-project
 *
 * @param filePath - Full path to the JSONL file
 * @param configDirs - List of config directories to check against
 * @returns The project name/path or "unknown" if not determinable
 */
export function extractProjectPath(
	filePath: string,
	configDirs: string[],
): string {
	for (const configDir of configDirs) {
		const projectsDir = getProjectsDir(configDir);
		if (filePath.startsWith(projectsDir)) {
			// Remove the projects dir prefix and split
			const relativePath = filePath.substring(projectsDir.length + 1);
			const parts = relativePath.split("/");
			// The project path is everything except the last part (filename)
			if (parts.length > 1) {
				return parts.slice(0, -1).join("/");
			}
		}
	}
	return "unknown";
}
