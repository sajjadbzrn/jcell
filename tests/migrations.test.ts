import { describe, it, expect, beforeEach } from 'bun:test'
import { createDB, schema, t, memoryAdapter, createMigration } from '../packages/core/src/index.js'

const testSchema = schema({
  id: t.id(),
  name: t.string(),
})

let db: ReturnType<typeof createDB>

beforeEach(() => {
  db = createDB({ adapter: memoryAdapter() })
})

describe('migrations', () => {
  it('runs pending migrations', async () => {
    const executed: string[] = []

    const m1 = createMigration('001_create_users', {
      async up(_db: ReturnType<typeof createDB>) {
        executed.push('m1_up')
      },
    })

    const m2 = createMigration('002_add_index', {
      async up(_db: ReturnType<typeof createDB>) {
        executed.push('m2_up')
      },
    })

    await db.migrate([m1, m2])
    expect(executed).toEqual(['m1_up', 'm2_up'])
  })

  it('skips already-applied migrations', async () => {
    const executed: string[] = []

    const m1 = createMigration('001_first', {
      async up(_db: ReturnType<typeof createDB>) {
        executed.push('first')
      },
    })

    await db.migrate([m1])
    expect(executed).toEqual(['first'])

    // Run again — should be skipped
    executed.length = 0
    await db.migrate([m1])
    expect(executed).toEqual([])
  })

  it('only runs new migrations on second call', async () => {
    const executed: string[] = []

    const m1 = createMigration('001', {
      async up(_db: ReturnType<typeof createDB>) {
        executed.push('001')
      },
    })

    const m2 = createMigration('002', {
      async up(_db: ReturnType<typeof createDB>) {
        executed.push('002')
      },
    })

    await db.migrate([m1])
    expect(executed).toEqual(['001'])

    await db.migrate([m1, m2])
    expect(executed).toEqual(['001', '002'])
  })

  it('tracks applied migrations in _migrations collection', async () => {
    const m1 = createMigration('001_create', {
      async up(db: ReturnType<typeof createDB>) {
        const col = db.collection('test', testSchema)
        await col.insert({ name: 'hello' })
      },
    })

    await db.migrate([m1])

    // Check migrations were tracked
    const migCol = db.collection('_migrations', schema({
      id: t.id(),
      name: t.string(),
      appliedAt: t.date().default(() => new Date()),
    }))
    const applied = await migCol.find()
    expect(applied.length).toBe(1)
    expect(applied[0]!.name).toBe('001_create')
  })
})
