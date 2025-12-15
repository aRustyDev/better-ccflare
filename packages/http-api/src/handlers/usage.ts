import type { ClaudeLogsRepository } from "@better-ccflare/database";
import { jsonResponse } from "@better-ccflare/http-common";
import type { UsageApiResponse, ScanResultResponse } from "@better-ccflare/types";
import type { ClaudeLogsService } from "@better-ccflare/claude-logs";

/**
 * Create a handler for daily usage aggregation
 * GET /api/usage/daily?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&project=path
 */
export function createDailyUsageHandler(claudeLogsRepo: ClaudeLogsRepository) {
	return (url: URL): Response => {
		const startDate = url.searchParams.get("startDate") || undefined;
		const endDate = url.searchParams.get("endDate") || undefined;
		const project = url.searchParams.get("project") || undefined;

		const data = claudeLogsRepo.getDailyUsage(startDate, endDate, project);

		const response: UsageApiResponse<typeof data> = {
			success: true,
			data,
			meta: {
				generatedAt: new Date().toISOString(),
				configDirs: [],
			},
		};

		return jsonResponse(response);
	};
}

/**
 * Create a handler for monthly usage aggregation
 * GET /api/usage/monthly?startMonth=YYYY-MM&endMonth=YYYY-MM
 */
export function createMonthlyUsageHandler(claudeLogsRepo: ClaudeLogsRepository) {
	return (url: URL): Response => {
		const startMonth = url.searchParams.get("startMonth") || undefined;
		const endMonth = url.searchParams.get("endMonth") || undefined;

		const data = claudeLogsRepo.getMonthlyUsage(startMonth, endMonth);

		const response: UsageApiResponse<typeof data> = {
			success: true,
			data,
			meta: {
				generatedAt: new Date().toISOString(),
				configDirs: [],
			},
		};

		return jsonResponse(response);
	};
}

/**
 * Create a handler for session-based usage
 * GET /api/usage/sessions?limit=50&offset=0&project=path
 */
export function createSessionUsageHandler(claudeLogsRepo: ClaudeLogsRepository) {
	return (url: URL): Response => {
		const limit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
		const offset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
		const project = url.searchParams.get("project") || undefined;

		const { sessions, totalCount } = claudeLogsRepo.getSessionUsage(
			limit,
			offset,
			project,
		);

		const response: UsageApiResponse<typeof sessions> = {
			success: true,
			data: sessions,
			pagination: {
				page: Math.floor(offset / limit) + 1,
				pageSize: limit,
				totalCount,
				totalPages: Math.ceil(totalCount / limit),
			},
			meta: {
				generatedAt: new Date().toISOString(),
				configDirs: [],
			},
		};

		return jsonResponse(response);
	};
}

/**
 * Create a handler for 5-hour billing block usage
 * GET /api/usage/blocks?startTime=timestamp&endTime=timestamp
 */
export function createBillingBlocksHandler(claudeLogsRepo: ClaudeLogsRepository) {
	return (url: URL): Response => {
		const startTimeParam = url.searchParams.get("startTime");
		const endTimeParam = url.searchParams.get("endTime");

		const startTime = startTimeParam
			? Number.parseInt(startTimeParam, 10)
			: undefined;
		const endTime = endTimeParam
			? Number.parseInt(endTimeParam, 10)
			: undefined;

		const data = claudeLogsRepo.getBillingBlockUsage(startTime, endTime);

		const response: UsageApiResponse<typeof data> = {
			success: true,
			data,
			meta: {
				generatedAt: new Date().toISOString(),
				configDirs: [],
			},
		};

		return jsonResponse(response);
	};
}

/**
 * Create a handler for listing projects
 * GET /api/usage/projects
 */
export function createProjectsListHandler(claudeLogsRepo: ClaudeLogsRepository) {
	return (): Response => {
		const data = claudeLogsRepo.getProjects();

		const response: UsageApiResponse<typeof data> = {
			success: true,
			data,
			meta: {
				generatedAt: new Date().toISOString(),
				configDirs: [],
			},
		};

		return jsonResponse(response);
	};
}

/**
 * Create a handler for triggering a manual scan
 * POST /api/usage/scan
 */
export function createScanHandler(claudeLogsService: ClaudeLogsService) {
	return async (): Promise<Response> => {
		const result = await claudeLogsService.scanAndImport();

		const response: UsageApiResponse<ScanResultResponse> = {
			success: true,
			data: {
				filesProcessed: result.filesProcessed,
				filesSkipped: result.filesSkipped,
				entriesFound: result.entriesFound,
				errors: result.errors,
				configDirsUsed: result.configDirsUsed,
			},
			meta: {
				generatedAt: new Date().toISOString(),
				configDirs: result.configDirsUsed,
			},
		};

		return jsonResponse(response);
	};
}

/**
 * Create a handler for getting usage summary/overview
 * GET /api/usage/summary
 */
export function createUsageSummaryHandler(claudeLogsRepo: ClaudeLogsRepository) {
	return (): Response => {
		const totalEntries = claudeLogsRepo.getTotalEntryCount();
		const totalCost = claudeLogsRepo.getTotalCost();
		const projects = claudeLogsRepo.getProjects();

		const response: UsageApiResponse<{
			totalEntries: number;
			totalCost: number;
			projectCount: number;
			projects: typeof projects;
		}> = {
			success: true,
			data: {
				totalEntries,
				totalCost,
				projectCount: projects.length,
				projects,
			},
			meta: {
				generatedAt: new Date().toISOString(),
				configDirs: [],
			},
		};

		return jsonResponse(response);
	};
}
