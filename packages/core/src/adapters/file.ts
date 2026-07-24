import type { StorageAdapter, FilterClause, QueryParams, AggregateStage } from '../types'
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Internal queue – serialize writes per collection
// ---------------------------------------------------------------------------

class WriteQueue {
  private _queues = new Map<string, Promise<void>>()

  enqueue(collection: string, fn: () => Promise<void>): Promise<void> {
    const prev = this._queues.get(collection) ?? Promise.resolve()
    const next = prev
      .then(fn)
      .then(() => {
        if (this._queues.get(collection) === next) {
          this._queues.delete(collection)
        }
      })
    this._queues.set(collection, next)
    return next
  }
}

// ---------------------------------------------------------------------------
// File adapter
// ---------------------------------------------------------------------------

export interface FileAdapterConfig {
  /** Directory to store collection files. Defaults to `./data`. */
  path?: string
}

/**
 * Create a file-system storage adapter with:
 * - Atomic writes (write to temp, rename over target)
 * - Single-writer queue per collection
 * - Crash recovery via `.bak` fallback
 * - Optional pro query interface (in-memory filtering on top of file reads)
 */
export function fileAdapter(config: FileAdapterConfig = {}): StorageAdapter {
  const dataDir = config.path ?? './data'
  const queue = new WriteQueue()

  function collectionPath(name: string): string {
    return join(dataDir, `${name}.json`)
  }

  function backupPath(name: string): string {
    return join(dataDir, `${name}.json.bak`)
  }

  async function ensureDir(): Promise<void> {
    if (!existsSync(dataDir)) {
      await mkdir(dataDir, { recursive: true })
    }
  }

  async function atomicWrite(filePath: string, data: string): Promise<void> {
    const tmpPath = filePath + '.tmp'
    await writeFile(tmpPath, data, 'utf-8')
    await rename(tmpPath, filePath)
  }

  async function readWithFallback(
    filePath: string,
    backupFilePath: string,
  ): Promise<string | null> {
    if (!existsSync(filePath)) return null

    try {
      const content = await readFile(filePath, 'utf-8')
      JSON.parse(content)
      return content
    } catch {
      // corrupted – try backup
    }

    if (!existsSync(backupFilePath)) return null

    try {
      const content = await readFile(backupFilePath, 'utf-8')
      JSON.parse(content)
      return content
    } catch {
      return null
    }
  }

  // -----------------------------------------------------------------------
  // Shared helpers for pro methods
  // -----------------------------------------------------------------------

  async function getDocs(collection: string): Promise<Record<string, unknown>[]> {
    const raw = await readWithFallback(
      collectionPath(collection),
      backupPath(collection),
    )
    if (!raw) return []
    try {
      return JSON.parse(raw) as Record<string, unknown>[]
    } catch {
      return []
    }
  }

  async function setDocs(
    collection: string,
    docs: Record<string, unknown>[],
  ): Promise<void> {
    await ensureDir()
    const filePath = collectionPath(collection)
    const backupFilePath = backupPath(collection)
    const data = JSON.stringify(docs, null, 2)

    await queue.enqueue(collection, async () => {
      if (existsSync(filePath)) {
        try {
          const currentData = await readFile(filePath, 'utf-8')
          await writeFile(backupFilePath, currentData, 'utf-8')
        } catch {
          // best-effort backup
        }
      }
      await atomicWrite(filePath, data)
    })
  }

  function matchClause(doc: Record<string, unknown>, clause: FilterClause): boolean {
    const value = doc[clause.field]
    switch (clause.op) {
      case 'eq':
        return value === clause.value
      case 'ne':
        return value !== clause.value
      case 'gt':
        return typeof value === 'number' && typeof clause.value === 'number'
          ? value > clause.value
          : false
      case 'gte':
        return typeof value === 'number' && typeof clause.value === 'number'
          ? value >= clause.value
          : false
      case 'lt':
        return typeof value === 'number' && typeof clause.value === 'number'
          ? value < clause.value
          : false
      case 'lte':
        return typeof value === 'number' && typeof clause.value === 'number'
          ? value <= clause.value
          : false
      case 'in': {
        const arr = clause.value as unknown[]
        return arr.includes(value)
      }
      case 'contains':
        return typeof value === 'string' && typeof clause.value === 'string'
          ? value.includes(clause.value)
          : false
      case 'startsWith':
        return typeof value === 'string' && typeof clause.value === 'string'
          ? value.startsWith(clause.value)
          : false
      default:
        return false
    }
  }

  function matchesFilters(
    doc: Record<string, unknown>,
    filters: FilterClause[],
  ): boolean {
    return filters.every((clause) => matchClause(doc, clause))
  }

  function matchesLogicalQuery(
    doc: Record<string, unknown>,
    andFilters?: FilterClause[],
    orFilters?: FilterClause[],
  ): boolean {
    const hasAnd = !!(andFilters && andFilters.length > 0)
    const hasOr = !!(orFilters && orFilters.length > 0)
    if (!hasAnd && !hasOr) return true
    if (hasAnd && !hasOr) return matchesFilters(doc, andFilters!)
    if (!hasAnd && hasOr) return orFilters!.some((clause) => matchClause(doc, clause))
    return matchesFilters(doc, andFilters!) || orFilters!.some((clause) => matchClause(doc, clause))
  }

  function sortDocs(
    docs: Record<string, unknown>[],
    orderBy: NonNullable<QueryParams['orderBy']>,
  ): Record<string, unknown>[] {
    return [...docs].sort((a, b) => {
      for (const { field, direction } of orderBy) {
        const aVal = a[field]
        const bVal = b[field]
        if (aVal === bVal) continue
        if (aVal == null) return 1
        if (bVal == null) return -1
        const cmp =
          typeof aVal === 'number' && typeof bVal === 'number'
            ? aVal - bVal
            : String(aVal).localeCompare(String(bVal))
        return direction === 'asc' ? cmp : -cmp
      }
      return 0
    })
  }

  return {
    // -------------------------------------------------------------------
    // Basic interface
    // -------------------------------------------------------------------

    async read(collection: string): Promise<string | null> {
      return readWithFallback(collectionPath(collection), backupPath(collection))
    },

    async write(collection: string, data: string): Promise<void> {
      await ensureDir()
      const filePath = collectionPath(collection)
      const backupFilePath = backupPath(collection)

      await queue.enqueue(collection, async () => {
        if (existsSync(filePath)) {
          try {
            const currentData = await readFile(filePath, 'utf-8')
            await writeFile(backupFilePath, currentData, 'utf-8')
          } catch {
            // best-effort backup
          }
        }
        await atomicWrite(filePath, data)
      })
    },

    async exists(collection: string): Promise<boolean> {
      return existsSync(collectionPath(collection))
    },

    async delete(collection: string): Promise<void> {
      const filePath = collectionPath(collection)
      const backupFilePath = backupPath(collection)

      await queue.enqueue(collection, async () => {
        if (existsSync(filePath)) await unlink(filePath)
        if (existsSync(backupFilePath)) await unlink(backupFilePath)
      })
    },

    // -------------------------------------------------------------------
    // Pro interface
    // -------------------------------------------------------------------

    async query(collection: string, params: QueryParams): Promise<Record<string, unknown>[]> {
      let docs = await getDocs(collection)

      const hasAnd = !!(params.filter && params.filter.length > 0)
      const hasOr = !!(params.orFilter && params.orFilter.length > 0)
      if (hasAnd || hasOr) {
        docs = docs.filter((doc) => matchesLogicalQuery(doc, params.filter, params.orFilter))
      }

      if (params.orderBy && params.orderBy.length > 0) {
        docs = sortDocs(docs, params.orderBy)
      }

      if (params.offset !== undefined) {
        docs = docs.slice(params.offset)
      }

      if (params.limit !== undefined) {
        docs = docs.slice(0, params.limit)
      }

      if (params.select && params.select.length > 0) {
        docs = docs.map((doc) => {
          const projected: Record<string, unknown> = {}
          for (const f of params.select!) {
            if (f in doc) projected[f] = doc[f]
          }
          return projected
        })
      }

      return docs
    },

    async insertOne(
      collection: string,
      doc: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const docs = await getDocs(collection)
      docs.push(doc)
      await setDocs(collection, docs)
      return doc
    },

    async updateMany(
      collection: string,
      filter: FilterClause[],
      changes: Record<string, unknown>,
    ): Promise<number> {
      const docs = await getDocs(collection)
      let count = 0
      for (const doc of docs) {
        if (matchesFilters(doc, filter)) {
          Object.assign(doc, changes)
          count++
        }
      }
      if (count > 0) await setDocs(collection, docs)
      return count
    },

    async deleteMany(
      collection: string,
      filter: FilterClause[],
    ): Promise<number> {
      const docs = await getDocs(collection)
      const before = docs.length
      const filtered = docs.filter((doc) => !matchesFilters(doc, filter))
      const count = before - filtered.length
      if (count > 0) await setDocs(collection, filtered)
      return count
    },

    async count(collection: string, filter?: FilterClause[]): Promise<number> {
      let docs = await getDocs(collection)
      if (filter && filter.length > 0) {
        docs = docs.filter((doc) => matchesFilters(doc, filter))
      }
      return docs.length
    },

    async aggregate(
      collection: string,
      pipeline: AggregateStage[],
    ): Promise<unknown> {
      let docs = await getDocs(collection)

      for (const stage of pipeline) {
        if ('$match' in stage) {
          const filter = stage.$match
          docs = docs.filter((doc) => {
            for (const [key, value] of Object.entries(filter)) {
              if (doc[key] !== value) return false
            }
            return true
          })
        } else if ('$group' in stage) {
          const group = stage.$group
          const result: Record<string, unknown> = { _id: null }
          for (const [key, expr] of Object.entries(group)) {
            if (key === '_id') continue
            const exprObj = expr as Record<string, unknown>
            if ('$sum' in exprObj) {
              const field = (exprObj.$sum as string).replace('$', '')
              result[key] = docs.reduce(
                (acc, doc) => acc + (typeof doc[field] === 'number' ? (doc[field] as number) : 0),
                0,
              )
            } else if ('$avg' in exprObj) {
              const field = (exprObj.$avg as string).replace('$', '')
              if (docs.length === 0) {
                result[key] = 0
              } else {
                const sum = docs.reduce(
                  (acc, doc) => acc + (typeof doc[field] === 'number' ? (doc[field] as number) : 0),
                  0,
                )
                result[key] = sum / docs.length
              }
            } else if ('$min' in exprObj) {
              const field = (exprObj.$min as string).replace('$', '')
              let minVal: number | null = null
              for (const doc of docs) {
                const val = doc[field]
                if (typeof val === 'number' && (minVal === null || val < minVal)) minVal = val
              }
              result[key] = minVal
            } else if ('$max' in exprObj) {
              const field = (exprObj.$max as string).replace('$', '')
              let maxVal: number | null = null
              for (const doc of docs) {
                const val = doc[field]
                if (typeof val === 'number' && (maxVal === null || val > maxVal)) maxVal = val
              }
              result[key] = maxVal
            }
          }
          docs = [result]
        } else if ('$count' in stage) {
          docs = [{ count: docs.length }]
        } else if ('$limit' in stage) {
          docs = docs.slice(0, stage.$limit)
        } else if ('$skip' in stage) {
          docs = docs.slice(stage.$skip)
        }
      }

      return docs
    },

    async ensureCollection(_name: string, _fields: Record<string, unknown>): Promise<void> {
      await ensureDir()
    },

    async createIndex(
      _collection: string,
      _field: string,
      _options?: { unique?: boolean },
    ): Promise<void> {
      // File adapter doesn't support native indexes — no-op
    },

    async dropIndex(_collection: string, _field: string): Promise<void> {
      // File adapter doesn't support native indexes — no-op
    },
  }
}
