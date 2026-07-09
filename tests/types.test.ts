import { describe, it, expect } from 'bun:test'
import { schema, t } from '../packages/core/src/index.js'

describe('type inference', () => {
  it('infers string type', () => {
    const s = schema({ id: t.id(), name: t.string() })
    type Inferred = typeof s.infer
    // Runtime check
    const doc: Inferred = { id: '1', name: 'test' }
    expect(doc.name).toBe('test')
  })

  it('infers optional fields', () => {
    const s = schema({ id: t.id(), name: t.string(), age: t.number().optional() })
    type Inferred = typeof s.infer
    // Both should be valid
    const doc1: Inferred = { id: '1', name: 'test', age: 25 }
    const doc2: Inferred = { id: '1', name: 'test', age: undefined }
    expect(doc1.age).toBe(25)
    expect(doc2.age).toBeUndefined()
  })

  it('infers boolean type', () => {
    const s = schema({ id: t.id(), active: t.boolean() })
    type Inferred = typeof s.infer
    const doc: Inferred = { id: '1', active: false }
    expect(doc.active).toBe(false)
  })

  it('infers date type', () => {
    const s = schema({ id: t.id(), createdAt: t.date() })
    type Inferred = typeof s.infer
    const doc: Inferred = { id: '1', createdAt: new Date() }
    expect(doc.createdAt).toBeInstanceOf(Date)
  })

  it('infers array type', () => {
    const s = schema({ id: t.id(), tags: t.array(t.string()) })
    type Inferred = typeof s.infer
    const doc: Inferred = { id: '1', tags: ['a', 'b'] }
    expect(Array.isArray(doc.tags)).toBe(true)
    expect(doc.tags.length).toBe(2)
  })

  it('infers object type', () => {
    const s = schema({
      id: t.id(),
      meta: t.object({
        key: t.string(),
        value: t.number(),
      }),
    })
    type Inferred = typeof s.infer
    const doc: Inferred = { id: '1', meta: { key: 'foo', value: 42 } }
    expect(doc.meta.key).toBe('foo')
    expect(doc.meta.value).toBe(42)
  })

  it('infers enum type', () => {
    const s = schema({
      id: t.id(),
      role: t.enum(['admin', 'user', 'guest'] as const),
    })
    type Inferred = typeof s.infer
    const doc: Inferred = { id: '1', role: 'admin' }
    expect(doc.role).toBe('admin')
  })

  it('infers types with defaults', () => {
    const s = schema({
      id: t.id(),
      name: t.string(),
      count: t.number().default(0),
    })
    type Inferred = typeof s.infer
    const doc: Inferred = { id: '1', name: 'test', count: 5 }
    expect(doc.count).toBe(5)
  })
})
