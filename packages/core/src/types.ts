/**
 * Storage adapter interface.
 * Core has no I/O of its own — all persistence goes through this interface.
 * Implementations exist for file system, in-memory, Cloudflare KV, etc.
 */
export interface StorageAdapter {
  /** Read all documents from a collection. Returns null if collection doesn't exist. */
  read(collection: string): Promise<string | null>
  /** Write all documents to a collection (full replacement). */
  write(collection: string, data: string): Promise<void>
  /** Check if a collection exists. */
  exists(collection: string): Promise<boolean>
  /** Delete an entire collection (optional — not all runtimes support it). */
  delete?(collection: string): Promise<void>
}

/** A document is a record of string keys to unknown values. */
export type Document = Record<string, unknown>

/** A document with a required string `id` field. */
export type DocWithId = Document & { id: string }

/** Filter operator types for queries. */
export type FilterOp = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'

/** A single filter clause. */
export interface FilterClause {
  field: string
  op: FilterOp
  value: unknown
}

/** Configuration for createDB. */
export interface DBConfig {
  adapter: StorageAdapter
}
