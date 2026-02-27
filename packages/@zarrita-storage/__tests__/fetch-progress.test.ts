import { afterEach, describe, expect, it, vi } from "vitest";
import FetchStore from "../src/fetch.js";

// `vitest --api` exposes port 51204
let href = "http://localhost:51204/fixtures/v3/data.zarr";

describe("FetchStore progress", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("calls onBytes during get()", async () => {
		let store = new FetchStore(href);
		let deltas: number[] = [];
		let bytes = await store.get("/zarr.json", {
			onBytes: (delta) => deltas.push(delta),
		});
		expect(bytes).toBeInstanceOf(Uint8Array);
		let total = deltas.reduce((a, b) => a + b, 0);
		expect(total).toBe(bytes!.byteLength);
		expect(deltas.length).toBeGreaterThan(0);
	});

	it("calls onBytes during getRange()", async () => {
		let store = new FetchStore(href);
		let deltas: number[] = [];
		let bytes = await store.getRange(
			"/zarr.json",
			{ offset: 0, length: 50 },
			{ onBytes: (delta) => deltas.push(delta) },
		);
		expect(bytes).toBeInstanceOf(Uint8Array);
		let total = deltas.reduce((a, b) => a + b, 0);
		expect(total).toBe(bytes!.byteLength);
	});

	it("works without onBytes (no regression)", async () => {
		let store = new FetchStore(href);
		let bytes = await store.get("/zarr.json");
		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(JSON.parse(new TextDecoder().decode(bytes))).toHaveProperty(
			"zarr_format",
			3,
		);
	});

	it("returns undefined for 404 even with onBytes", async () => {
		let store = new FetchStore(href);
		let deltas: number[] = [];
		let result = await store.get("/nonexistent", {
			onBytes: (delta) => deltas.push(delta),
		});
		expect(result).toBeUndefined();
		expect(deltas).toHaveLength(0);
	});
});
