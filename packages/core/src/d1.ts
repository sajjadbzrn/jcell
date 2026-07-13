// Cloudflare Workers entrypoint — only imports the D1 adapter (no node:fs)
export { createDB, DB, createMigration } from './db'
export { schema, t } from './schema'
export { Collection, QueryBuilder, FieldFilter } from './query-engine'
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
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1AdapterConfig,
} from './types'

export { d1Adapter } from './adapters/d1'
export { memoryAdapter } from './adapters/memory'
