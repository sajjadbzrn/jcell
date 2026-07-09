// Core
export { createDB, DB } from './db'
export { schema, t } from './schema'
export { Collection, QueryBuilder, FieldFilter } from './query-engine'
export type { FieldDef, SchemaInstance, InferSchema, Field } from './schema'
export type { StorageAdapter, Document, DocWithId, DBConfig, FilterClause, FilterOp } from './types'

// File adapter (Node.js / Bun — file system persistence)
export { fileAdapter } from './adapters/file'
export type { FileAdapterConfig } from './adapters/file'

// Memory adapter (any runtime — ephemeral in-memory storage)
export { memoryAdapter } from './adapters/memory'
