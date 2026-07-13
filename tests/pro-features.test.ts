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
