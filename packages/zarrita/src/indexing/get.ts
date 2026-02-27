import type { OnBytes, Readable } from "@zarrita/storage";

import { type Array, get_context } from "../hierarchy.js";
import type { Chunk, DataType, Scalar, TypedArray } from "../metadata.js";
import { BasicIndexer } from "./indexer.js";
import type {
	GetOptions,
	Prepare,
	ProgressCallback,
	SetFromChunk,
	SetScalar,
	Slice,
} from "./types.js";
import { create_queue } from "./util.js";

function unwrap<D extends DataType>(
	arr: TypedArray<D>,
	idx: number,
): Scalar<D> {
	return ("get" in arr ? arr.get(idx) : arr[idx]) as Scalar<D>;
}

class ProgressTracker {
	#bytes_loaded = 0;
	#chunks_completed = 0;
	#chunks_total: number;
	#onProgress: ProgressCallback;

	constructor(chunks_total: number, onProgress: ProgressCallback) {
		this.#chunks_total = chunks_total;
		this.#onProgress = onProgress;
	}

	onBytes(): OnBytes {
		return (delta: number) => {
			this.#bytes_loaded += delta;
			this.#emit();
		};
	}

	chunkDone(): void {
		this.#chunks_completed++;
		this.#emit();
	}

	#emit(): void {
		this.#onProgress({
			bytes_loaded: this.#bytes_loaded,
			bytes_total: undefined,
			chunks_completed: this.#chunks_completed,
			chunks_total: this.#chunks_total,
		});
	}
}

export async function get<
	D extends DataType,
	Store extends Readable,
	Arr extends Chunk<D>,
	Sel extends (null | Slice | number)[],
>(
	arr: Array<D, Store>,
	selection: null | Sel,
	opts: GetOptions<Parameters<Store["get"]>[1]>,
	setter: {
		prepare: Prepare<D, Arr>;
		set_scalar: SetScalar<D, Arr>;
		set_from_chunk: SetFromChunk<D, Arr>;
	},
): Promise<
	null extends Sel[number] ? Arr : Slice extends Sel[number] ? Arr : Scalar<D>
> {
	let context = get_context(arr);
	let indexer = new BasicIndexer({
		selection,
		shape: arr.shape,
		chunk_shape: arr.chunks,
	});

	let out = setter.prepare(
		new context.TypedArray(indexer.shape.reduce((a, b) => a * b, 1)),
		indexer.shape,
		context.get_strides(indexer.shape),
	);

	let chunks = [...indexer];
	let tracker = opts.onProgress
		? new ProgressTracker(chunks.length, opts.onProgress)
		: undefined;

	let queue = opts.create_queue?.() ?? create_queue();
	for (const { chunk_coords, mapping } of chunks) {
		queue.add(async () => {
			let store_opts = tracker
				? { ...(opts.opts ?? {}), onBytes: tracker.onBytes() }
				: opts.opts;
			let { data, shape, stride } = await arr.getChunk(
				chunk_coords,
				store_opts,
			);
			let chunk = setter.prepare(data, shape, stride);
			setter.set_from_chunk(out, chunk, mapping);
			tracker?.chunkDone();
		});
	}

	await queue.onIdle();

	// @ts-expect-error - TS can't narrow this conditional type
	return indexer.shape.length === 0 ? unwrap(out.data, 0) : out;
}
