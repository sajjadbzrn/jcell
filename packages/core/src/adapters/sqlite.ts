import type { StorageAdapter, FilterClause, QueryParams, AggregateStage } from '../types'
import type BetterSqlite3Type from 'better-sqlite3'
import type { FieldDef } from '../schema'
import { createRequire } from 'node:module'

// ---------------------------------------------------------------------------
// Lazy-loaded better-sqlite3 (keeps core package zero-dependency)
// ---------------------------------------------------------------------------

let BetterSqlite3: typeof BetterSqlite3Type | null = null

function loadBetterSqlite3(): typeof BetterSqlite3Type {
  if (!BetterSqlite3) {
    try {
      const localRequire = createRequire(import.meta.url)
      BetterSqlite3 = localRequire('better-sqlite3')
    } catch {
      throw new Error(
        'better-sqlite3 is required for the SQLite adapter. ' +
        'Install it with: npm install better-sqlite3',
      )
    }
  }
  // At this point BetterSqlite3 is guaranteed non-null
  return BetterSqlite3 as unknown as typeof BetterSqlite3Type
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SqliteAdapterConfig {
  /** Path to the SQLite database file. Defaults to `./data.db`. */
  path?: string
  /** Optional table name prefix (e.g. "jcell_" → table "jcell_users"). */
  tablePrefix?: string
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return value
}

function serializeDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    result[key] = serializeValue(value)
  }
  return result
}

// ---------------------------------------------------------------------------
// SQL generation helpers
// ---------------------------------------------------------------------------

function fieldSqlType(def: FieldDef): string {
  switch (def.type) {
    case 'id':
    case 'string':
    case 'ref':
    case 'enum':
      return 'TEXT'
    case 'number':
      return 'REAL'
    case 'boolean':
      return 'INTEGER'
    case 'date':
      return 'TEXT'
    case 'array':
    case 'object':
      return 'TEXT'
    default:
      return 'TEXT'
  }
}

function generateCreateTable(name: string, fields: Record<string, FieldDef>): string {
  const columns: string[] = []
  for (const [key, def] of Object.entries(fields)) {
    let col = '"' + key + '" ' + fieldSqlType(def)
    if (def.type === 'id') {
      col += ' PRIMARY KEY'
    } else if (!def.optional && !def.hasDefault) {
      col += ' NOT NULL'
    }
    columns.push(col)
  }
  return 'CREATE TABLE IF NOT EXISTS "' + name + '" (' + columns.join(', ') + ')'
}

// ---------------------------------------------------------------------------
// WHERE clause builder
// ---------------------------------------------------------------------------

function buildWhereClause(filters: FilterClause[], separator: 'AND' | 'OR' = 'AND'): { sql: string; values: unknown[] } {
  if (!filters || filters.length === 0) return { sql: '', values: [] }

  const conditions: string[] = []
  const values: unknown[] = []

  for (const clause of filters) {
    switch (clause.op) {
      case 'eq':
        conditions.push('"' + clause.field + '" = ?')
        values.push(serializeValue(clause.value))
        break
      case 'ne':
        conditions.push('"' + clause.field + '" != ?')
        values.push(serializeValue(clause.value))
        break
      case 'gt':
        conditions.push('"' + clause.field + '" > ?')
        values.push(serializeValue(clause.value))
        break
      case 'gte':
        conditions.push('"' + clause.field + '" >= ?')
        values.push(serializeValue(clause.value))
        break
      case 'lt':
        conditions.push('"' + clause.field + '" < ?')
        values.push(serializeValue(clause.value))
        break
      case 'lte':
        conditions.push('"' + clause.field + '" <= ?')
        values.push(serializeValue(clause.value))
        break
      case 'in': {
        const arr = clause.value as unknown[]
        if (arr.length === 0) {
          conditions.push('1 = 0')
        } else {
          const placeholders = arr.map(() => '?').join(', ')
          conditions.push('"' + clause.field + '" IN (' + placeholders + ')')
          for (const v of arr) values.push(serializeValue(v))
        }
        break
      }
      case 'contains':
        conditions.push('"' + clause.field + '" LIKE ?')
        values.push('%' + clause.value + '%')
        break
      case 'startsWith':
        conditions.push('"' + clause.field + '" LIKE ?')
        values.push('' + clause.value + '%')
        break
    }
  }

  const joinStr = ' ' + separator + ' '
  return {
    sql: conditions.length > 0 ? 'WHERE ' + conditions.join(joinStr) : '',
    values,
  }
}

function buildLogicalWhere(andFilters?: FilterClause[], orFilters?: FilterClause[]): { sql: string; values: unknown[] } {
  const hasAnd = !!(andFilters && andFilters.length > 0)
  const hasOr = !!(orFilters && orFilters.length > 0)

  if (!hasAnd && !hasOr) return { sql: '', values: [] }
  if (hasAnd && !hasOr) return buildWhereClause(andFilters!, 'AND')
  if (!hasAnd && hasOr) return buildWhereClause(orFilters!, 'OR')

  const andResult = buildWhereClause(andFilters!, 'AND')
  const orResult = buildWhereClause(orFilters!, 'OR')
  return {
    sql: 'WHERE (' + andResult.sql.replace('WHERE ', '') + ') OR (' + orResult.sql.replace('WHERE ', '') + ')',
    values: [...andResult.values, ...orResult.values],
  }
}

function buildOrderBy(orderBy: NonNullable<QueryParams['orderBy']>): string {
  if (!orderBy || orderBy.length === 0) return ''
  const clauses = orderBy.map((o) => '"' + o.field + '" ' + o.direction.toUpperCase())
  return 'ORDER BY ' + clauses.join(', ')
}

function buildSelect(select: string[] | undefined): string {
  if (!select || select.length === 0) return '*'
  return select.map((s) => '"' + s + '"').join(', ')
}

// ---------------------------------------------------------------------------
// Aggregation $match condition → SQL builder
// ---------------------------------------------------------------------------

function buildAggMatchCondition(
  condition: unknown,
): { sql: string; values: unknown[] } {
  if (typeof condition !== 'object' || condition === null) {
    return { sql: '', values: [] }
  }

  const obj = condition as Record<string, unknown>
  const entries = Object.entries(obj)
  if (entries.length === 0) return { sql: '', values: [] }

  // Pure $or or $and at the top level
  if (entries[0]![0] === '$or' && entries.length === 1) {
    const parts = (entries[0]![1] as unknown[]).map((sub) => buildAggMatchCondition(sub))
    return {
      sql: '(' + parts.map((p) => p.sql).join(' OR ') + ')',
      values: parts.flatMap((p) => p.values),
    }
  }

  if (entries[0]![0] === '$and' && entries.length === 1) {
    const parts = (entries[0]![1] as unknown[]).map((sub) => buildAggMatchCondition(sub))
    return {
      sql: '(' + parts.map((p) => p.sql).join(' AND ') + ')',
      values: parts.flatMap((p) => p.values),
    }
  }

  // Mixed: AND all entries
  const parts = entries.map(([key, value]) => {
    if (key === '$or') {
      const subParts = (value as unknown[]).map((sub) => buildAggMatchCondition(sub))
      return { sql: '(' + subParts.map((p) => p.sql).join(' OR ') + ')', values: subParts.flatMap((p) => p.values) }
    }
    if (key === '$and') {
      const subParts = (value as unknown[]).map((sub) => buildAggMatchCondition(sub))
      return { sql: '(' + subParts.map((p) => p.sql).join(' AND ') + ')', values: subParts.flatMap((p) => p.values) }
    }

    // Field with operator object
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return buildFieldCondition(key, value as Record<string, unknown>)
    }

    // Simple equality
    return { sql: '"' + key + '" = ?', values: [serializeValue(value)] }
  })

  return {
    sql: parts.map((p) => p.sql).join(' AND '),
    values: parts.flatMap((p) => p.values),
  }
}

function buildFieldCondition(
  field: string,
  ops: Record<string, unknown>,
): { sql: string; values: unknown[] } {
  const conditions: string[] = []
  const values: unknown[] = []

  for (const [op, opValue] of Object.entries(ops)) {
    switch (op) {
      case '$eq':
        conditions.push('"' + field + '" = ?')
        values.push(serializeValue(opValue))
        break
      case '$ne':
        conditions.push('"' + field + '" != ?')
        values.push(serializeValue(opValue))
        break
      case '$gt':
        conditions.push('"' + field + '" > ?')
        values.push(serializeValue(opValue))
        break
      case '$gte':
        conditions.push('"' + field + '" >= ?')
        values.push(serializeValue(opValue))
        break
      case '$lt':
        conditions.push('"' + field + '" < ?')
        values.push(serializeValue(opValue))
        break
      case '$lte':
        conditions.push('"' + field + '" <= ?')
        values.push(serializeValue(opValue))
        break
      case '$in': {
        const arr = opValue as unknown[]
        if (arr.length === 0) {
          conditions.push('1 = 0')
        } else {
          const placeholders = arr.map(() => '?').join(', ')
          conditions.push('"' + field + '" IN (' + placeholders + ')')
          for (const v of arr) values.push(serializeValue(v))
        }
        break
      }
      case '$contains':
        conditions.push('"' + field + '" LIKE ?')
        values.push('%' + (opValue as string) + '%')
        break
      case '$startsWith':
        conditions.push('"' + field + '" LIKE ?')
        values.push('' + (opValue as string) + '%')
        break
    }
  }

  return { sql: conditions.join(' AND '), values }
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Create a SQLite storage adapter backed by better-sqlite3.
 *
 * Requires `better-sqlite3` to be installed alongside `@sajjadbzn/jcell`:
 *
 * ```bash
 * npm install better-sqlite3
 * ```
 *
 * ```ts
 * import { createDB, schema, t } from '@sajjadbzn/jcell'
 * import { sqliteAdapter } from '@sajjadbzn/jcell'
 *
 * const db = createDB({
 *   adapter: sqliteAdapter({ path: './app.db' })
 * })
 * ```
 *
 * Features:
 * - Schema → SQL DDL auto-generation
 * - Full query translation (filters → parameterized WHERE clauses)
 * - Aggregation via SQL SUM/AVG/MIN/MAX/COUNT
 * - Real SQL indexes (CREATE INDEX)
 * - WAL mode for concurrent performance
 * - Foreign key enforcement
 */
export function sqliteAdapter(config: SqliteAdapterConfig = {}): StorageAdapter {
  const dbPath = config.path ?? './data.db'
  const prefix = config.tablePrefix ?? ''
  const Database = loadBetterSqlite3()
  const db = new Database(dbPath)

  // WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')
  // Foreign key enforcement
  db.pragma('foreign_keys = ON')

  function tableName(collection: string): string {
    return prefix + collection
  }

  // -----------------------------------------------------------------------
  // Core query helper (synchronous)
  // -----------------------------------------------------------------------

  function queryRows(collection: string, params: QueryParams): Record<string, unknown>[] {
    const where = buildLogicalWhere(params.filter, params.orFilter)
    const orderBy = buildOrderBy(params.orderBy ?? [])
    const select = buildSelect(params.select)

    let sql = 'SELECT ' + select + ' FROM "' + tableName(collection) + '"'
    if (where.sql) sql += ' ' + where.sql
    if (orderBy) sql += ' ' + orderBy
    if (params.limit !== undefined) sql += ' LIMIT ' + params.limit
    if (params.offset !== undefined) sql += ' OFFSET ' + params.offset

    return db.prepare(sql).all(...where.values) as Record<string, unknown>[]
  }

  // -----------------------------------------------------------------------
  // Adapter implementation
  // -----------------------------------------------------------------------

  const adapter: StorageAdapter = {
    // -------------------------------------------------------------------
    // Basic interface
    // -------------------------------------------------------------------

    async read(collection: string): Promise<string | null> {
      try {
        const rows = db.prepare('SELECT * FROM "' + tableName(collection) + '"').all()
        return JSON.stringify(rows)
      } catch {
        return null
      }
    },

    async write(collection: string, data: string): Promise<void> {
      const docs = JSON.parse(data) as Record<string, unknown>[]
      const tn = tableName(collection)

      if (docs.length === 0) {
        db.exec('DELETE FROM "' + tn + '"')
        return
      }

      const keys = Object.keys(docs[0]!)
      const colList = keys.map((k) => '"' + k + '"').join(', ')
      const placeholders = keys.map(() => '?').join(', ')

      const del = db.prepare('DELETE FROM "' + tn + '"')
      const insert = db.prepare('INSERT INTO "' + tn + '" (' + colList + ') VALUES (' + placeholders + ')')

      const tx = db.transaction(() => {
        del.run()
        for (const doc of docs) {
          insert.run(...Object.values(serializeDoc(doc)))
        }
      })
      tx()
    },

    async exists(collection: string): Promise<boolean> {
      try {
        db.prepare('SELECT 1 FROM "' + tableName(collection) + '" LIMIT 1').get()
        return true
      } catch {
        return false
      }
    },

    async delete(collection: string): Promise<void> {
      db.exec('DROP TABLE IF EXISTS "' + tableName(collection) + '"')
    },

    // -------------------------------------------------------------------
    // Pro interface
    // -------------------------------------------------------------------

    async query(collection: string, params: QueryParams): Promise<Record<string, unknown>[]> {
      return queryRows(collection, params)
    },

    async insertOne(collection: string, doc: Record<string, unknown>): Promise<Record<string, unknown>> {
      const serialized = serializeDoc(doc)
      const keys = Object.keys(serialized)
      const placeholders = keys.map(() => '?').join(', ')
      const values = keys.map((k) => serialized[k])

      db.prepare(
        'INSERT INTO "' + tableName(collection) + '" (' +
          keys.map((k) => '"' + k + '"').join(', ') +
        ') VALUES (' + placeholders + ')',
      ).run(...values)

      return doc
    },

    async updateMany(collection: string, filter: FilterClause[], changes: Record<string, unknown>): Promise<number> {
      const serialized = serializeDoc(changes)
      const setClauses = Object.keys(serialized).map((k) => '"' + k + '" = ?')
      const setValues = Object.keys(serialized).map((k) => serialized[k])
      const where = buildWhereClause(filter)

      if (!where.sql) {
        return db.prepare(
          'UPDATE "' + tableName(collection) + '" SET ' + setClauses.join(', '),
        ).run(...setValues).changes
      }

      return db.prepare(
        'UPDATE "' + tableName(collection) + '" SET ' + setClauses.join(', ') + ' ' + where.sql,
      ).run(...setValues, ...where.values).changes
    },

    async deleteMany(collection: string, filter: FilterClause[]): Promise<number> {
      const where = buildWhereClause(filter)
      let sql = 'DELETE FROM "' + tableName(collection) + '"'
      if (where.sql) sql += ' ' + where.sql
      return db.prepare(sql).run(...where.values).changes
    },

    async count(collection: string, filter?: FilterClause[]): Promise<number> {
      const where = buildWhereClause(filter ?? [])
      const sql = 'SELECT COUNT(*) as count FROM "' + tableName(collection) + '"' + (where.sql ? ' ' + where.sql : '')
      const row = db.prepare(sql).get(...where.values) as { count: number } | undefined
      return row?.count ?? 0
    },

    async aggregate(collection: string, pipeline: AggregateStage[]): Promise<unknown> {
      let whereClause = ''
      const whereValues: unknown[] = []
      let selectExpr = '*'
      let limitClause = ''
      let offsetClause = ''

      for (const stage of pipeline) {
        if ('$match' in stage) {
          const result = buildAggMatchCondition(stage.$match)
          whereClause = result.sql ? 'WHERE ' + result.sql : ''
          whereValues.length = 0
          whereValues.push(...result.values)
        } else if ('$group' in stage) {
          const group = stage.$group
          const aggParts: string[] = []
          for (const [key, expr] of Object.entries(group)) {
            if (key === '_id') continue
            const exprObj = expr as Record<string, unknown>
            if ('$sum' in exprObj) {
              const field = (exprObj.$sum as string).replace('$', '')
              aggParts.push('SUM("' + field + '") as "' + key + '"')
            } else if ('$avg' in exprObj) {
              const field = (exprObj.$avg as string).replace('$', '')
              aggParts.push('AVG("' + field + '") as "' + key + '"')
            } else if ('$min' in exprObj) {
              const field = (exprObj.$min as string).replace('$', '')
              aggParts.push('MIN("' + field + '") as "' + key + '"')
            } else if ('$max' in exprObj) {
              const field = (exprObj.$max as string).replace('$', '')
              aggParts.push('MAX("' + field + '") as "' + key + '"')
            }
          }
          selectExpr = aggParts.join(', ')
        } else if ('$count' in stage) {
          selectExpr = 'COUNT(*) as count'
        } else if ('$limit' in stage) {
          limitClause = 'LIMIT ' + stage.$limit
        } else if ('$skip' in stage) {
          offsetClause = 'OFFSET ' + stage.$skip
        }
      }

      const sql = [
        'SELECT ' + selectExpr + ' FROM "' + tableName(collection) + '"',
        whereClause,
        limitClause,
        offsetClause,
      ].filter(Boolean).join(' ')

      return db.prepare(sql).all(...whereValues)
    },

    // -------------------------------------------------------------------
    // Schema & index management
    // -------------------------------------------------------------------

    async ensureCollection(name: string, fields: Record<string, FieldDef>): Promise<void> {
      db.exec(generateCreateTable(tableName(name), fields))
    },

    async createIndex(collection: string, field: string, options?: { unique?: boolean }): Promise<void> {
      const unique = options?.unique ? 'UNIQUE ' : ''
      db.exec('CREATE ' + unique + 'INDEX IF NOT EXISTS "idx_' + collection + '_' + field + '" ON "' + tableName(collection) + '" ("' + field + '")')
    },

    async dropIndex(collection: string, field: string): Promise<void> {
      db.exec('DROP INDEX IF EXISTS "idx_' + collection + '_' + field + '"')
    },

    // -------------------------------------------------------------------
    // Transaction support
    //
    // Shares the same `db` connection so all operations within the
    // transaction see each other's uncommitted changes.  Multi-operation
    // transactions are atomic: COMMIT on success, ROLLBACK on error.
    //
    // NOTE: because better-sqlite3 is synchronous, individual adapter
    // methods inside the transaction execute within the BEGIN/COMMIT
    // boundary set up here.
    // -------------------------------------------------------------------

    async transaction<T>(fn: (adapter: StorageAdapter) => Promise<T>): Promise<T> {
      // Pass the same adapter — all methods use the same `db` connection
      // that has been placed in a transaction via BEGIN IMMEDIATE.
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn(adapter)
        db.exec('COMMIT')
        return result
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },

    // -------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------

    async connect(): Promise<void> {
      // Connection is already established in the constructor
    },

    async disconnect(): Promise<void> {
      db.close()
    },
  }

  return adapter
}
