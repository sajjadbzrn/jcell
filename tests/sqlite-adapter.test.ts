import { describe, it, expect, beforeEach, afterEach, afterAll } from 'bun:test'
import { createDB, schema, t, sqliteAdapter, NotFoundError } from '../packages/core/src/index.js'
import { unlinkSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Graceful skip if better-sqlite3 native addon is unavailable
// ---------------------------------------------------------------------------

let canRun = false
try {
  // Quick smoke test: verify the native addon loads and works
  const Database = require('better-sqlite3')
  const sdb = new Database(':memory:')
  sdb.exec('SELECT 1')
  sdb.close()
  canRun = true
} catch {
  console.warn('better-sqlite3 native addon not available - skipping SQLite adapter tests')
}

const run = canRun ? describe : describe.skip

// ---------------------------------------------------------------------------
// Test setup — each test gets a fresh DB file
// ---------------------------------------------------------------------------

const testDir = join(import.meta.dir, '.test-data-sqlite')

const userSchema = schema({
  id: t.id(),
  name: t.string(),
  age: t.number().optional(),
  score: t.number().default(0),
  role: t.enum(['admin', 'user', 'guest'] as const),
  email: t.string().optional(),
})

type User = typeof userSchema.infer

const accountSchema = schema({
  id: t.id(),
  name: t.string(),
  balance: t.number(),
})

type Account = typeof accountSchema.infer

run('SQLite adapter', () => {
  let db: ReturnType<typeof createDB>
  let users: ReturnType<typeof db.collection<User>>
  let dbPath: string

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }
    dbPath = join(testDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    db = createDB({ adapter: sqliteAdapter({ path: dbPath }) })
    users = db.collection('users', userSchema)
  })

  afterEach(() => {
    if (db) {
      db.disconnect().catch(() => {})
    }
    try {
      if (existsSync(dbPath)) unlinkSync(dbPath)
      if (existsSync(dbPath + '-wal')) unlinkSync(dbPath + '-wal')
      if (existsSync(dbPath + '-shm')) unlinkSync(dbPath + '-shm')
    } catch {}
  })

  afterAll(() => {
    if (existsSync(testDir)) {
      try { rmSync(testDir, { recursive: true, force: true }) } catch {}
    }
  })

  // -----------------------------------------------------------------------
  // Basic CRUD
  // -----------------------------------------------------------------------

  describe('insert', () => {
    it('inserts a document and returns it with id', async () => {
      const user = await users.insert({ name: 'Alice', age: 30, role: 'admin' })
      expect(user.id).toBeDefined()
      expect(user.name).toBe('Alice')
      expect(user.age).toBe(30)
      expect(user.role).toBe('admin')
    })

    it('generates id automatically', async () => {
      const user = await users.insert({ name: 'Bob', role: 'user' })
      expect(typeof user.id).toBe('string')
      expect(user.id.length).toBeGreaterThan(0)
    })

    it('applies defaults', async () => {
      const user = await users.insert({ name: 'Charlie', role: 'guest' })
      expect(user.score).toBe(0)
    })

    it('rejects duplicates with same id', async () => {
      const user = await users.insert({ name: 'First', role: 'admin' })
      expect(
        users.insert({ id: user.id, name: 'Second', role: 'user' } as User),
      ).rejects.toThrow()
    })

    it('rejects invalid documents', async () => {
      expect(
        users.insert({ name: 42 } as unknown as Partial<User>),
      ).rejects.toThrow()
    })
  })

  describe('find and first', () => {
    beforeEach(async () => {
      await users.insert({ name: 'Alice', age: 30, role: 'admin', score: 100 })
      await users.insert({ name: 'Bob', age: 25, role: 'user', score: 200 })
      await users.insert({ name: 'Charlie', age: 35, role: 'admin', score: 150 })
    })

    it('finds all documents', async () => {
      const all = await users.find()
      expect(all.length).toBe(3)
    })

    it('finds documents by filter', async () => {
      const admins = await users.find({ role: 'admin' })
      expect(admins.length).toBe(2)
      expect(admins.every((u: User) => u.role === 'admin')).toBe(true)
    })

    it('finds first document by filter', async () => {
      const first = await users.first({ role: 'admin' })
      expect(first).not.toBeNull()
      expect(first!.role).toBe('admin')
    })

    it('returns null when first finds nothing', async () => {
      const result = await users.first({ name: 'NonExistent' })
      expect(result).toBeNull()
    })
  })

  describe('update and delete', () => {
    let user: User

    beforeEach(async () => {
      user = await users.insert({ name: 'Alice', age: 30, role: 'admin', score: 100 })
      await users.insert({ name: 'Bob', age: 25, role: 'user', score: 200 })
    })

    it('updates a document by filter', async () => {
      const count = await users.update({ id: user.id }, { age: 31 })
      expect(count).toBe(1)
      const updated = await users.first({ id: user.id })
      expect(updated!.age).toBe(31)
      expect(updated!.name).toBe('Alice')
    })

    it('returns 0 when nothing matches', async () => {
      const count = await users.update({ id: 'non-existent' }, { age: 30 })
      expect(count).toBe(0)
    })

    it('deletes a document by filter', async () => {
      const count = await users.delete({ id: user.id })
      expect(count).toBe(1)
      const all = await users.find()
      expect(all.length).toBe(1)
    })

    it('returns 0 when nothing matches on delete', async () => {
      const count = await users.delete({ id: 'non-existent' })
      expect(count).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Query builder
  // -----------------------------------------------------------------------

  describe('query builder', () => {
    beforeEach(async () => {
      await users.insert({ name: 'Alice', age: 30, score: 100, role: 'admin' })
      await users.insert({ name: 'Bob', age: 25, score: 200, role: 'user' })
      await users.insert({ name: 'Charlie', age: 35, score: 150, role: 'admin' })
      await users.insert({ name: 'Diana', age: 20, score: 50, role: 'guest' })
    })

    it('filters with eq', async () => {
      const results = await users.where('name').eq('Alice').find()
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('Alice')
    })

    it('filters with gt', async () => {
      const results = await users.where('age').gt(28).find()
      expect(results.length).toBe(2)
    })

    it('filters with gte', async () => {
      const results = await users.where('age').gte(30).find()
      expect(results.length).toBe(2)
    })

    it('filters with lt', async () => {
      const results = await users.where('age').lt(26).find()
      expect(results.length).toBe(2)
    })

    it('filters with lte', async () => {
      const results = await users.where('age').lte(25).find()
      expect(results.length).toBe(2)
    })

    it('filters with ne', async () => {
      const results = await users.where('role').ne('admin').find()
      expect(results.length).toBe(2)
    })

    it('filters with in', async () => {
      const results = await users.where('role').in(['admin', 'guest']).find()
      expect(results.length).toBe(3)
    })

    it('filters with contains', async () => {
      const results = await users.where('name').contains('li').find()
      expect(results.length).toBe(2)
    })

    it('filters with startsWith', async () => {
      const results = await users.where('name').startsWith('A').find()
      expect(results.length).toBe(1)
    })

    it('chains multiple filters', async () => {
      const results = await users.where('role').eq('admin').where('age').gt(28).find()
      expect(results.length).toBe(2)
    })
  })

  describe('firstOrFail', () => {
    beforeEach(async () => {
      await users.insert({ name: 'Alice', role: 'admin' })
    })

    it('returns the document when found', async () => {
      const user = await users.firstOrFail({ name: 'Alice' })
      expect(user.name).toBe('Alice')
    })

    it('throws NotFoundError when not found', async () => {
      expect(users.firstOrFail({ name: 'NonExistent' })).rejects.toThrow(NotFoundError)
    })
  })

  // -----------------------------------------------------------------------
  // Sorting & Pagination
  // -----------------------------------------------------------------------

  describe('sorting', () => {
    beforeEach(async () => {
      await users.insert({ name: 'Alice', age: 30, score: 100, role: 'admin' })
      await users.insert({ name: 'Bob', age: 25, score: 200, role: 'user' })
      await users.insert({ name: 'Charlie', age: 35, score: 150, role: 'admin' })
      await users.insert({ name: 'Diana', age: 20, score: 50, role: 'guest' })
      await users.insert({ name: 'Eve', age: 28, score: 300, role: 'user' })
    })

    it('sorts ascending', async () => {
      const results = await users.orderBy('age').find()
      expect(results.map((u: User) => u.age)).toEqual([20, 25, 28, 30, 35])
    })

    it('sorts descending', async () => {
      const results = await users.orderByDesc('score').find()
      expect(results.map((u: User) => u.score)).toEqual([300, 200, 150, 100, 50])
    })

    it('chains sort with filter', async () => {
      const results = await users.where('role').eq('admin').orderByDesc('score').find()
      expect(results.length).toBe(2)
      expect(results[0]!.name).toBe('Charlie')
      expect(results[1]!.name).toBe('Alice')
    })
  })

  describe('pagination', () => {
    beforeEach(async () => {
      await users.insert({ name: 'Alice', age: 30, role: 'admin' })
      await users.insert({ name: 'Bob', age: 25, role: 'user' })
      await users.insert({ name: 'Charlie', age: 35, role: 'admin' })
      await users.insert({ name: 'Diana', age: 20, role: 'guest' })
      await users.insert({ name: 'Eve', age: 28, role: 'user' })
    })

    it('limits results', async () => {
      const results = await users.limit(2).find()
      expect(results.length).toBe(2)
    })

    it('offsets results', async () => {
      const page1 = await users.orderBy('name').limit(2).offset(0).find()
      const page2 = await users.orderBy('name').limit(2).offset(2).find()
      expect(page1[0]!.name).not.toBe(page2[0]!.name)
    })

    it('paginates with page()', async () => {
      const page1 = await users.orderBy('name').page(1, 2).find()
      expect(page1.length).toBe(2)
      const page3 = await users.orderBy('name').page(3, 2).find()
      expect(page3.length).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Aggregation
  // -----------------------------------------------------------------------

  describe('aggregation', () => {
    beforeEach(async () => {
      await users.insert({ name: 'Alice', age: 30, score: 100, role: 'admin' })
      await users.insert({ name: 'Bob', age: 25, score: 200, role: 'user' })
      await users.insert({ name: 'Charlie', age: 35, score: 150, role: 'admin' })
      await users.insert({ name: 'Diana', age: 20, score: 50, role: 'guest' })
      await users.insert({ name: 'Eve', age: 28, score: 300, role: 'user' })
    })

    it('counts all documents', async () => {
      expect(await users.count()).toBe(5)
    })

    it('counts with filter', async () => {
      expect(await users.count({ role: 'admin' })).toBe(2)
    })

    it('sums a field', async () => {
      expect(await users.sum('score')).toBe(800)
    })

    it('sums with filter', async () => {
      expect(await users.sum('score', { role: 'admin' })).toBe(250)
    })

    it('averages a field', async () => {
      expect(await users.avg('age')).toBe(27.6)
    })

    it('finds min value', async () => {
      expect(await users.min('age')).toBe(20)
    })

    it('finds max value', async () => {
      expect(await users.max('score')).toBe(300)
    })
  })

  // -----------------------------------------------------------------------
  // Logical operators (orWhere)
  // -----------------------------------------------------------------------

  describe('orWhere', () => {
    beforeEach(async () => {
      await users.insert({ name: 'Alice', age: 30, score: 100, role: 'admin' })
      await users.insert({ name: 'Bob', age: 25, score: 200, role: 'user' })
      await users.insert({ name: 'Charlie', age: 35, score: 150, role: 'admin' })
      await users.insert({ name: 'Diana', age: 20, score: 50, role: 'guest' })
      await users.insert({ name: 'Eve', age: 28, score: 300, role: 'user' })
    })

    it('returns docs matching either OR condition', async () => {
      const results = await users
        .where('role').eq('guest')
        .orWhere('age').gte(30)
        .find()
      expect(results.length).toBe(3)
    })

    it('works with only OR conditions', async () => {
      const results = await users
        .orWhere('age').lt(25)
        .orWhere('role').eq('admin')
        .find()
      expect(results.length).toBe(3)
    })

    it('counts correctly with orWhere', async () => {
      const c = await users
        .where('role').eq('admin')
        .orWhere('age').lt(25)
        .count()
      expect(c).toBe(3)
    })
  })

  // -----------------------------------------------------------------------
  // Indexes
  // -----------------------------------------------------------------------

  describe('indexes', () => {
    beforeEach(async () => {
      await users.insert({ name: 'Alice', age: 30, role: 'admin' })
      await users.insert({ name: 'Bob', age: 25, role: 'user' })
    })

    it('creates and uses an index', async () => {
      await users.createIndex('name')
      const result = await users.where('name').eq('Alice').first()
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Alice')
    })

    it('creates a unique index', async () => {
      await users.createIndex('email', { unique: true })
      const user = await users.first({ name: 'Alice' })
      await users.update({ id: user!.id }, { email: 'alice@example.com' } as Partial<User>)
      const found = await users.where('email').eq('alice@example.com').first()
      expect(found).not.toBeNull()
    })

    it('drops an index', async () => {
      await users.createIndex('name')
      await users.dropIndex('name')
      const result = await users.where('name').eq('Alice').first()
      expect(result).not.toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Schema management
  // -----------------------------------------------------------------------

  describe('schema management', () => {
    it('auto-creates table on first use', async () => {
      const item = await users.insert({ name: 'Test', role: 'admin' })
      expect(item.id).toBeDefined()
      const found = await users.find()
      expect(found.length).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Hooks
  // -----------------------------------------------------------------------

  describe('hooks', () => {
    it('fires before:insert and after:insert hooks', async () => {
      const logged: string[] = []
      users.hook('before:insert', async (doc: User) => { logged.push('before:' + doc.name) })
      users.hook('after:insert', async (doc: User) => { logged.push('after:' + doc.name) })
      await users.insert({ name: 'HookTest', role: 'user' })
      expect(logged).toEqual(['before:HookTest', 'after:HookTest'])
    })

    it('fires before:update and after:update hooks', async () => {
      const calls: string[] = []
      users.hook('before:update', async (_f: any, ch: Partial<User>) => { calls.push('before:' + (ch as any).name) })
      users.hook('after:update', async (_f: any, _ch: any, count: number) => { calls.push('after:' + count) })
      const user = await users.insert({ name: 'Alice', role: 'admin' })
      await users.update({ id: user.id }, { name: 'AliceUpdated' } as Partial<User>)
      expect(calls).toEqual(['before:AliceUpdated', 'after:1'])
    })

    it('fires before:delete and after:delete hooks', async () => {
      const calls: string[] = []
      users.hook('before:delete', async () => { calls.push('before:delete') })
      users.hook('after:delete', async (_f: any, count: number) => { calls.push('after:' + count) })
      const user = await users.insert({ name: 'ToDelete', role: 'guest' })
      await users.delete({ id: user.id })
      expect(calls).toEqual(['before:delete', 'after:1'])
    })
  })

  // -----------------------------------------------------------------------
  // Data types
  // -----------------------------------------------------------------------

  describe('data types', () => {
    const typedSchema = schema({
      id: t.id(),
      name: t.string(),
      active: t.boolean().default(true),
      tags: t.array(t.string()).default(() => []),
      meta: t.object({ key: t.string(), value: t.number() }).optional(),
    })
    type TypedDoc = typeof typedSchema.infer

    it('stores and retrieves typed fields', async () => {
      const col = db.collection<TypedDoc>('typed', typedSchema)
      const doc = await col.insert({ name: 'test', tags: ['a', 'b'] } as Partial<TypedDoc>)
      expect(doc.name).toBe('test')
      expect(doc.active).toBe(true)
      const found = await col.first({ id: doc.id })
      expect(found!.name).toBe('test')
      expect(found!.active).toBe(true)
      expect(found!.tags).toEqual(['a', 'b'])
    })

    it('stores and retrieves nested objects', async () => {
      const col = db.collection<TypedDoc>('typed2', typedSchema)
      const doc = await col.insert({ name: 'nested', meta: { key: 'foo', value: 42 } } as Partial<TypedDoc>)
      const found = await col.first({ id: doc.id })
      expect(found!.meta).toBeDefined()
      expect(found!.meta!.key).toBe('foo')
      expect(found!.meta!.value).toBe(42)
    })
  })

  // -----------------------------------------------------------------------
  // Transactions
  // -----------------------------------------------------------------------

  describe('transactions', () => {
    it('atomically transfers balance between accounts', async () => {
      const accounts = db.collection<Account>('accounts', accountSchema)

      const acc1 = await accounts.insert({ name: 'Alice', balance: 200 })
      const acc2 = await accounts.insert({ name: 'Bob', balance: 100 })

      // Transfer 50 from Alice to Bob
      await db.transaction(async (tx) => {
        const txAccounts = tx.collection<Account>('accounts', accountSchema)
        const from = await txAccounts.first({ id: acc1.id })!
        const to = await txAccounts.first({ id: acc2.id })!
        await txAccounts.update({ id: acc1.id }, { balance: from!.balance - 50 })
        await txAccounts.update({ id: acc2.id }, { balance: to!.balance + 50 })
      })

      const a1 = await accounts.first({ id: acc1.id })
      const a2 = await accounts.first({ id: acc2.id })
      expect(a1!.balance).toBe(150)
      expect(a2!.balance).toBe(150)
    })

    it('rolls back on error', async () => {
      const accounts = db.collection<Account>('accounts', accountSchema)

      const acc1 = await accounts.insert({ name: 'Alice', balance: 200 })
      const acc2 = await accounts.insert({ name: 'Bob', balance: 100 })

      // Attempt transfer that should fail
      try {
        await db.transaction(async (tx) => {
          const txAccounts = tx.collection<Account>('accounts', accountSchema)
          await txAccounts.update({ id: acc1.id }, { balance: 50 })
          await txAccounts.update({ id: acc2.id }, { balance: 999 }) // half-update
          throw new Error('simulated failure')
        })
      } catch {}

      // Verify no changes persisted
      const a1 = await accounts.first({ id: acc1.id })
      const a2 = await accounts.first({ id: acc2.id })
      expect(a1!.balance).toBe(200)
      expect(a2!.balance).toBe(100)
    })
  })

  // -----------------------------------------------------------------------
  // Concurrency
  // -----------------------------------------------------------------------

  describe('concurrency', () => {
    it('handles parallel inserts', async () => {
      const promises = Array.from({ length: 30 }, (_, i) =>
        users.insert({ name: 'User' + i, age: i, role: 'user' } as Partial<User>),
      )
      const results = await Promise.all(promises)
      expect(results.length).toBe(30)
      const all = await users.find()
      expect(all.length).toBe(30)
    })
  })
})
