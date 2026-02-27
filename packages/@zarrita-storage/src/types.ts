export type AbsolutePath<Rest extends string = string> = `/${Rest}`;

export type RangeQuery =
	| {
			offset: number;
			length: number;
	  }
	| {
			suffixLength: number;
	  };

export type OnBytes = (delta: number) => void;

export type Readable<GetOptions = unknown> =
	| AsyncReadable<GetOptions>
	| SyncReadable<GetOptions>;
export interface AsyncReadable<Options = unknown> {
	get(
		key: AbsolutePath,
		opts?: Options & { onBytes?: OnBytes },
	): Promise<Uint8Array | undefined>;
	getRange?(
		key: AbsolutePath,
		range: RangeQuery,
		opts?: Options & { onBytes?: OnBytes },
	): Promise<Uint8Array | undefined>;
}
export interface SyncReadable<Options = unknown> {
	get(
		key: AbsolutePath,
		opts?: Options & { onBytes?: OnBytes },
	): Uint8Array | undefined;
	getRange?(
		key: AbsolutePath,
		range: RangeQuery,
		opts?: Options & { onBytes?: OnBytes },
	): Uint8Array | undefined;
}

export type Writable = AsyncWritable | SyncWritable;
export interface AsyncWritable {
	set(key: AbsolutePath, value: Uint8Array): Promise<void>;
}
export interface SyncWritable {
	set(key: AbsolutePath, value: Uint8Array): void;
}

export type AsyncMutable<GetOptions = unknown> = AsyncReadable<GetOptions> &
	AsyncWritable;
export type SyncMutable<GetOptions = unknown> = SyncReadable<GetOptions> &
	SyncWritable;
export type Mutable<GetOptions = unknown> =
	| AsyncMutable<GetOptions>
	| SyncMutable<GetOptions>;
