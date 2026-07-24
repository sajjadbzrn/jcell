/**
 * Storage adapter interface.
 * Core has no I/O of its own — all persistence goes through this interface.
 *
 * Adapters can implement two levels:
 * 1. **Basic** (file, memory): `read` + `write` + `exists`. The Collection
 *    loads everything into memory and filters in JS.
 * 2. **Pro** (D1, SQL): also implements the optional `query`, `insertOne`,
 *    `updateMany`, `deleteMany`, `count`, etc. The Collection delegates
 *    filtering and aggregation to the adapter for efficiency.
 */
export interface StorageAdapter {
  // -----------------------------------------------------------------------
  // Basic (required) — used by Cache-strategy adapters
  // -----------------------------------------------------------------------

  /** Read all documents from a collection. Returns null if collection doesn't exist. */
  read(collection: string): Promise<string | null>
  /** Write all documents to a collection (full replacement). */
  write(collection: string, data: string): Promise<void>
  /** Check if a collection exists. */
  exists(collection: string): Promise<boolean>
  /** Delete an entire collection. */
  delete?(collection: string): Promise<void>

  // -----------------------------------------------------------------------
  // Pro (optional) — enables Delegate strategy. If `query` exists, the
  // Collection skips the in-memory cache and delegates everything.
  // -----------------------------------------------------------------------

  /** Execute a query and return matching documents. */
  query?(collection: string, params: QueryParams): Promise<Record<string, unknown>[]>

  /** Insert one document. Returns the inserted document with id. */
  insertOne?(collection: string, doc: Record<string, unknown>): Promise<Record<string, unknown>>

  /** Update documents matching a filter. Returns count of updated docs. */
  updateMany?(collection: string, filter: FilterClause[], changes: Record<string, unknown>): Promise<number>

  /** Delete documents matching a filter. Returns count of deleted docs. */
  deleteMany?(collection: string, filter: FilterClause[]): Promise<number>

  /** Count documents matching an optional filter. */
  count?(collection: string, filter?: FilterClause[]): Promise<number>

  /** Run an aggregation pipeline. */
  aggregate?(collection: string, pipeline: AggregateStage[]): Promise<unknown>

  // -----------------------------------------------------------------------
  // Schema & index management (optional)
  // -----------------------------------------------------------------------

  /** Create or ensure the collection's backing store exists with the given schema. */
  ensureCollection?(name: string, fields: Record<string, import('./schema.js').FieldDef>): Promise<void>

  /** Create an index on a field. */
  createIndex?(collection: string, field: string, options?: IndexOptions): Promise<void>

  /** Drop an index on a field. */
  dropIndex?(collection: string, field: string): Promise<void>

  // -----------------------------------------------------------------------
  // Transaction support (optional)
  // -----------------------------------------------------------------------

  /** Run a function within a transaction. The adapter passed to fn is a
   *  transaction-scoped instance. */
  transaction?<T>(fn: (adapter: StorageAdapter) => Promise<T>): Promise<T>

  // -----------------------------------------------------------------------
  // Lifecycle (optional)
  // -----------------------------------------------------------------------

  /** Initialize the adapter (e.g. open a DB connection). */
  connect?(): Promise<void>
  /** Tear down the adapter (e.g. close a DB connection). */
  disconnect?(): Promise<void>
}

// ---------------------------------------------------------------------------
// Query DSL types
// ---------------------------------------------------------------------------

/** A document is a record of string keys to unknown values. */
export type Document = Record<string, unknown>

/** A document with a required string `id` field. */
export type DocWithId = Document & { id: string }

/** Filter operator types for queries. */
export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'startsWith'

/** A single filter clause. */
export interface FilterClause {
  field: string
  op: FilterOp
  value: unknown
}

/** Parameters for a generic query. */
export interface QueryParams {
  filter?: FilterClause[]
  /** OR-grouped filters. When present, the query returns docs matching
   *  (all `filter` clauses AND) OR (any `orFilter` clause).
   *  If only `orFilter` is provided, it acts as a pure OR query. */
  orFilter?: FilterClause[]
  limit?: number
  offset?: number
  orderBy?: OrderByClause[]
  select?: string[]
}

/** Sort direction. */
export type SortDirection = 'asc' | 'desc'

/** A single sort clause. */
export interface OrderByClause {
  field: string
  direction: SortDirection
}

/** Index creation options. */
export interface IndexOptions {
  unique?: boolean
  name?: string
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Aggregation pipeline stage types. */
export type AggregateStage =
  | { $match: Record<string, unknown> }
  | { $group: Record<string, unknown> }
  | { $sort: Record<string, 1 | -1> }
  | { $limit: number }
  | { $skip: number }
  | { $count: string }

// ---------------------------------------------------------------------------
// Hooks / Middleware
// ---------------------------------------------------------------------------

/** Hook event types. */
export type HookEvent =
  | 'before:insert'
  | 'after:insert'
  | 'before:update'
  | 'after:update'
  | 'before:delete'
  | 'after:delete'

/** Hook handler signatures. */
export type BeforeInsertHook<T extends DocWithId = DocWithId> = (doc: T) => Promise<void> | void
export type AfterInsertHook<T extends DocWithId = DocWithId> = (doc: T) => Promise<void> | void
export type BeforeUpdateHook<T extends DocWithId = DocWithId> = (filter: Partial<T>, changes: Partial<T>) => Promise<void> | void
export type AfterUpdateHook<T extends DocWithId = DocWithId> = (filter: Partial<T>, changes: Partial<T>, count: number) => Promise<void> | void
export type BeforeDeleteHook<T extends DocWithId = DocWithId> = (filter: Partial<T>) => Promise<void> | void
export type AfterDeleteHook<T extends DocWithId = DocWithId> = (filter: Partial<T>, count: number) => Promise<void> | void

/** Map of hook events to their handler arrays. */
export interface HookMap<T extends DocWithId = DocWithId> {
  'before:insert'?: BeforeInsertHook<T>[]
  'after:insert'?: AfterInsertHook<T>[]
  'before:update'?: BeforeUpdateHook<T>[]
  'after:update'?: AfterUpdateHook<T>[]
  'before:delete'?: BeforeDeleteHook<T>[]
  'after:delete'?: AfterDeleteHook<T>[]
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/** A transaction-scoped database that shares the same atomic scope. */
export interface TransactionDB {
  collection<T extends DocWithId>(name: string, schema: import('./schema.js').SchemaInstance<T>): import('./query-engine.js').Collection<T>
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/** A single migration: up for applying, down for rolling back. */
export interface Migration {
  up(db: import('./db.js').DB): Promise<void>
  down?(db: import('./db.js').DB): Promise<void>
}

/** Migration record stored in the _migrations collection. */
export interface MigrationRecord {
  id: string
  name: string
  appliedAt: string
}

/** Configuration for createDB. */
export interface DBConfig {
  adapter: StorageAdapter
}

// ---------------------------------------------------------------------------
// D1-specific types (for the D1 adapter)
// ---------------------------------------------------------------------------

/** Minimal D1 database interface — compatible with Cloudflare's D1 binding. */
export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>
  exec(query: string): Promise<D1Result>
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>
}

export interface D1Result<T = Record<string, unknown>> {
  results?: T[]
  success: boolean
  error?: string
  meta?: Record<string, unknown>
  /** For raw queries that return primitive values */
  rows?: unknown[][]
  columns?: string[]
}

/** Configuration for the D1 adapter. */
export interface D1AdapterConfig {
  /** A Cloudflare D1 database binding. */
  binding: D1Database
  /** Optional table name prefix (e.g. "jcell_" → table "jcell_users"). */
  tablePrefix?: string
}
