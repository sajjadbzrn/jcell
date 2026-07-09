import type { DocWithId, StorageAdapter, FilterClause } from './types'
import type { FieldDef } from './schema'
import type { SchemaInstance } from './schema'
import { validateDocument, applyDefaults } from './validator'

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

/**
 * A pending query that can be refined with more filters and then executed.
 */
export class QueryBuilder<T extends DocWithId> {
  private _filters: FilterClause[] = []

  constructor(private _collection: Collection<T>) {}

  /**
   * Start a filter on a specific field. Chain `.eq()`, `.gt()`, `.lt()`, `.in()`.
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
   * Execute the query and return all matching documents.
   */
  async find(): Promise<T[]> {
    const all = await this._collection._allDocs()
    return all.filter((doc) => this._matches(doc))
  }

  /**
   * Execute the query and return the first matching document, or null.
   */
  async first(): Promise<T | null> {
    const all = await this._collection._allDocs()
    const match = all.find((doc) => this._matches(doc))
    return match ?? null
  }

  /**
   * Check if a document matches all filters.
   */
  private _matches(doc: T): boolean {
    return this._filters.every((clause) => {
      const value = (doc as Record<string, unknown>)[clause.field]
      switch (clause.op) {
        case 'eq':
          return value === clause.value
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
        default:
          return false
      }
    })
  }
}

/**
 * A field-specific filter that lets you chain `.eq()`, `.gt()`, `.lt()`, `.in()`.
 */
export class FieldFilter<T extends DocWithId> {
  constructor(
    private _query: QueryBuilder<T>,
    private _field: string,
  ) {}

  eq(value: unknown): QueryBuilder<T> {
    return this._query._addFilter({ field: this._field, op: 'eq', value })
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
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * A typed collection that wraps a storage adapter with schema validation.
 */
export class Collection<T extends DocWithId> {
  /** In-memory document cache, keyed by id. */
  private _docs = new Map<string, T>()
  /** Whether the cache has been hydrated from storage. */
  private _loaded = false

  constructor(
    readonly name: string,
    readonly schema: SchemaInstance<T>,
    private _adapter: StorageAdapter,
  ) {}

  /**
   * Ensure the in-memory cache is loaded from storage.
   */
  async _ensureLoaded(): Promise<void> {
    if (this._loaded) return
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
        this._docs.set(id, hydrateDoc(doc as T, this.schema._fields))
      }
    }
  }

  /**
   * Return all documents from the in-memory cache (internal).
   */
  async _allDocs(): Promise<T[]> {
    await this._ensureLoaded()
    return Array.from(this._docs.values())
  }

  /**
   * Persist the in-memory cache to storage.
   */
  private async _persist(): Promise<void> {
    const docs = Array.from(this._docs.values())
    const raw = JSON.stringify(
      docs.map((d) => dehydrateDoc(d)),
      null,
      2,
    )
    await this._adapter.write(this.name, raw)
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Create a query builder scoped to this collection.
   */
  where(field: keyof T & string): FieldFilter<T> {
    const qb = new QueryBuilder<T>(this)
    return new FieldFilter(qb, field)
  }

  /**
   * Insert a document into the collection.
   * Returns the inserted document with all defaults and generated id applied.
   */
  async insert(doc: Partial<T>): Promise<T> {
    await this._ensureLoaded()

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

    const typed = hydrateDoc(hydrated as T, this.schema._fields)

    // Check for id collision
    if (this._docs.has(typed.id)) {
      throw new Error(`Document with id "${typed.id}" already exists`)
    }

    this._docs.set(typed.id, typed)
    await this._persist()
    return typed
  }

  /**
   * Update documents matching a partial filter.
   * Returns the number of documents updated.
   */
  async update(filter: Partial<T>, changes: Partial<T>): Promise<number> {
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
        this._docs.set(updated.id, updated)
        count++
      }
    }

    if (count > 0) {
      await this._persist()
    }

    return count
  }

  /**
   * Delete documents matching a partial filter.
   * Returns the number of documents deleted.
   */
  async delete(filter: Partial<T>): Promise<number> {
    await this._ensureLoaded()

    const toDelete: string[] = []
    for (const [id, doc] of this._docs) {
      if (matchesFilter(doc, filter)) {
        toDelete.push(id)
      }
    }

    for (const id of toDelete) {
      this._docs.delete(id)
    }

    if (toDelete.length > 0) {
      await this._persist()
    }

    return toDelete.length
  }

  /**
   * Find all documents matching a partial filter.
   */
  async find(filter?: Partial<T>): Promise<T[]> {
    await this._ensureLoaded()

    if (!filter) {
      return Array.from(this._docs.values())
    }

    return Array.from(this._docs.values()).filter((doc) => matchesFilter(doc, filter))
  }

  /**
   * Find the first document matching a partial filter.
   */
  async first(filter?: Partial<T>): Promise<T | null> {
    await this._ensureLoaded()

    if (!filter) {
      const first = this._docs.values().next()
      return first.done ? null : first.value
    }

    for (const doc of this._docs.values()) {
      if (matchesFilter(doc, filter)) {
        return doc
      }
    }

    return null
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
 * Hydrate a raw document from storage by converting date strings back to Date objects.
 */
function hydrateDoc<T extends DocWithId>(doc: T, fields: Record<string, FieldDef>): T {
  const result = { ...doc } as Record<string, unknown>

  for (const [key, def] of Object.entries(fields)) {
    if (def.type === 'date' && typeof result[key] === 'string') {
      result[key] = new Date(result[key] as string)
    }
  }

  return result as T
}

/**
 * Dehydrate a document for storage by converting Date objects to ISO strings.
 */
function dehydrateDoc<T extends DocWithId>(doc: T): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(doc)) {
    if (value instanceof Date) {
      result[key] = value.toISOString()
    } else {
      result[key] = value
    }
  }

  return result
}
