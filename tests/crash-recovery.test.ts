import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createDB, schema, t, fileAdapter } from '../packages/core/src/index.js'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const testDir = join(import.meta.dir, '.test-data-crash')

const testSchema = schema({
  id: t.id(),
  name: t.string(),
  value: t.number(),
})

type TestDoc = typeof testSchema.infer

beforeEach(async () => {
  if (existsSync(testDir)) {
    await rm(testDir, { recursive: true, force: true })
  }
  await mkdir(testDir, { recursive: true })
})

afterEach(async () => {
  if (existsSync(testDir)) {
    await rm(testDir, { recursive: true, force: true })
  }
})

describe('crash recovery', () => {
  it('recovers from corrupted main file using .bak', async () => {
    const db = createDB({ adapter: fileAdapter({ path: testDir }) })
    const items = db.collection('items', testSchema)

    await items.insert({ name: 'item1', value: 1 })
    await items.insert({ name: 'item2', value: 2 })
    await items.insert({ name: 'item3', value: 3 })

    let all = await items.find()
    expect(all.length).toBe(3)

    const filePath = join(testDir, 'items.json')
    const backupPath = join(testDir, 'items.json.bak')

    expect(existsSync(backupPath)).toBe(true)

    await writeFile(filePath, '{corrupted-json!!!', 'utf-8')

    const db2 = createDB({ adapter: fileAdapter({ path: testDir }) })
    const items2 = db2.collection('items', testSchema)

    all = await items2.find()
    expect(all.length).toBe(2)
    expect(all.some((d: TestDoc) => d.name === 'item1')).toBe(true)
    expect(all.some((d: TestDoc) => d.name === 'item2')).toBe(true)
  })

  it('handles non-existent backup gracefully', async () => {
    const filePath = join(testDir, 'empty.json')
    await writeFile(filePath, '{corrupted}', 'utf-8')

    const db = createDB({ adapter: fileAdapter({ path: testDir }) })
    const items = db.collection('empty', testSchema)

    const all = await items.find()
    expect(all.length).toBe(0)
  })

  it('maintains data integrity across sequential writes', async () => {
    const db = createDB({ adapter: fileAdapter({ path: testDir }) })
    const items = db.collection('items', testSchema)

    for (let i = 0; i < 10; i++) {
      await items.insert({ name: `item-${i}`, value: i })
    }

    for (let i = 0; i < 10; i++) {
      await items.update({ value: i }, { value: i * 10 })
    }

    await items.delete({ value: 0 })
    await items.delete({ value: 10 })

    const db2 = createDB({ adapter: fileAdapter({ path: testDir }) })
    const items2 = db2.collection('items', testSchema)
    const all = await items2.find()

    expect(all.length).toBe(8)
    const values = all.map((d: TestDoc) => d.value).sort((a: number, b: number) => a - b)
    expect(values[0]).toBe(20)
  })
})
