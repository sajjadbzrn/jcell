import { describe, it, expect, beforeEach } from 'bun:test'
import { createDB, schema, t, memoryAdapter } from '../packages/core/src/index.js'

const userSchema = schema({
  id: t.id(),
  name: t.string(),
  age: t.number().optional(),
  role: t.enum(['admin', 'user', 'guest'] as const),
})

type User = typeof userSchema.infer

let db: ReturnType<typeof createDB>
let users: ReturnType<typeof db.collection<User>>

beforeEach(() => {
  db = createDB({ adapter: memoryAdapter() })
  users = db.collection('users', userSchema)
})

describe('insert', () => {
  it('inserts a document and returns it with id', async () => {
    const user = await users.insert({ name: 'Sajjad', age: 29, role: 'admin' })
    expect(user.id).toBeDefined()
    expect(user.name).toBe('Sajjad')
    expect(user.age).toBe(29)
    expect(user.role).toBe('admin')
  })

  it('generates id automatically', async () => {
    const user = await users.insert({ name: 'Test', role: 'guest' })
    expect(typeof user.id).toBe('string')
    expect(user.id.length).toBeGreaterThan(0)
  })

  it('rejects duplicates with same id', async () => {
    const user = await users.insert({ name: 'Sajjad', role: 'admin' })
    expect(
      users.insert({ id: user.id, name: 'Ali', role: 'guest' } as User),
    ).rejects.toThrow()
  })

  it('rejects invalid documents on insert', async () => {
    expect(
      users.insert({ name: 42 } as unknown as Partial<User>),
    ).rejects.toThrow(TypeError)
  })
})

describe('find and first', () => {
  beforeEach(async () => {
    await users.insert({ name: 'Sajjad', age: 29, role: 'admin' })
    await users.insert({ name: 'Ali', age: 25, role: 'user' })
    await users.insert({ name: 'Zahra', age: 35, role: 'admin' })
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

describe('query builder', () => {
  beforeEach(async () => {
    await users.insert({ name: 'Sajjad', age: 29, role: 'admin' })
    await users.insert({ name: 'Ali', age: 25, role: 'user' })
    await users.insert({ name: 'Zahra', age: 35, role: 'admin' })
    await users.insert({ name: 'Reza', age: 18, role: 'guest' })
  })

  it('filters with eq', async () => {
    const results = await users.where('name').eq('Sajjad').find()
    expect(results.length).toBe(1)
    expect(results[0]!.name).toBe('Sajjad')
  })

  it('filters with gt', async () => {
    const results = await users.where('age').gt(28).find()
    expect(results.length).toBe(2)
    expect(results.every((u: User) => u.age! > 28)).toBe(true)
  })

  it('filters with lt', async () => {
    const results = await users.where('age').lt(30).find()
    expect(results.length).toBe(3)
    expect(results.every((u: User) => u.age! < 30)).toBe(true)
  })

  it('filters with in', async () => {
    const results = await users.where('role').in(['admin', 'guest']).find()
    expect(results.length).toBe(3)
  })

  it('chains multiple filters', async () => {
    const results = await users.where('role').eq('admin').where('age').gt(28).find()
    expect(results.length).toBe(2)
    expect(results.every((u: User) => u.role === 'admin' && u.age! > 28)).toBe(true)
  })

  it('first returns one result', async () => {
    const result = await users.where('name').eq('Sajjad').first()
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Sajjad')
  })

  it('first returns null when no match', async () => {
    const result = await users.where('name').eq('NonExistent').first()
    expect(result).toBeNull()
  })
})

describe('update', () => {
  let user: User

  beforeEach(async () => {
    user = await users.insert({ name: 'Sajjad', age: 29, role: 'admin' })
  })

  it('updates a document by filter', async () => {
    const count = await users.update({ id: user.id }, { age: 30 })
    expect(count).toBe(1)

    const updated = await users.first({ id: user.id })
    expect(updated!.age).toBe(30)
    expect(updated!.name).toBe('Sajjad')
  })

  it('rejects invalid updates', async () => {
    expect(
      users.update({ id: user.id }, { name: 42 } as unknown as Partial<User>),
    ).rejects.toThrow(TypeError)
  })

  it('returns 0 when nothing matches', async () => {
    const count = await users.update({ id: 'non-existent' }, { age: 30 })
    expect(count).toBe(0)
  })
})

describe('delete', () => {
  let user: User

  beforeEach(async () => {
    user = await users.insert({ name: 'Sajjad', age: 29, role: 'admin' })
    await users.insert({ name: 'Ali', age: 25, role: 'user' })
  })

  it('deletes a document by filter', async () => {
    const count = await users.delete({ id: user.id })
    expect(count).toBe(1)

    const all = await users.find()
    expect(all.length).toBe(1)
  })

  it('returns 0 when nothing matches', async () => {
    const count = await users.delete({ id: 'non-existent' })
    expect(count).toBe(0)
  })
})
