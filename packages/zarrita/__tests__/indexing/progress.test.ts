import * as path from "node:path";
import * as url from "node:url";
import FileSystemStore from "@zarrita/storage/fs";
import { describe, expect, it } from "vitest";

import * as zarr from "../../src/index.js";
import type { ProgressEvent } from "../../src/indexing/types.js";

let __dirname = path.dirname(url.fileURLToPath(import.meta.url));

describe("progress callbacks", () => {
	it("reports chunk progress for a chunked v3 array", async () => {
		let root = path.resolve(__dirname, "../../../../fixtures/v3/data.zarr");
		let store = zarr.root(new FileSystemStore(root));
		let arr = await zarr.open(store.resolve("/1d.chunked.i2"), {
			kind: "array",
		});

		let events: ProgressEvent[] = [];
		let result = await zarr.get(arr, null, {
			onProgress: (event) => events.push({ ...event }),
		});

		expect(events.length).toBeGreaterThan(0);

		let last = events[events.length - 1];
		expect(last.chunks_completed).toBe(last.chunks_total);
		expect(last.chunks_total).toBeGreaterThan(0);

		expect(result.data).toMatchInlineSnapshot(`
			Int16Array [
			  1,
			  2,
			  3,
			  4,
			]
		`);
	});

	it("reports chunks_total matching number of chunks", async () => {
		let root = path.resolve(__dirname, "../../../../fixtures/v3/data.zarr");
		let store = zarr.root(new FileSystemStore(root));
		let arr = await zarr.open(store.resolve("/1d.chunked.i2"), {
			kind: "array",
		});

		let events: ProgressEvent[] = [];
		await zarr.get(arr, null, {
			onProgress: (event) => events.push({ ...event }),
		});

		let last = events[events.length - 1];
		// 1d.chunked.i2: shape [4], chunk_shape [2] => 2 chunks
		expect(last.chunks_total).toBe(2);
		expect(last.chunks_completed).toBe(2);
	});

	it("does not fire progress when no callback provided", async () => {
		let root = path.resolve(__dirname, "../../../../fixtures/v3/data.zarr");
		let store = zarr.root(new FileSystemStore(root));
		let arr = await zarr.open(store.resolve("/1d.chunked.i2"), {
			kind: "array",
		});

		let result = await zarr.get(arr, null);
		expect(result.data).toMatchInlineSnapshot(`
			Int16Array [
			  1,
			  2,
			  3,
			  4,
			]
		`);
	});

	it("reports contiguous array as single chunk", async () => {
		let root = path.resolve(__dirname, "../../../../fixtures/v3/data.zarr");
		let store = zarr.root(new FileSystemStore(root));
		let arr = await zarr.open(store.resolve("/1d.contiguous.raw.i2"), {
			kind: "array",
		});

		let events: ProgressEvent[] = [];
		await zarr.get(arr, null, {
			onProgress: (event) => events.push({ ...event }),
		});

		let last = events[events.length - 1];
		expect(last.chunks_total).toBe(1);
		expect(last.chunks_completed).toBe(1);
	});
});
