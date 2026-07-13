import type {
  DBConfig,
  DocWithId,
  StorageAdapter,
  Migration,
} from './types'
import type { SchemaInstance } from './schema'
import { Collection } from './query-engine'
import { schema, t } from './schema'

/**
 * The main database instance.
 */
export class DB {
  private _collections = new Map<string, Collection<DocWithId>>()
  private _adapter: StorageAdapter
  private _connected = false

  constructor(config: DBConfig) {
    this._adapter = config.adapter
  }

  /**
   * Get the underlying storage adapter.
   */
  get adapter(): StorageAdapter {
    return this._adapter
  }

  /**
   * Initialize the adapter (e.g. open a DB connection).
   * Call this before using the database with adapters that need connection setup.
   */
  async connect(): Promise<void> {
    if (this._connected) return
    if (this._adapter.connect) {
      await this._adapter.connect()
    }
    this._connected = true
  }

  /**
   * Tear down the adapter (e.g. close a DB connection).
   */
  async disconnect(): Promise<void> {
    if (!this._connected) return
    if (this._adapter.disconnect) {
      await this._adapter.disconnect()
    }
    this._connected = false
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

  /**
   * Run a set of operations within a transaction.
   * Only supported by adapters that implement the `transaction` method.
   *
   * ```ts
   * await db.transaction(async (tx) => {
   *   await tx.collection('accounts').update({ id: 'a1' }, { balance: 50 })
   *   await tx.collection('accounts').update({ id: 'a2' }, { balance: -50 })
   * })
   * ```
   */
  async transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
    if (!this._adapter.transaction) {
      throw new Error(
        'Transactions are not supported by this adapter. Use an adapter that implements the `transaction` method (e.g. D1).',
      )
    }

    return this._adapter.transaction(async (txAdapter) => {
      // Create a scoped DB that shares collections but uses the transaction adapter
      const txDB = new DB({ adapter: txAdapter })

      // Copy over existing collection registrations to the tx DB
      for (const [name, col] of this._collections) {
        txDB._collections.set(
          name,
          new Collection(name, col.schema, txAdapter) as unknown as Collection<DocWithId>,
        )
      }

      return fn(txDB)
    })
  }

  /**
   * Run pending migrations.
   *
   * Migrations are plain objects with `up` and optional `down` methods.
   * Applied migrations are tracked in the `_migrations` collection.
   *
   * ```ts
   * import { createMigration } from '@sajjadbzn/jcell'
   *
   * const m001 = createMigration({
   *   async up(db) {
   *     // Create collections, add indexes, etc.
   *   },
   *   async down(db) {
   *     // Rollback
   *   },
   * })
   *
   * await db.migrate([m001])
   * ```
   */
  async migrate(migrations: Migration[]): Promise<void> {
    // Use a simple schema for tracking migrations
    const migrationSchema = schema({
      id: t.id(),
      name: t.string(),
      appliedAt: t.date().default(() => new Date()),
    })

    const migCol = this.collection('_migrations', migrationSchema)
    const applied = await migCol.find()
    const appliedNames = new Set(applied.map((m: Record<string, unknown>) => m['name'] as string))

    for (const migration of migrations) {
      // Derive a name from the function or use the index
      const name = (migration as any)._name ?? `migration_${migrations.indexOf(migration)}`

      if (appliedNames.has(name)) continue

      await migration.up(this)
      await migCol.insert({ name } as Partial<Record<string, unknown>> as any)
    }
  }
}

/**
 * Create a named migration object.
 *
 * ```ts
 * const m001 = createMigration('001_create_users', {
 *   async up(db) { ... },
 *   async down(db) { ... },
 * })
 * ```
 */
export function createMigration(
  name: string,
  def: { up: Migration['up']; down?: Migration['down'] },
): Migration {
  ;(def as any)._name = name
  return def as Migration
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
