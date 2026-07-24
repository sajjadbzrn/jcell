// Core
export { createDB, DB, createMigration } from './db'
export { schema, t } from './schema'
export { Collection, QueryBuilder, FieldFilter } from './query-engine'
export type { CollectionResolver } from './query-engine'
export type { FieldDef, SchemaInstance, InferSchema, Field } from './schema'
export type {
  StorageAdapter,
  Document,
  DocWithId,
  DBConfig,
  FilterClause,
  FilterOp,
  QueryParams,
  OrderByClause,
  SortDirection,
  AggregateStage,
  IndexOptions,
  HookEvent,
  HookMap,
  TransactionDB,
  Migration,
  MigrationRecord,
  BeforeInsertHook,
  AfterInsertHook,
  BeforeUpdateHook,
  AfterUpdateHook,
  BeforeDeleteHook,
  AfterDeleteHook,
} from './types'

// File adapter (Node.js / Bun — file system persistence)
export { fileAdapter } from './adapters/file'
export type { FileAdapterConfig } from './adapters/file'

// Memory adapter (any runtime — ephemeral in-memory storage)
export { memoryAdapter } from './adapters/memory'

// D1 adapter (Cloudflare Workers — SQLite edge database)
export { d1Adapter } from './adapters/d1'
export type { D1AdapterConfig } from './types'

// Custom error classes
export { JcellError, ValidationError, DuplicateError, NotFoundError } from './errors'
