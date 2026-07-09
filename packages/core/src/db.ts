import type { DBConfig, DocWithId, StorageAdapter } from './types'
import type { SchemaInstance } from './schema'
import { Collection } from './query-engine'

/**
 * The main database instance.
 */
export class DB {
  private _collections = new Map<string, Collection<DocWithId>>()
  private _adapter: StorageAdapter

  constructor(config: DBConfig) {
    this._adapter = config.adapter
  }

  /**
   * Register or retrieve a typed collection.
   *
   * ```ts
   * const users = db.collection('users', userSchema)
   * ```
   */
  collection<T extends DocWithId>(
    name: string,
    schema: SchemaInstance<T>,
  ): Collection<T> {
    const existing = this._collections.get(name)
    if (existing) {
      return existing as unknown as Collection<T>
    }

    const col = new Collection<T>(name, schema, this._adapter)
    this._collections.set(name, col as unknown as Collection<DocWithId>)
    return col
  }
}

/**
 * Create a new database instance.
 *
 * ```ts
 * const db = createDB({ adapter: fileAdapter({ path: './data' }) })
 * ```
 */
export function createDB(config: DBConfig): DB {
  return new DB(config)
}
