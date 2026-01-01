import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("APIRouter route registration", () => {
	it("should register GET /api/system/package-manager route", () => {
		// Read the router source to verify route is registered
		const routerSource = readFileSync(join(__dirname, "router.ts"), "utf-8");
		expect(routerSource).toContain("GET:/api/system/package-manager");
	});
});
