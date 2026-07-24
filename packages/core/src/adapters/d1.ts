import type { StorageAdapter, D1AdapterConfig, D1Database, FilterClause, QueryParams, AggregateStage } from '../types'
import type { FieldDef } from '../schema'

/**
 * Create a Cloudflare D1 storage adapter.
 *
 * D1 is Cloudflare's serverless SQLite database, available in Workers.
 * This adapter maps jcell collections to SQL tables with:
 * - Top-level fields → SQL columns (TEXT, REAL, INTEGER)
 * - Nested objects/arrays → JSON TEXT columns
 * - Full query building from FilterClause to parameterized SQL
 * - Transaction support via D1's batch API
 * - Index creation and management
 *
 * ```ts
 * import { d1Adapter } from '@sajjadbzn/jcell/d1'
 *
 * const db = createDB({
 *   adapter: d1Adapter({ binding: env.DB })
 * })
 * ```
 */
export function d1Adapter(config: D1AdapterConfig): StorageAdapter {
  const d1: D1Database = config.binding
  const prefix = config.tablePrefix ?? ''

  function tableName(collection: string): string {
    return `${prefix}${collection}`
  }

  // -----------------------------------------------------------------------
  // Schema → SQL mapping
  // -----------------------------------------------------------------------

  function fieldType(def: FieldDef): string {
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
        return 'TEXT' // JSON columns
      default:
        return 'TEXT'
    }
  }

  function generateCreateTable(
    name: string,
    fields: Record<string, FieldDef>,
  ): string {
    const columns: string[] = []

    for (const [key, def] of Object.entries(fields)) {
      let col = `"${key}" ${fieldType(def)}`
      if (def.type === 'id') {
        col += ' PRIMARY KEY'
      } else if (!def.optional && !def.hasDefault) {
        col += ' NOT NULL'
      }
      columns.push(col)
    }

    return `CREATE TABLE IF NOT EXISTS "${tableName(name)}" (${columns.join(', ')})`
  }

  // -----------------------------------------------------------------------
  // Query → SQL translation
  // -----------------------------------------------------------------------

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

    // Both: (AND group) OR (OR group)
    const andResult = buildWhereClause(andFilters!, 'AND')
    const orResult = buildWhereClause(orFilters!, 'OR')
    return {
      sql: 'WHERE (' + andResult.sql.replace('WHERE ', '') + ') OR (' + orResult.sql.replace('WHERE ', '') + ')',
      values: [...andResult.values, ...orResult.values],
    }
  }

  function buildOrderBy(
    orderBy: NonNullable<QueryParams['orderBy']>,
  ): string {
    if (!orderBy || orderBy.length === 0) return ''
    const clauses = orderBy.map((o) => `"${o.field}" ${o.direction.toUpperCase()}`)
    return `ORDER BY ${clauses.join(', ')}`
  }

  function buildSelect(
    select: string[] | undefined,
    _table: string,
  ): string {
    if (!select || select.length === 0) return '*'
    return select.map((s) => `"${s}"`).join(', ')
  }

  function serializeValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'boolean') return value ? 1 : 0
    if (typeof value === 'object' && value !== null) return JSON.stringify(value)
    return value
  }

  function serializeDoc(
    doc: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(doc)) {
      result[key] = serializeValue(value)
    }
    return result
  }

  // -----------------------------------------------------------------------
  // Adapter implementation
  // -----------------------------------------------------------------------

  return {
    // -------------------------------------------------------------------
    // Basic interface (needed for Cache strategy, rarely used with D1)
    // -------------------------------------------------------------------

    async read(collection: string): Promise<string | null> {
      try {
        const result = await d1
          .prepare(`SELECT * FROM "${tableName(collection)}"`)
          .all()
        if (!result.success || !result.results) return null
        return JSON.stringify(result.results)
      } catch {
        return null
      }
    },

    async write(collection: string, data: string): Promise<void> {
      const docs = JSON.parse(data) as Record<string, unknown>[]
      // Truncate and re-insert all (not efficient but satisfies the interface)
      await d1.exec(`DELETE FROM "${tableName(collection)}"`)
      if (docs.length > 0) {
        const statements = docs.map((doc) => {
          const keys = Object.keys(doc)
          const placeholders = keys.map(() => '?').join(', ')
          const values = keys.map((k) => serializeValue(doc[k]))
          return d1
            .prepare(
              `INSERT INTO "${tableName(collection)}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${placeholders})`,
            )
            .bind(...values)
        })
        await d1.batch(statements)
      }
    },

    async exists(collection: string): Promise<boolean> {
      try {
        await d1
          .prepare(`SELECT 1 FROM "${tableName(collection)}" LIMIT 1`)
          .run()
        return true
      } catch {
        return false
      }
    },

    async delete(collection: string): Promise<void> {
      await d1.exec(`DROP TABLE IF EXISTS "${tableName(collection)}"`)
    },

    // -------------------------------------------------------------------
    // Pro interface
    // -------------------------------------------------------------------

    async query(
      collection: string,
      params: QueryParams,
    ): Promise<Record<string, unknown>[]> {
      const where = buildLogicalWhere(params.filter, params.orFilter)
      const orderBy = buildOrderBy(params.orderBy ?? [])
      const select = buildSelect(params.select, tableName(collection))

      let sql = `SELECT ${select} FROM "${tableName(collection)}"`
      if (where.sql) sql += ` ${where.sql}`
      if (orderBy) sql += ` ${orderBy}`
      if (params.limit !== undefined) sql += ` LIMIT ${params.limit}`
      if (params.offset !== undefined) sql += ` OFFSET ${params.offset}`

      const result = await d1.prepare(sql).bind(...where.values).all()
      if (!result.success || !result.results) return []

      // Note: deserialization with field types requires schema knowledge
      // which we don't have here. Raw values are returned.
      return result.results as Record<string, unknown>[]
    },

    async insertOne(
      collection: string,
      doc: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const serialized = serializeDoc(doc)
      const keys = Object.keys(serialized)
      const placeholders = keys.map(() => '?').join(', ')
      const values = keys.map((k) => serialized[k])

      await d1
        .prepare(
          `INSERT INTO "${tableName(collection)}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${placeholders})`,
        )
        .bind(...values)
        .run()

      return doc
    },

    async updateMany(
      collection: string,
      filter: FilterClause[],
      changes: Record<string, unknown>,
    ): Promise<number> {
      const serialized = serializeDoc(changes)
      const setClauses = Object.keys(serialized).map((k) => `"${k}" = ?`)
      const setValues = Object.keys(serialized).map((k) => serialized[k])

      const where = buildWhereClause(filter)

      if (!where.sql) {
        // No filter → update all
        const result = await d1
          .prepare(
            `UPDATE "${tableName(collection)}" SET ${setClauses.join(', ')}`,
          )
          .bind(...setValues)
          .run()
        return (result.meta as any)?.rows_written as number ?? 0
      }

      const result = await d1
        .prepare(
          `UPDATE "${tableName(collection)}" SET ${setClauses.join(', ')} ${where.sql}`,
        )
        .bind(...setValues, ...where.values)
        .run()

      return (result.meta as any)?.rows_written as number ?? 0
    },

    async deleteMany(
      collection: string,
      filter: FilterClause[],
    ): Promise<number> {
      const where = buildWhereClause(filter)

      if (!where.sql) {
        // No filter → delete all
        const result = await d1
          .prepare(`DELETE FROM "${tableName(collection)}"`)
          .run()
        return (result.meta as any)?.rows_written as number ?? 0
      }

      const result = await d1
        .prepare(`DELETE FROM "${tableName(collection)}" ${where.sql}`)
        .bind(...where.values)
        .run()

      return (result.meta as any)?.rows_written as number ?? 0
    },

    async count(
      collection: string,
      filter?: FilterClause[],
    ): Promise<number> {
      const where = buildWhereClause(filter ?? [])

      const sql = `SELECT COUNT(*) as count FROM "${tableName(collection)}"${where.sql ? ` ${where.sql}` : ''}`

      const result = await d1.prepare(sql).bind(...where.values).first<{ count: number }>()
      return result?.count ?? 0
    },

    async aggregate(
      collection: string,
      pipeline: AggregateStage[],
    ): Promise<unknown> {
      // For D1, we implement a subset of aggregation that maps to SQL
      let whereClause = ''
      const whereValues: unknown[] = []
      let selectExpr = '*'
      let groupBy = ''
      let limitClause = ''
      let offsetClause = ''

      for (const stage of pipeline) {
        if ('$match' in stage) {
          const clauses: string[] = []
          for (const [key, value] of Object.entries(stage.$match)) {
            clauses.push(`"${key}" = ?`)
            whereValues.push(value)
          }
          whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
        } else if ('$group' in stage) {
          const group = stage.$group
          const aggParts: string[] = []
          for (const [key, expr] of Object.entries(group)) {
            if (key === '_id') continue
            const exprObj = expr as Record<string, unknown>
            if ('$sum' in exprObj) {
              const field = (exprObj.$sum as string).replace('$', '')
              aggParts.push(`SUM("${field}") as "${key}"`)
            } else if ('$avg' in exprObj) {
              const field = (exprObj.$avg as string).replace('$', '')
              aggParts.push(`AVG("${field}") as "${key}"`)
            } else if ('$min' in exprObj) {
              const field = (exprObj.$min as string).replace('$', '')
              aggParts.push(`MIN("${field}") as "${key}"`)
            } else if ('$max' in exprObj) {
              const field = (exprObj.$max as string).replace('$', '')
              aggParts.push(`MAX("${field}") as "${key}"`)
            }
          }
          selectExpr = aggParts.join(', ')
          groupBy = ''
        } else if ('$count' in stage) {
          selectExpr = 'COUNT(*) as count'
        } else if ('$limit' in stage) {
          limitClause = `LIMIT ${stage.$limit}`
        } else if ('$skip' in stage) {
          offsetClause = `OFFSET ${stage.$skip}`
        }
      }

      const sql = [
        `SELECT ${selectExpr} FROM "${tableName(collection)}"`,
        whereClause,
        groupBy,
        limitClause,
        offsetClause,
      ]
        .filter(Boolean)
        .join(' ')

      const result = await d1.prepare(sql).bind(...whereValues).all()
      if (!result.success || !result.results) return []
      return result.results
    },

    // -------------------------------------------------------------------
    // Schema & index management
    // -------------------------------------------------------------------

    async ensureCollection(
      name: string,
      fields: Record<string, FieldDef>,
    ): Promise<void> {
      const sql = generateCreateTable(name, fields)
      await d1.exec(sql)
    },

    async createIndex(
      collection: string,
      field: string,
      options?: { unique?: boolean },
    ): Promise<void> {
      const unique = options?.unique ? 'UNIQUE ' : ''
      const indexName = `idx_${collection}_${field}`
      await d1.exec(
        `CREATE ${unique}INDEX IF NOT EXISTS "${indexName}" ON "${tableName(collection)}" ("${field}")`,
      )
    },

    async dropIndex(collection: string, field: string): Promise<void> {
      const indexName = `idx_${collection}_${field}`
      await d1.exec(`DROP INDEX IF EXISTS "${indexName}"`)
    },

    // -------------------------------------------------------------------
    // Transaction support
    // -------------------------------------------------------------------

    async transaction<T>(
      fn: (adapter: StorageAdapter) => Promise<T>,
    ): Promise<T> {
      // D1 transactions use the batch API for atomicity.
      // Since D1 doesn't have interactive transactions (BEGIN/COMMIT),
      // we use a trick: collect all statements and execute them in a batch.
      //
      // For simplicity, we use the built-in D1 batch approach:
      // 1. Call fn with a proxy adapter that records all operations
      // 2. Execute them all in one batch

      const statements: Array<{ sql: string; values: unknown[] }> = []

      const txAdapter: StorageAdapter = {
        read: async () => null,
        write: async () => {},
        exists: async () => false,

        query: async (
          collection: string,
          params: QueryParams,
        ): Promise<Record<string, unknown>[]> => {
          const where = buildLogicalWhere(params.filter, params.orFilter)
          const orderBy = buildOrderBy(params.orderBy ?? [])
          const select = buildSelect(params.select, tableName(collection))

          let sql = `SELECT ${select} FROM "${tableName(collection)}"`
          if (where.sql) sql += ` ${where.sql}`
          if (orderBy) sql += ` ${orderBy}`
          if (params.limit !== undefined) sql += ` LIMIT ${params.limit}`
          if (params.offset !== undefined) sql += ` OFFSET ${params.offset}`

          // D1 batch can include SELECT statements too
          const prepared = d1.prepare(sql).bind(...where.values)
          const results = await d1.batch([prepared])
          const first = results[0] as any
          return first?.results ?? []
        },

        insertOne: async (
          collection: string,
          doc: Record<string, unknown>,
        ): Promise<Record<string, unknown>> => {
          const serialized = serializeDoc(doc)
          const keys = Object.keys(serialized)
          const placeholders = keys.map(() => '?').join(', ')
          const values = keys.map((k) => serialized[k])
          statements.push({
            sql: `INSERT INTO "${tableName(collection)}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${placeholders})`,
            values,
          })
          return doc
        },

        updateMany: async (
          collection: string,
          filter: FilterClause[],
          changes: Record<string, unknown>,
        ): Promise<number> => {
          const serialized = serializeDoc(changes)
          const setClauses = Object.keys(serialized).map((k) => `"${k}" = ?`)
          const setValues = Object.keys(serialized).map((k) => serialized[k])
          const where = buildWhereClause(filter)
          if (where.sql) {
            statements.push({
              sql: `UPDATE "${tableName(collection)}" SET ${setClauses.join(', ')} ${where.sql}`,
              values: [...setValues, ...where.values],
            })
          } else {
            statements.push({
              sql: `UPDATE "${tableName(collection)}" SET ${setClauses.join(', ')}`,
              values: setValues,
            })
          }
          return 1 // optimistic
        },

        deleteMany: async (
          collection: string,
          filter: FilterClause[],
        ): Promise<number> => {
          const where = buildWhereClause(filter)
          if (where.sql) {
            statements.push({
              sql: `DELETE FROM "${tableName(collection)}" ${where.sql}`,
              values: where.values,
            })
          } else {
            statements.push({
              sql: `DELETE FROM "${tableName(collection)}"`,
              values: [],
            })
          }
          return 1 // optimistic
        },

        count: async (
          collection: string,
          filter?: FilterClause[],
        ): Promise<number> => {
          const where = buildWhereClause(filter ?? [])
          const sql = `SELECT COUNT(*) as count FROM "${tableName(collection)}"${where.sql ? ` ${where.sql}` : ''}`
          const prepared = d1.prepare(sql).bind(...where.values)
          const result = await prepared.first<{ count: number }>()
          return result?.count ?? 0
        },
      }

      const result = await fn(txAdapter)

      // Execute all collected statements in one batch
      if (statements.length > 0) {
        const prepared = statements.map((s) =>
          d1.prepare(s.sql).bind(...s.values),
        )
        await d1.batch(prepared)
      }

      return result
    },

    // -------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------

    async connect(): Promise<void> {
      // D1 doesn't require explicit connection setup
    },

    async disconnect(): Promise<void> {
      // D1 doesn't require explicit teardown
    },
  }
}

export type { D1AdapterConfig }
