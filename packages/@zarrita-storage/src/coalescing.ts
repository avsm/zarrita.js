import type {
	AbsolutePath,
	AsyncReadable,
	OnBytes,
	RangeQuery,
} from "./types.js";

interface PendingRange {
	offset: number;
	length: number;
	resolve: (data: Uint8Array | undefined) => void;
	reject: (err: unknown) => void;
	onBytes?: OnBytes;
}

/**
 * A store wrapper that coalesces multiple `getRange` calls to the same key
 * within a single microtask into fewer HTTP requests by merging nearby byte
 * ranges.
 *
 * This dramatically reduces the number of HTTP round-trips when reading
 * multiple chunks from the same shard in zarr v3 sharded arrays.
 *
 * ```typescript
 * import { FetchStore, CoalescingStore } from "@zarrita/storage";
 * const raw = new FetchStore("https://example.com/data.zarr");
 * const store = new CoalescingStore(raw, { maxGap: 65536 });
 * ```
 */
class CoalescingStore<Options = unknown>
	implements AsyncReadable<Options>
{
	#inner: AsyncReadable<Options>;
	#maxGap: number;
	#pending = new Map<AbsolutePath, PendingRange[]>();
	#scheduled = false;

	constructor(
		inner: AsyncReadable<Options>,
		options: { maxGap?: number } = {},
	) {
		this.#inner = inner;
		this.#maxGap = options.maxGap ?? 65536; // 64KB default gap threshold
	}

	async get(
		key: AbsolutePath,
		opts?: Options & { onBytes?: OnBytes },
	): Promise<Uint8Array | undefined> {
		return this.#inner.get(key, opts);
	}

	async getRange(
		key: AbsolutePath,
		range: RangeQuery,
		opts?: Options & { onBytes?: OnBytes },
	): Promise<Uint8Array | undefined> {
		// Suffix requests can't be coalesced — pass through directly
		if ("suffixLength" in range) {
			if (!this.#inner.getRange) {
				throw new Error("Inner store does not support getRange");
			}
			return this.#inner.getRange(key, range, opts);
		}

		// Queue this range request for coalescing
		return new Promise<Uint8Array | undefined>((resolve, reject) => {
			let pending = this.#pending.get(key);
			if (!pending) {
				pending = [];
				this.#pending.set(key, pending);
			}
			pending.push({
				offset: range.offset,
				length: range.length,
				resolve,
				reject,
				onBytes: opts && "onBytes" in opts ? (opts as { onBytes?: OnBytes }).onBytes : undefined,
			});

			if (!this.#scheduled) {
				this.#scheduled = true;
				// Flush on next microtask — all getRange calls within the same
				// synchronous block (or promise continuation) will be batched.
				Promise.resolve().then(() => this.#flush(opts));
			}
		});
	}

	async #flush(opts?: Options & { onBytes?: OnBytes }): Promise<void> {
		this.#scheduled = false;
		const snapshot = new Map(this.#pending);
		this.#pending.clear();

		for (const [key, ranges] of snapshot) {
			this.#fetchMerged(key, ranges, opts).catch(() => {
				// Individual promises are already rejected in fetchMerged
			});
		}
	}

	async #fetchMerged(
		key: AbsolutePath,
		ranges: PendingRange[],
		opts?: Options & { onBytes?: OnBytes },
	): Promise<void> {
		if (!this.#inner.getRange) {
			for (const r of ranges) {
				r.reject(new Error("Inner store does not support getRange"));
			}
			return;
		}

		// Single request — no need to merge
		if (ranges.length === 1) {
			try {
				const result = await this.#inner.getRange(
					key,
					{ offset: ranges[0].offset, length: ranges[0].length },
					ranges[0].onBytes
						? { ...opts, onBytes: ranges[0].onBytes } as Options & { onBytes?: OnBytes }
						: opts,
				);
				ranges[0].resolve(result);
			} catch (err) {
				ranges[0].reject(err);
			}
			return;
		}

		// Sort by offset
		ranges.sort((a, b) => a.offset - b.offset);

		// Merge nearby ranges into groups
		const groups: { start: number; end: number; members: PendingRange[] }[] = [];
		let current = {
			start: ranges[0].offset,
			end: ranges[0].offset + ranges[0].length,
			members: [ranges[0]],
		};

		for (let i = 1; i < ranges.length; i++) {
			const r = ranges[i];
			const rEnd = r.offset + r.length;
			if (r.offset <= current.end + this.#maxGap) {
				// Merge: extend the current group
				current.end = Math.max(current.end, rEnd);
				current.members.push(r);
			} else {
				// Gap too large: start a new group
				groups.push(current);
				current = { start: r.offset, end: rEnd, members: [r] };
			}
		}
		groups.push(current);

		// Fetch each merged group
		const fetches = groups.map(async (group) => {
			const mergedOffset = group.start;
			const mergedLength = group.end - group.start;

			// Aggregate onBytes callbacks for progress reporting
			const byteCallbacks = group.members
				.map((m) => m.onBytes)
				.filter((cb): cb is OnBytes => cb != null);
			const onBytes: OnBytes | undefined =
				byteCallbacks.length > 0
					? (delta) => {
							// Distribute bytes proportionally across members
							const totalBytes = group.members.reduce(
								(s, m) => s + m.length,
								0,
							);
							for (const m of group.members) {
								const cb = m.onBytes;
								if (cb) {
									cb(Math.round((delta * m.length) / totalBytes));
								}
							}
						}
					: undefined;

			try {
				const merged = await this.#inner.getRange!(
					key,
					{ offset: mergedOffset, length: mergedLength },
					onBytes
						? { ...opts, onBytes } as Options & { onBytes?: OnBytes }
						: opts,
				);

				// Slice the merged result for each member
				for (const m of group.members) {
					if (!merged) {
						m.resolve(undefined);
					} else {
						const localOffset = m.offset - mergedOffset;
						m.resolve(merged.slice(localOffset, localOffset + m.length));
					}
				}
			} catch (err) {
				for (const m of group.members) {
					m.reject(err);
				}
			}
		});

		await Promise.all(fetches);
	}
}

export default CoalescingStore;
