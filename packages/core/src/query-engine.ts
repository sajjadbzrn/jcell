import type {
  DocWithId,
  StorageAdapter,
  FilterClause,
  FilterOp,
  QueryParams,
  OrderByClause,
  SortDirection,
  HookEvent,
  HookMap,
} from './types'
import type { FieldDef } from './schema'
import type { SchemaInstance } from './schema'
import { validateDocument, applyDefaults } from './validator'

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

/**
 * A pending query that can be refined with more filters, sorting,
 * pagination, and then executed with `.find()` or `.first()`.
 */
export class QueryBuilder<T extends DocWithId> {
  private _filters: FilterClause[] = []
  private _limitValue: number | null = null
  private _offsetValue: number | null = null
  private _orderByClauses: OrderByClause[] = []
  private _selectFields: string[] | null = null
  private _populateRelations: string[] = []

  constructor(private _collection: Collection<T>) {}

  /**
   * Start a filter on a specific field. Chain `.eq()`, `.gt()`, `.lt()`, `.in()`, etc.
   */
  where(field: keyof T & string): FieldFilter<T> {
    return new FieldFilter(this, field)
  }

  /**
   * Add a raw filter clause.
   * @internal
   */
  _addFilter(clause: FilterClause): this {
    this._filters.push(clause)
    return this
  }

  /**
   * Limit the number of documents returned.
   */
  limit(n: number): this {
    this._limitValue = n
    return this
  }

  /**
   * Skip the first `n` documents.
   */
  offset(n: number): this {
    this._offsetValue = n
    return this
  }

  /**
   * Convenience: page number (1-indexed) with a page size.
   * page(1, 20) → limit 20, offset 0
   * page(2, 20) → limit 20, offset 20
   */
  page(page: number, pageSize: number): this {
    this._limitValue = pageSize
    this._offsetValue = (page - 1) * pageSize
    return this
  }

  /**
   * Sort by a field in ascending order.
   */
  orderBy(field: keyof T & string, direction: SortDirection = 'asc'): this {
    this._orderByClauses.push({ field, direction })
    return this
  }

  /**
   * Sort by a field in descending order.
   */
  orderByDesc(field: keyof T & string): this {
    return this.orderBy(field, 'desc')
  }

  /**
   * Select only specific fields (projection).
   */
  select(fields: (keyof T & string)[]): this {
    this._selectFields = fields
    return this
  }

  /**
   * Populate a relationship field.
   * The field must be defined with `t.ref('collectionName')` in the schema.
   */
  with(field: string): this {
    this._populateRelations.push(field)
    return this
  }

  /**
   * Execute the query and return all matching documents.
   */
  async find(): Promise<T[]> {
    return this._collection._executeQuery({
      filter: this._filters.length > 0 ? this._filters : undefined,
      limit: this._limitValue ?? undefined,
      offset: this._offsetValue ?? undefined,
      orderBy: this._orderByClauses.length > 0 ? this._orderByClauses : undefined,
      select: this._selectFields ?? undefined,
      populate: this._populateRelations.length > 0 ? this._populateRelations : undefined,
    })
  }

  /**
   * Execute the query and return the first matching document, or null.
   */
  async first(): Promise<T | null> {
    const results = await this._collection._executeQuery({
      filter: this._filters.length > 0 ? this._filters : undefined,
      limit: 1,
      offset: undefined,
      orderBy: this._orderByClauses.length > 0 ? this._orderByClauses : undefined,
      select: this._selectFields ?? undefined,
      populate: this._populateRelations.length > 0 ? this._populateRelations : undefined,
    })
    return results[0] ?? null
  }

  /**
   * Count documents matching the current query.
   */
  async count(): Promise<number> {
    return this._collection._count(this._filters.length > 0 ? this._filters : undefined)
  }
}

// ---------------------------------------------------------------------------
// Field filter
// ---------------------------------------------------------------------------

/**
 * A field-specific filter that lets you chain `.eq()`, `.gt()`, `.lt()`, `.in()`, etc.
 */
export class FieldFilter<T extends DocWithId> {
  constructor(
    private _query: QueryBuilder<T>,
    private _field: string,
  ) {}

  eq(value: unknown): QueryBuilder<T> {
    return this._query._addFilter({ field: this._field, op: 'eq', value })
  }

  ne(value: unknown): QueryBuilder<T> {
    return this._query._addFilter({ field: this._field, op: 'ne', value })
  }

  gt(value: number | Date): QueryBuilder<T> {
    return this._query._addFilter({ field: this._field, op: 'gt', value })
  }

  gte(value: number | Date): QueryBuilder<T> {
    return this._query._addFilter({ field: this._field, op: 'gte', value })
  }

  lt(value: number | Date): QueryBuilder<T> {
    return this._query._addFilter({ field: this._field, op: 'lt', value })
  }

  lte(value: number | Date): QueryBuilder<T> {
    return this._query._addFilter({ field: this._field, op: 'lte', value })
  }

  in(values: unknown[]): QueryBuilder<T> {
    return this._query._addFilter({ field: this._field, op: 'in', value: values })
  }

  contains(value: string): QueryBuilder<T> {
    return this._query._addFilter({ field: this._field, op: 'contains', value })
  }

  startsWith(value: string): QueryBuilder<T> {
    return this._query._addFilter({ field: this._field, op: 'startsWith', value })
  }
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/** Internal query shape passed from QueryBuilder to Collection. */
interface InternalQuery {
  filter?: FilterClause[]
  limit?: number
  offset?: number
  orderBy?: OrderByClause[]
  select?: string[]
  populate?: string[]
}

/**
 * A typed collection that wraps a storage adapter with schema validation.
 *
 * Supports two strategies:
 * - **Cache**: loads all docs into memory, filters/sorts in JS (file, memory adapters)
 * - **Delegate**: delegates queries to the adapter (D1, SQL adapters)
 */
export class Collection<T extends DocWithId> {
  /** In-memory document cache, keyed by id. Used only in Cache strategy. */
  private _docs = new Map<string, T>()
  /** Whether the cache has been hydrated from storage. */
  private _loaded = false
  /** Whether this collection uses the Delegate strategy. */
  private _isDelegate: boolean
  /** Hook registrations. */
  private _hooks: HookMap<T> = {}
  /** Secondary indexes (for Cache strategy). */
  private _indexes = new Map<string, Map<unknown, Set<string>>>()

  constructor(
    readonly name: string,
    readonly schema: SchemaInstance<T>,
    private _adapter: StorageAdapter,
  ) {
    this._isDelegate = typeof _adapter.query === 'function'
  }

  // -----------------------------------------------------------------------
  // Strategy helpers
  // -----------------------------------------------------------------------

  /**
   * Ensure the in-memory cache is loaded from storage (Cache strategy only).
   */
  async _ensureLoaded(): Promise<void> {
    if (this._isDelegate || this._loaded) return
    this._loaded = true

    const raw = await this._adapter.read(this.name)
    if (raw === null) {
      this._docs = new Map()
      return
    }

    let documents: Record<string, unknown>[]
    try {
      documents = JSON.parse(raw) as Record<string, unknown>[]
    } catch {
      this._docs = new Map()
      return
    }

    this._docs = new Map()
    for (const doc of documents) {
      const id = doc['id']
      if (typeof id === 'string') {
        const hydrated = hydrateDoc(doc as T, this.schema._fields) as T
        this._docs.set(id, hydrated)
        this._updateIndexes(hydrated, 'add')
      }
    }
  }

  /**
   * Update secondary indexes when a doc is added or removed.
   */
  private _updateIndexes(doc: T, action: 'add' | 'remove'): void {
    for (const schemaIndex of this.schema._indexes) {
      let idx = this._indexes.get(schemaIndex.field)
      if (!idx) {
        idx = new Map()
        this._indexes.set(schemaIndex.field, idx)
      }
      const value = (doc as Record<string, unknown>)[schemaIndex.field]
      if (action === 'add') {
        let ids = idx.get(value)
        if (!ids) {
          ids = new Set()
          idx.set(value, ids)
        }
        ids.add(doc.id)
      } else {
        const ids = idx.get(value)
        if (ids) {
          ids.delete(doc.id)
          if (ids.size === 0) idx.delete(value)
        }
      }
    }
  }

  /**
   * Persist the in-memory cache to storage (Cache strategy only).
   */
  private async _persist(): Promise<void> {
    if (this._isDelegate) return
    const docs = Array.from(this._docs.values())
    const raw = JSON.stringify(
      docs.map((d) => dehydrateDoc(d)),
      null,
      2,
    )
    await this._adapter.write(this.name, raw)
  }

  /**
   * Execute a query using the appropriate strategy.
   * @internal
   */
  async _executeQuery(query: InternalQuery): Promise<T[]> {
    if (this._isDelegate) {
      const params: QueryParams = {
        filter: query.filter,
        limit: query.limit,
        offset: query.offset,
        orderBy: query.orderBy,
        select: query.select,
      }
      const rawDocs = await this._adapter.query!(this.name, params)
      const docs = rawDocs.map((d) => hydrateDoc(d as T, this.schema._fields) as T)

      // Populate relationships
      if (query.populate && query.populate.length > 0) {
        return this._populateDocs(docs, query.populate)
      }
      return docs
    }

    // Cache strategy
    await this._ensureLoaded()
    let docs = Array.from(this._docs.values())

    // Apply filters
    if (query.filter && query.filter.length > 0) {
      docs = docs.filter((doc) => this._matchesFilters(doc, query.filter!))
    }

    // Apply sort
    if (query.orderBy && query.orderBy.length > 0) {
      docs = this._sortDocs(docs, query.orderBy)
    }

    // Apply pagination
    if (query.offset !== undefined) {
      docs = docs.slice(query.offset)
    }
    if (query.limit !== undefined) {
      docs = docs.slice(0, query.limit)
    }

    // Apply projection
    if (query.select && query.select.length > 0) {
      docs = docs.map((doc) => this._projectDoc(doc, query.select!))
    }

    // Populate relationships
    if (query.populate && query.populate.length > 0) {
      docs = await this._populateDocs(docs, query.populate)
    }

    return docs
  }

  /**
   * Count documents matching a filter.
   * @internal
   */
  async _count(filter?: FilterClause[]): Promise<number> {
    if (this._isDelegate && this._adapter.count) {
      return this._adapter.count(this.name, filter)
    }

    await this._ensureLoaded()
    let docs = Array.from(this._docs.values())
    if (filter && filter.length > 0) {
      docs = docs.filter((doc) => this._matchesFilters(doc, filter))
    }
    return docs.length
  }

  // -----------------------------------------------------------------------
  // Query helpers (Cache strategy)
  // -----------------------------------------------------------------------

  private _matchesFilters(doc: T, filters: FilterClause[]): boolean {
    return filters.every((clause) => {
      const value = (doc as Record<string, unknown>)[clause.field]
      switch (clause.op) {
        case 'eq':
          return value === clause.value
        case 'ne':
          return value !== clause.value
        case 'gt':
          return typeof value === 'number' && typeof clause.value === 'number'
            ? value > clause.value
            : value instanceof Date && clause.value instanceof Date
              ? value.getTime() > clause.value.getTime()
              : false
        case 'gte':
          return typeof value === 'number' && typeof clause.value === 'number'
            ? value >= clause.value
            : value instanceof Date && clause.value instanceof Date
              ? value.getTime() >= clause.value.getTime()
              : false
        case 'lt':
          return typeof value === 'number' && typeof clause.value === 'number'
            ? value < clause.value
            : value instanceof Date && clause.value instanceof Date
              ? value.getTime() < clause.value.getTime()
              : false
        case 'lte':
          return typeof value === 'number' && typeof clause.value === 'number'
            ? value <= clause.value
            : value instanceof Date && clause.value instanceof Date
              ? value.getTime() <= clause.value.getTime()
              : false
        case 'in': {
          const arr = clause.value as unknown[]
          return arr.includes(value)
        }
        case 'contains': {
          return typeof value === 'string'
            ? value.includes(clause.value as string)
            : false
        }
        case 'startsWith': {
          return typeof value === 'string'
            ? value.startsWith(clause.value as string)
            : false
        }
        default:
          return false
      }
    })
  }

  private _sortDocs(docs: T[], orderBy: OrderByClause[]): T[] {
    return [...docs].sort((a, b) => {
      for (const { field, direction } of orderBy) {
        const aVal = (a as Record<string, unknown>)[field]
        const bVal = (b as Record<string, unknown>)[field]
        const cmp = this._compare(aVal, bVal)
        if (cmp !== 0) return direction === 'asc' ? cmp : -cmp
      }
      return 0
    })
  }

  private _compare(a: unknown, b: unknown): number {
    if (a === b) return 0
    if (a === undefined || a === null) return 1
    if (b === undefined || b === null) return -1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
    return String(a).localeCompare(String(b))
  }

  private _projectDoc(doc: T, fields: string[]): T {
    const result: Record<string, unknown> = {}
    for (const field of fields) {
      if (field in (doc as Record<string, unknown>)) {
        result[field] = (doc as Record<string, unknown>)[field]
      }
    }
    return result as T
  }

  private async _populateDocs(docs: T[], relations: string[]): Promise<T[]> {
    const results: T[] = []
    for (const doc of docs) {
      const populated = { ...doc } as Record<string, unknown>
      for (const relation of relations) {
        const fieldDef = this.schema._fields[relation]
        if (!fieldDef || fieldDef.type !== 'ref' || !fieldDef.refCollection) continue
        const refId = populated[relation] as string | undefined
        if (!refId) continue

        // Access the DB through Collection — we need the parent DB instance
        // Since we don't have a direct reference, we skip population for now.
        // The user of Delegate strategy gets population via JOINs in the adapter.
        // For Cache strategy, this is a limitation.
      }
      results.push(populated as T)
    }
    return results
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Register a hook for lifecycle events.
   *
   * ```ts
   * users.hook('before:insert', async (doc) => { ... })
   * users.hook('after:insert', async (doc) => { ... })
   * users.hook('before:update', async (filter, changes) => { ... })
   * users.hook('after:delete', async (filter, count) => { ... })
   * ```
   */
  hook(event: HookEvent, handler: (...args: any[]) => Promise<void> | void): this {
    if (!this._hooks[event]) {
      ;(this._hooks as Record<string, unknown>)[event] = []
    }
    ;(this._hooks[event] as Array<(...args: any[]) => Promise<void> | void>).push(handler)
    return this
  }

  /**
   * Create a query builder scoped to this collection.
   */
  where(field: keyof T & string): FieldFilter<T> {
    const qb = new QueryBuilder<T>(this)
    return new FieldFilter(qb, field)
  }

  /**
   * Create a query builder without any initial filter.
   *
   * ```ts
   * const sorted = await users.query().orderBy('age').limit(10).find()
   * ```
   */
  query(): QueryBuilder<T> {
    return new QueryBuilder<T>(this)
  }

  /**
   * Sort results by a field in ascending order.
   * Shortcut for `collection.query().orderBy(field).find()`.
   */
  orderBy(field: keyof T & string, direction: SortDirection = 'asc'): QueryBuilder<T> {
    return new QueryBuilder<T>(this).orderBy(field, direction)
  }

  /**
   * Sort results by a field in descending order.
   */
  orderByDesc(field: keyof T & string): QueryBuilder<T> {
    return new QueryBuilder<T>(this).orderByDesc(field)
  }

  /**
   * Limit the number of documents returned.
   */
  limit(n: number): QueryBuilder<T> {
    return new QueryBuilder<T>(this).limit(n)
  }

  /**
   * Skip the first `n` documents.
   */
  offset(n: number): QueryBuilder<T> {
    return new QueryBuilder<T>(this).offset(n)
  }

  /**
   * Convenience pagination: page number (1-indexed) with a page size.
   */
  page(page: number, pageSize: number): QueryBuilder<T> {
    return new QueryBuilder<T>(this).page(page, pageSize)
  }

  /**
   * Insert a document into the collection.
   * Returns the inserted document with all defaults and generated id applied.
   */
  async insert(doc: Partial<T>): Promise<T> {
    // Apply defaults
    const hydrated = applyDefaults(
      doc as Record<string, unknown>,
      this.schema._fields,
    ) as Record<string, unknown>

    // Validate
    const errors = validateDocument(hydrated, this.schema._fields)
    if (errors.length > 0) {
      throw new TypeError(`Validation failed:\n${errors.join('\n')}`)
    }

    const typed = hydrateDoc(hydrated as T, this.schema._fields) as T

    // Run before:insert hooks
    await this._runHooks('before:insert', typed)

    // Check for id collision in all strategies
    if (this._isDelegate) {
      // For delegate, check via count query
      if (this._adapter.count) {
        const existing = await this._adapter.count(this.name, [
          { field: 'id', op: 'eq', value: typed.id },
        ])
        if (existing > 0) {
          throw new Error(`Document with id "${typed.id}" already exists`)
        }
      }
    } else {
      await this._ensureLoaded()
      if (this._docs.has(typed.id)) {
        throw new Error(`Document with id "${typed.id}" already exists`)
      }
    }

    if (this._isDelegate && this._adapter.insertOne) {
      const raw = await this._adapter.insertOne(
        this.name,
        dehydrateDoc(typed) as Record<string, unknown>,
      )
      const result = hydrateDoc(raw as T, this.schema._fields) as T
      await this._runHooks('after:insert', result)
      return result
    }

    // Cache strategy
    this._docs.set(typed.id, typed)
    this._updateIndexes(typed, 'add')
    await this._persist()

    await this._runHooks('after:insert', typed)
    return typed
  }

  /**
   * Update documents matching a partial filter.
   * Returns the number of documents updated.
   */
  async update(filter: Partial<T>, changes: Partial<T>): Promise<number> {
    // Run before:update hooks
    await this._runHooks('before:update', filter, changes)

    // Validate changes against schema (always, both strategies)
    const errors = validateDocument(
      { ...changes } as Record<string, unknown>,
      this.schema._fields,
    )
    if (errors.length > 0) {
      // Filter out "Missing required field" errors for partial updates
      const realErrors = errors.filter(
        (e) => !e.startsWith('Missing required field') && !e.startsWith('Unknown field'),
      )
      if (realErrors.length > 0) {
        throw new TypeError(`Validation failed on update:\n${realErrors.join('\n')}`)
      }
    }

    if (this._isDelegate && this._adapter.updateMany) {
      const filterClauses = partialToClauses(filter)
      const count = await this._adapter.updateMany(
        this.name,
        filterClauses,
        changes as Record<string, unknown>,
      )
      await this._runHooks('after:update', filter, changes, count)
      return count
    }

    // Cache strategy
    await this._ensureLoaded()

    let count = 0
    for (const [, doc] of this._docs) {
      if (matchesFilter(doc, filter)) {
        const updated = { ...doc, ...changes }
        const errors = validateDocument(
          updated as unknown as Record<string, unknown>,
          this.schema._fields,
        )
        if (errors.length > 0) {
          throw new TypeError(`Validation failed on update:\n${errors.join('\n')}`)
        }
        this._updateIndexes(doc, 'remove')
        this._docs.set(updated.id, updated)
        this._updateIndexes(updated, 'add')
        count++
      }
    }

    if (count > 0) {
      await this._persist()
    }

    await this._runHooks('after:update', filter, changes, count)
    return count
  }

  /**
   * Delete documents matching a partial filter.
   * Returns the number of documents deleted.
   */
  async delete(filter: Partial<T>): Promise<number> {
    // Run before:delete hooks
    await this._runHooks('before:delete', filter)

    if (this._isDelegate && this._adapter.deleteMany) {
      const filterClauses = partialToClauses(filter)
      const count = await this._adapter.deleteMany(this.name, filterClauses)
      await this._runHooks('after:delete', filter, count)
      return count
    }

    // Cache strategy
    await this._ensureLoaded()

    const toDelete: string[] = []
    for (const [id, doc] of this._docs) {
      if (matchesFilter(doc, filter)) {
        toDelete.push(id)
      }
    }

    for (const id of toDelete) {
      const doc = this._docs.get(id)
      if (doc) this._updateIndexes(doc, 'remove')
      this._docs.delete(id)
    }

    if (toDelete.length > 0) {
      await this._persist()
    }

    await this._runHooks('after:delete', filter, toDelete.length)
    return toDelete.length
  }

  /**
   * Find all documents matching a partial filter.
   */
  async find(filter?: Partial<T>): Promise<T[]> {
    const filters: FilterClause[] = filter ? partialToClauses(filter) : []
    return this._executeQuery({
      filter: filters.length > 0 ? filters : undefined,
    })
  }

  /**
   * Find the first document matching a partial filter.
   */
  async first(filter?: Partial<T>): Promise<T | null> {
    const filters: FilterClause[] = filter ? partialToClauses(filter) : []
    const results = await this._executeQuery({
      filter: filters.length > 0 ? filters : undefined,
      limit: 1,
    })
    return results[0] ?? null
  }

  // -----------------------------------------------------------------------
  // Aggregation
  // -----------------------------------------------------------------------

  /**
   * Count all documents (optionally matching a filter).
   */
  async count(filter?: Partial<T>): Promise<number> {
    const filters: FilterClause[] = filter ? partialToClauses(filter) : []
    return this._count(filters.length > 0 ? filters : undefined)
  }

  /**
   * Sum the values of a numeric field across all matching documents.
   */
  async sum(field: keyof T & string, filter?: Partial<T>): Promise<number> {
    if (this._isDelegate && this._adapter.aggregate) {
      const result = await this._adapter.aggregate(this.name, [
        filter ? { $match: filter as Record<string, unknown> } : ({} as any),
        { $group: { _id: null, value: { $sum: `$${field}` } as Record<string, unknown> } },
      ].filter(Boolean))
      const arr = result as unknown as Array<{ value: number }>
      return arr[0]?.value ?? 0
    }

    await this._ensureLoaded()
    let docs = Array.from(this._docs.values())
    if (filter) {
      docs = docs.filter((doc) => matchesFilter(doc, filter))
    }
    return docs.reduce((acc, doc) => {
      const val = (doc as Record<string, unknown>)[field as string]
      return acc + (typeof val === 'number' ? val : 0)
    }, 0)
  }

  /**
   * Average the values of a numeric field across all matching documents.
   */
  async avg(field: keyof T & string, filter?: Partial<T>): Promise<number> {
    if (this._isDelegate && this._adapter.aggregate) {
      const result = await this._adapter.aggregate(this.name, [
        filter ? { $match: filter as Record<string, unknown> } : ({} as any),
        { $group: { _id: null, value: { $avg: `$${field}` } as Record<string, unknown> } },
      ].filter(Boolean))
      const arr = result as unknown as Array<{ value: number }>
      return arr[0]?.value ?? 0
    }

    await this._ensureLoaded()
    let docs = Array.from(this._docs.values())
    if (filter) {
      docs = docs.filter((doc) => matchesFilter(doc, filter))
    }
    if (docs.length === 0) return 0
    const sum = docs.reduce((acc, doc) => {
      const val = (doc as Record<string, unknown>)[field as string]
      return acc + (typeof val === 'number' ? val : 0)
    }, 0)
    return sum / docs.length
  }

  /**
   * Find the minimum value of a field across all matching documents.
   */
  async min(field: keyof T & string, filter?: Partial<T>): Promise<number | null> {
    if (this._isDelegate && this._adapter.aggregate) {
      const result = await this._adapter.aggregate(this.name, [
        filter ? { $match: filter as Record<string, unknown> } : ({} as any),
        { $group: { _id: null, value: { $min: `$${field}` } as Record<string, unknown> } },
      ].filter(Boolean))
      const arr = result as unknown as Array<{ value: number }>
      return arr[0]?.value ?? null
    }

    await this._ensureLoaded()
    let docs = Array.from(this._docs.values())
    if (filter) {
      docs = docs.filter((doc) => matchesFilter(doc, filter))
    }
    if (docs.length === 0) return null
    let minVal: number | null = null
    for (const doc of docs) {
      const val = (doc as Record<string, unknown>)[field as string]
      if (typeof val === 'number' && (minVal === null || val < minVal)) {
        minVal = val
      }
    }
    return minVal
  }

  /**
   * Find the maximum value of a field across all matching documents.
   */
  async max(field: keyof T & string, filter?: Partial<T>): Promise<number | null> {
    if (this._isDelegate && this._adapter.aggregate) {
      const result = await this._adapter.aggregate(this.name, [
        filter ? { $match: filter as Record<string, unknown> } : ({} as any),
        { $group: { _id: null, value: { $max: `$${field}` } as Record<string, unknown> } },
      ].filter(Boolean))
      const arr = result as unknown as Array<{ value: number }>
      return arr[0]?.value ?? null
    }

    await this._ensureLoaded()
    let docs = Array.from(this._docs.values())
    if (filter) {
      docs = docs.filter((doc) => matchesFilter(doc, filter))
    }
    if (docs.length === 0) return null
    let maxVal: number | null = null
    for (const doc of docs) {
      const val = (doc as Record<string, unknown>)[field as string]
      if (typeof val === 'number' && (maxVal === null || val > maxVal)) {
        maxVal = val
      }
    }
    return maxVal
  }

  // -----------------------------------------------------------------------
  // Indexing
  // -----------------------------------------------------------------------

  /**
   * Create an index on a field.
   * In Cache strategy, this builds an in-memory Map index.
   * In Delegate strategy, this delegates to the adapter.
   */
  async createIndex(field: string, options?: { unique?: boolean }): Promise<void> {
    if (this._isDelegate && this._adapter.createIndex) {
      await this._adapter.createIndex(this.name, field, options)
      return
    }

    // Cache strategy: build the index from existing docs
    await this._ensureLoaded()
    const idx = new Map<unknown, Set<string>>()
    for (const doc of this._docs.values()) {
      const value = (doc as Record<string, unknown>)[field]
      let ids = idx.get(value)
      if (!ids) {
        ids = new Set()
        idx.set(value, ids)
      }
      ids.add(doc.id)
    }
    this._indexes.set(field, idx)
  }

  /**
   * Drop an index on a field.
   */
  async dropIndex(field: string): Promise<void> {
    if (this._isDelegate && this._adapter.dropIndex) {
      await this._adapter.dropIndex(this.name, field)
      return
    }

    this._indexes.delete(field)
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async _runHooks(
    event: HookEvent,
    ...args: any[]
  ): Promise<void> {
    const handlers = this._hooks[event]
    if (!handlers) return
    for (const handler of handlers) {
      await (handler as (...a: any[]) => Promise<void>)(...args)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a document matches a partial filter (all key/value pairs match).
 */
function matchesFilter<T extends DocWithId>(doc: T, filter: Partial<T>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    const docValue = (doc as Record<string, unknown>)[key]
    if (docValue !== value) return false
  }
  return true
}

/**
 * Convert a partial document filter into FilterClause array.
 */
function partialToClauses<T extends DocWithId>(filter: Partial<T>): FilterClause[] {
  return Object.entries(filter).map(([field, value]) => ({
    field,
    op: 'eq' as FilterOp,
    value,
  }))
}

/**
 * Hydrate a raw document from storage by converting date strings back to Date objects.
 */
function hydrateDoc<T extends DocWithId>(doc: T, fields: Record<string, FieldDef>): T {
  const result = { ...doc } as Record<string, unknown>

  for (const [key, def] of Object.entries(fields)) {
    if (def.type === 'date' && typeof result[key] === 'string') {
      result[key] = new Date(result[key] as string)
    }
    // Recursively hydrate nested objects
    if (def.type === 'object' && def.fields && isPlainObject(result[key])) {
      result[key] = hydrateDoc(
        result[key] as unknown as T,
        def.fields,
      )
    }
    // Hydrate array of objects
    if (def.type === 'array' && def.itemField?.type === 'object' && def.itemField.fields && Array.isArray(result[key])) {
      result[key] = (result[key] as unknown[]).map((item) =>
        isPlainObject(item)
          ? hydrateDoc(item as unknown as T, def.itemField!.fields!)
          : item,
      )
    }
  }

  return result as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Dehydrate a document for storage by converting Date objects to ISO strings.
 */
function dehydrateDoc<T extends DocWithId>(doc: T): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(doc)) {
    if (value instanceof Date) {
      result[key] = value.toISOString()
    } else if (isPlainObject(value)) {
      result[key] = dehydrateDoc(value as unknown as T)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item instanceof Date
          ? item.toISOString()
          : isPlainObject(item)
            ? dehydrateDoc(item as unknown as T)
            : item,
      )
    } else {
      result[key] = value
    }
  }

  return result
}
