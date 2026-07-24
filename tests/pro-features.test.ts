import { describe, it, expect, beforeEach } from 'bun:test'
import { createDB, schema, t, memoryAdapter } from '../packages/core/src/index.js'

const userSchema = schema({
  id: t.id(),
  name: t.string(),
  age: t.number().optional(),
  score: t.number().default(0),
  role: t.enum(['admin', 'user', 'guest'] as const),
})

type User = typeof userSchema.infer

let db: ReturnType<typeof createDB>
let users: ReturnType<typeof db.collection<User>>

beforeEach(async () => {
  db = createDB({ adapter: memoryAdapter() })
  users = db.collection('users', userSchema)
  await users.insert({ name: 'Alice', age: 30, score: 100, role: 'admin' })
  await users.insert({ name: 'Bob', age: 25, score: 200, role: 'user' })
  await users.insert({ name: 'Charlie', age: 35, score: 150, role: 'admin' })
  await users.insert({ name: 'Diana', age: 20, score: 50, role: 'guest' })
  await users.insert({ name: 'Eve', age: 28, score: 300, role: 'user' })
})

describe('pagination', () => {
  it('limits results', async () => {
    const results = await users.where('role').eq('user').limit(1).find()
    expect(results.length).toBe(1)
  })

  it('offsets results', async () => {
    const all = await users.where('role').eq('user').orderBy('name').find()
    expect(all.length).toBe(2)

    const [first] = await users.where('role').eq('user').orderBy('name').limit(1).offset(0).find()
    const [second] = await users.where('role').eq('user').orderBy('name').limit(1).offset(1).find()
    expect(first!.name).not.toBe(second!.name)
  })

  it('paginates with page()', async () => {
    const page1 = await users.orderBy('name').page(1, 2).find()
    expect(page1.length).toBe(2)
    expect(page1[0]!.name).toBe('Alice')

    const page2 = await users.orderBy('name').page(2, 2).find()
    expect(page2.length).toBe(2)
    expect(page2[0]!.name).toBe('Charlie')

    const page3 = await users.orderBy('name').page(3, 2).find()
    expect(page3.length).toBe(1)
    expect(page3[0]!.name).toBe('Eve')
  })
})

describe('sorting', () => {
  it('sorts ascending', async () => {
    const results = await users.orderBy('age').find()
    const ages = results.map((u: User) => u.age)
    expect(ages).toEqual([20, 25, 28, 30, 35])
  })

  it('sorts descending', async () => {
    const results = await users.orderByDesc('score').find()
    const scores = results.map((u: User) => u.score)
    expect(scores).toEqual([300, 200, 150, 100, 50])
  })

  it('chains sort with filter', async () => {
    const results = await users
      .where('role').eq('admin')
      .orderByDesc('score')
      .find()
    expect(results.length).toBe(2)
    expect(results[0]!.name).toBe('Charlie')
    expect(results[1]!.name).toBe('Alice')
  })

  it('sorts by multiple fields', async () => {
    // Add same score for sort stability test
    await users.insert({ name: 'Frank', age: 30, score: 100, role: 'admin' })

    const results = await users
      .where('score').eq(100)
      .orderBy('age')
      .orderBy('name')
      .find()
    expect(results.length).toBe(2)
  })
})

describe('aggregation', () => {
  it('counts all documents', async () => {
    const c = await users.count()
    expect(c).toBe(5)
  })

  it('counts with filter', async () => {
    const c = await users.count({ role: 'admin' })
    expect(c).toBe(2)
  })

  it('sums a field', async () => {
    const total = await users.sum('score')
    expect(total).toBe(800)
  })

  it('sums with filter', async () => {
    const total = await users.sum('score', { role: 'admin' })
    expect(total).toBe(250)
  })

  it('averages a field', async () => {
    const avg = await users.avg('age')
    expect(avg).toBe(27.6)
  })

  it('finds min value', async () => {
    const minAge = await users.min('age')
    expect(minAge).toBe(20)
  })

  it('finds max value', async () => {
    const maxScore = await users.max('score')
    expect(maxScore).toBe(300)
  })

  it('returns 0 for avg on empty', async () => {
    const emptyCol = db.collection('empty', userSchema)
    expect(await emptyCol.avg('age')).toBe(0)
  })

  it('returns null for min/max on empty', async () => {
    const emptyCol = db.collection('empty', userSchema)
    expect(await emptyCol.min('age')).toBeNull()
    expect(await emptyCol.max('age')).toBeNull()
  })
})

describe('hooks', () => {
  it('fires before:insert hook', async () => {
    const logged: string[] = []
    users.hook('before:insert', async (doc: User) => {
      logged.push(`before:${doc.name}`)
    })
    users.hook('after:insert', async (doc: User) => {
      logged.push(`after:${doc.name}`)
    })

    await users.insert({ name: 'HookTest', age: 42, role: 'user' })
    expect(logged).toEqual(['before:HookTest', 'after:HookTest'])
  })

  it('fires after:insert hook', async () => {
    let capturedDoc: User | null = null
    users.hook('after:insert', async (doc: User) => {
      capturedDoc = doc
    })

    const doc = await users.insert({ name: 'Test', age: 10, role: 'guest' })
    expect(capturedDoc).not.toBeNull()
    expect(capturedDoc!.id).toBe(doc.id)
  })

  it('fires before:update and after:update hooks', async () => {
    const calls: string[] = []
    users.hook('before:update', async (_filter: Partial<User>, changes: Partial<User>) => {
      calls.push(`before:${changes.name}`)
    })
    users.hook('after:update', async (_filter: Partial<User>, _changes: Partial<User>, count: number) => {
      calls.push(`after:${count}`)
    })

    const user = await users.first({ name: 'Alice' })
    await users.update({ id: user!.id }, { name: 'AliceUpdated' })
    expect(calls).toEqual(['before:AliceUpdated', 'after:1'])
  })

  it('fires before:delete and after:delete hooks', async () => {
    const calls: string[] = []
    users.hook('before:delete', async (_filter: Partial<User>) => {
      calls.push('before:delete')
    })
    users.hook('after:delete', async (_filter: Partial<User>, count: number) => {
      calls.push(`after:${count}`)
    })

    await users.delete({ name: 'Alice' })
    expect(calls).toEqual(['before:delete', 'after:1'])
  })
})

describe('new filter operators', () => {
  it('filters with ne (not equal)', async () => {
    const results = await users.where('role').ne('admin').find()
    expect(results.length).toBe(3)
    expect(results.every((u: User) => u.role !== 'admin')).toBe(true)
  })

  it('filters with contains', async () => {
    const results = await users.where('name').contains('li').find()
    expect(results.length).toBe(2)
    expect(results.some((u: User) => u.name === 'Alice')).toBe(true)
    expect(results.some((u: User) => u.name === 'Charlie')).toBe(true)
  })

  it('filters with startsWith', async () => {
    const results = await users.where('name').startsWith('A').find()
    expect(results.length).toBe(1)
    expect(results[0]!.name).toBe('Alice')
  })
})

describe('query count', () => {
  it('counts via query builder', async () => {
    const c = await users.where('role').eq('admin').count()
    expect(c).toBe(2)
  })
})

describe('batch operations', () => {
  it('insertMany inserts multiple documents', async () => {
    const docs = await users.insertMany([
      { name: 'Batch1', age: 10, role: 'user' },
      { name: 'Batch2', age: 20, role: 'user' },
      { name: 'Batch3', age: 30, role: 'admin' },
    ] as Partial<User>[])
    expect(docs.length).toBe(3)
    expect(docs[0]!.id).toBeDefined()
    expect(docs[1]!.name).toBe('Batch2')

    const all = await users.find()
    expect(all.length).toBe(8) // 5 seed + 3 new
  })

  it('insertMany returns empty array for empty input', async () => {
    const docs = await users.insertMany([])
    expect(docs).toEqual([])
  })

  it('insertMany throws on invalid document', async () => {
    expect(
      users.insertMany([
        { name: 'Valid', role: 'user' },
        { name: 42 as any, role: 'user' },
      ]),
    ).rejects.toThrow()
  })

  it('updateAll updates all documents', async () => {
    const count = await users.updateAll({ role: 'guest' } as Partial<User>)
    expect(count).toBe(5)

    const all = await users.find()
    expect(all.every((u: User) => u.role === 'guest')).toBe(true)
  })

  it('updateAll returns 0 on empty collection', async () => {
    const emptyCol = db.collection('empty', userSchema)
    const count = await emptyCol.updateAll({ role: 'guest' } as Partial<User>)
    expect(count).toBe(0)
  })

  it('deleteAll removes all documents', async () => {
    const count = await users.deleteAll()
    expect(count).toBe(5)

    const all = await users.find()
    expect(all.length).toBe(0)
  })

  it('deleteAll returns 0 on empty collection', async () => {
    const emptyCol = db.collection('empty', userSchema)
    const count = await emptyCol.deleteAll()
    expect(count).toBe(0)
  })
})

describe('aggregation pipeline operators ($or / $and)', () => {
  it('$or within $match returns docs matching any condition', async () => {
    // @ts-expect-error - accessing adapter internals for test
    const result = await users._adapter.aggregate('users', [
      { $match: { $or: [{ role: 'admin' }, { age: { $gte: 30 } }] } },
    ]) as Record<string, unknown>[]
    // Alice (admin,30), Charlie (admin,35) → 2 unique docs
    expect(result.length).toBe(2)
  })

  it('$or within $match returns correct docs', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { $or: [{ name: 'Alice' }, { name: 'Bob' }] } },
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(2)
    const names = result.map((r: Record<string, unknown>) => r.name).sort()
    expect(names).toEqual(['Alice', 'Bob'])
  })

  it('$and within $match returns docs matching all conditions', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { $and: [{ role: 'admin' }, { age: { $gte: 30 } }] } },
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(2) // Alice (admin, 30), Charlie (admin, 35)
    expect(result.every((r: Record<string, unknown>) => r.role === 'admin')).toBe(true)
  })

  it('field-level $gte / $lte operators work', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { age: { $gte: 25, $lte: 30 } } },
    ]) as Record<string, unknown>[]
    // Alice (30), Bob (25), Eve (28) — 3 docs with age between 25 and 30 inclusive
    expect(result.length).toBe(3)
  })

  it('field-level $gt and $lt operators work', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { age: { $gt: 25, $lt: 35 } } },
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(2) // Alice (30), Eve (28)
  })

  it('field-level $ne operator works', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { role: { $ne: 'admin' } } },
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(3) // Bob (user), Diana (guest), Eve (user)
    expect(result.every((r: Record<string, unknown>) => r.role !== 'admin')).toBe(true)
  })

  it('field-level $in operator works', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { role: { $in: ['admin', 'guest'] } } },
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(3) // Alice (admin), Charlie (admin), Diana (guest)
  })

  it('field-level $contains operator works', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { name: { $contains: 'li' } } },
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(2) // Alice, Charlie
  })

  it('field-level $startsWith operator works', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { name: { $startsWith: 'D' } } },
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(1) // Diana
  })

  it('mixed $match with simple fields and $or works', async () => {
    // role = 'admin' AND (name = 'Alice' OR name = 'Charlie')
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { role: 'admin', $or: [{ name: 'Alice' }, { name: 'Charlie' }] } },
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(2)
  })

  it('$or in aggregation with $sum works', async () => {
    // Sum scores for admins OR age >= 30
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { $or: [{ role: 'admin' }, { age: { $gte: 30 } }] } },
      { $group: { _id: null, value: { $sum: '$score' } } },
    ]) as Record<string, unknown>[]
    const arr = result as Array<{ value: number }>
    // Alice: 100 (admin,30), Charlie: 150 (admin,35) = 250
    expect(arr[0]?.value).toBe(250)
  })

  it('$and in aggregation with $avg works', async () => {
    // Avg age for admins with age >= 30
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { $and: [{ role: 'admin' }, { age: { $gte: 30 } }] } },
      { $group: { _id: null, value: { $avg: '$age' } } },
    ]) as Record<string, unknown>[]
    const arr = result as Array<{ value: number }>
    expect(arr[0]?.value).toBe(32.5) // (30 + 35) / 2
  })

  it('$or as standalone pipeline stage works', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $or: [
        { $match: { role: 'admin' } },
        { $match: { age: { $gte: 30 } } },
      ]},
    ]) as Record<string, unknown>[]
    // admin: Alice, Charlie | age>=30: Alice, Charlie → 2 unique docs
    expect(result.length).toBe(2)
  })

  it('$and as standalone pipeline stage works', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $and: [
        { $match: { role: 'admin' } },
        { $match: { age: { $gte: 30 } } },
      ]},
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(2) // Alice (admin, 30), Charlie (admin, 35)
  })

  it('$match with only equality still works (backward compat)', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: { role: 'admin' } },
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(2)
  })

  it('empty $match returns all docs', async () => {
    // @ts-expect-error
    const result = await users._adapter.aggregate('users', [
      { $match: {} },
    ]) as Record<string, unknown>[]
    expect(result.length).toBe(5)
  })
})

describe('logical operators (orWhere)', () => {
  it('returns docs matching either OR condition', async () => {
    // role = 'guest' OR age >= 30
    const results = await users
      .where('role').eq('guest')
      .orWhere('age').gte(30)
      .find()
    expect(results.length).toBe(3) // Diana (guest), Alice (30), Charlie (35)
    expect(results.some((u: User) => u.name === 'Diana')).toBe(true)
    expect(results.some((u: User) => u.name === 'Alice')).toBe(true)
    expect(results.some((u: User) => u.name === 'Charlie')).toBe(true)
  })

  it('works with only OR conditions (no AND)', async () => {
    // age < 25 OR role = 'admin'
    const results = await users
      .orWhere('age').lt(25)
      .orWhere('role').eq('admin')
      .find()
    expect(results.length).toBe(3) // Alice (admin), Charlie (admin), Diana (20)
  })

  it('combines AND and OR groups', async () => {
    // (score > 100) OR (role = 'guest')
    const results = await users
      .where('score').gt(100)
      .orWhere('role').eq('guest')
      .find()
    expect(results.length).toBe(4) // Bob (200), Charlie (150), Eve (300), Diana (guest)
  })

  it('counts correctly with orWhere', async () => {
    const c = await users
      .where('role').eq('admin')
      .orWhere('age').lt(25)
      .count()
    expect(c).toBe(3) // Alice (admin), Charlie (admin), Diana (20)
  })

  it('works with first() and orWhere', async () => {
    const result = await users
      .where('name').eq('NonExistent')
      .orWhere('name').eq('Bob')
      .first()
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Bob')
  })

  it('all operators work in OR mode', async () => {
    // name contains 'e' OR score >= 200
    const results = await users
      .where('name').contains('e')
      .orWhere('score').gte(200)
      .find()
    expect(results.length).toBe(4) // Alice, Charlie, Eve (contain 'e'), Bob (200), Eve (300)
  })
})
