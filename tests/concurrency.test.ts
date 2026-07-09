import { describe, it, expect } from 'bun:test'
import { createDB, schema, t, memoryAdapter } from '../packages/core/src/index.js'

const counterSchema = schema({
  id: t.id(),
  value: t.number(),
})

type Counter = typeof counterSchema.infer

describe('concurrency', () => {
  it('handles parallel inserts without data loss', async () => {
    const db = createDB({ adapter: memoryAdapter() })
    const counters = db.collection('counters', counterSchema)

    const promises = Array.from({ length: 50 }, (_, i) =>
      counters.insert({ value: i }),
    )

    const results = await Promise.all(promises)
    expect(results.length).toBe(50)

    const all = await counters.find()
    expect(all.length).toBe(50)

    const values = all.map((c: Counter) => c.value).sort((a: number, b: number) => a - b)
    expect(values).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })

  it('handles mixed reads and writes', async () => {
    const db = createDB({ adapter: memoryAdapter() })
    const counters = db.collection('counters', counterSchema)

    for (let i = 0; i < 10; i++) {
      await counters.insert({ value: i })
    }

    const ops = Array.from({ length: 20 }, (_, i) => {
      if (i % 2 === 0) {
        return counters.insert({ value: 100 + i })
      } else {
        return counters.find()
      }
    })

    await Promise.all(ops)

    const all = await counters.find()
    expect(all.length).toBeGreaterThanOrEqual(10)
  })

  it('handles parallel updates', async () => {
    const db = createDB({ adapter: memoryAdapter() })
    const counters = db.collection('counters', counterSchema)

    const doc = await counters.insert({ value: 0 })

    const updates = Array.from({ length: 20 }, (_, i) =>
      counters.update({ id: doc.id }, { value: i + 1 }),
    )

    await Promise.all(updates)

    const result = await counters.first({ id: doc.id })
    expect(result).not.toBeNull()
    expect(result!.value).toBeGreaterThan(0)
  })
})
