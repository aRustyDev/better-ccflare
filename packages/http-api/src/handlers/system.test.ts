import { describe, expect, it } from "vitest";
import { createPackageManagerHandler } from "./system";

describe("createPackageManagerHandler", () => {
	it("should export createPackageManagerHandler function", () => {
		expect(typeof createPackageManagerHandler).toBe("function");
	});

	it("should return a handler function", () => {
		const handler = createPackageManagerHandler();
		expect(typeof handler).toBe("function");
	});

	it("should return Response object", async () => {
		const handler = createPackageManagerHandler();
		const response = await handler();
		expect(response).toBeInstanceOf(Response);
	});

	it("should return JSON with packageManager field", async () => {
		const handler = createPackageManagerHandler();
		const response = await handler();
		const data = await response.json();
		expect(data).toHaveProperty("packageManager");
	});

	it("should return JSON with isBinary field", async () => {
		const handler = createPackageManagerHandler();
		const response = await handler();
		const data = await response.json();
		expect(data).toHaveProperty("isBinary");
	});

	it("should return JSON with isDocker field", async () => {
		const handler = createPackageManagerHandler();
		const response = await handler();
		const data = await response.json();
		expect(data).toHaveProperty("isDocker");
	});

	it("should be usable as a route handler in router", async () => {
		// Verify handler signature matches what APIRouter expects
		const handler = createPackageManagerHandler();
		const response = await handler();
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
	});
});
