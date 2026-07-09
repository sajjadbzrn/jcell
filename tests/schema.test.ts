import { describe, it, expect } from 'bun:test'
import { schema, t } from '../packages/core/src/index.js'
import { validateDocument, applyDefaults } from '../packages/core/src/validator.js'

describe('schema definition', () => {
  it('infers types from schema', () => {
    const userSchema = schema({
      id: t.id(),
      name: t.string(),
      age: t.number().optional(),
      createdAt: t.date().default(() => new Date()),
    })

    const fields = userSchema._fields
    expect(fields['id']!.type).toBe('id')
    expect(fields['name']!.type).toBe('string')
    expect(fields['age']!.type).toBe('number')
    expect(fields['age']!.optional).toBe(true)
    expect(fields['createdAt']!.type).toBe('date')
    expect(fields['createdAt']!.hasDefault).toBe(true)
  })

  it('supports boolean, array, object, enum types', () => {
    const testSchema = schema({
      id: t.id(),
      active: t.boolean(),
      tags: t.array(t.string()),
      meta: t.object({
        key: t.string(),
        value: t.number(),
      }),
      role: t.enum(['admin', 'user', 'guest'] as const),
    })

    const fields = testSchema._fields
    expect(fields['active']!.type).toBe('boolean')
    expect(fields['tags']!.type).toBe('array')
    expect(fields['tags']!.itemField!.type).toBe('string')
    expect(fields['meta']!.type).toBe('object')
    expect(fields['meta']!.fields!['key']!.type).toBe('string')
    expect(fields['role']!.type).toBe('enum')
    expect(fields['role']!.enumValues).toEqual(['admin', 'user', 'guest'])
  })
})

describe('validation', () => {
  const userSchema = schema({
    id: t.id(),
    name: t.string(),
    age: t.number().optional(),
    isAdmin: t.boolean().default(false),
    createdAt: t.date().default(() => new Date()),
  })

  it('accepts a valid document', () => {
    const errors = validateDocument(
      { id: 'abc', name: 'Sajjad', age: 29, isAdmin: true, createdAt: new Date() },
      userSchema._fields,
    )
    expect(errors).toEqual([])
  })

  it('rejects a missing required field', () => {
    const errors = validateDocument({ id: 'abc' }, userSchema._fields)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('Missing required field')
  })

  it('rejects an invalid type', () => {
    const errors = validateDocument(
      { id: 'abc', name: 42 } as Record<string, unknown>,
      userSchema._fields,
    )
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('Invalid value'))).toBe(true)
  })

  it('rejects unknown fields', () => {
    const errors = validateDocument(
      { id: 'abc', name: 'Sajjad', unknownField: 'oops' },
      userSchema._fields,
    )
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('Unknown field'))).toBe(true)
  })

  it('accepts valid enum values', () => {
    const roleSchema = schema({
      id: t.id(),
      role: t.enum(['admin', 'user', 'guest'] as const),
    })
    expect(validateDocument({ id: 'abc', role: 'admin' }, roleSchema._fields)).toEqual([])
    expect(validateDocument({ id: 'abc', role: 'guest' }, roleSchema._fields)).toEqual([])
  })

  it('rejects invalid enum values', () => {
    const roleSchema = schema({
      id: t.id(),
      role: t.enum(['admin', 'user', 'guest'] as const),
    })
    const errors = validateDocument(
      { id: 'abc', role: 'superadmin' },
      roleSchema._fields,
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  it('validates array items', () => {
    const tagSchema = schema({
      id: t.id(),
      tags: t.array(t.string()),
    })
    expect(validateDocument({ id: 'abc', tags: ['a', 'b'] }, tagSchema._fields)).toEqual([])
    const errors = validateDocument(
      { id: 'abc', tags: ['a', 42] } as Record<string, unknown>,
      tagSchema._fields,
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  it('validates nested objects', () => {
    const metaSchema = schema({
      id: t.id(),
      meta: t.object({
        key: t.string(),
        value: t.number(),
      }),
    })
    expect(
      validateDocument({ id: 'abc', meta: { key: 'foo', value: 42 } }, metaSchema._fields),
    ).toEqual([])

    const errors = validateDocument(
      { id: 'abc', meta: { key: 'foo', value: 'bar' } } as unknown as Record<string, unknown>,
      metaSchema._fields,
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects invalid Date values', () => {
    const errors = validateDocument(
      { id: 'abc', name: 'Test', createdAt: 'not-a-date' } as unknown as Record<string, unknown>,
      userSchema._fields,
    )
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('applyDefaults', () => {
  it('generates id if not provided', () => {
    const fields = {
      id: { type: 'id' as const, optional: false, hasDefault: false },
      name: { type: 'string' as const, optional: false, hasDefault: false },
    }
    const doc = applyDefaults({ name: 'Sajjad' }, fields)
    expect(typeof doc['id']).toBe('string')
    expect(doc['id']!.toString().length).toBeGreaterThan(0)
  })

  it('applies default values', () => {
    const fields = {
      name: { type: 'string' as const, optional: false, hasDefault: false },
      count: {
        type: 'number' as const,
        optional: false,
        hasDefault: true,
        defaultValue: 0,
        defaultFn: undefined,
      },
    }
    const doc = applyDefaults({ name: 'Sajjad' }, fields)
    expect(doc['count']).toBe(0)
  })

  it('applies default functions', () => {
    const fields = {
      createdAt: {
        type: 'date' as const,
        optional: false,
        hasDefault: true,
        defaultValue: undefined,
        defaultFn: () => new Date('2024-01-01'),
      },
    }
    const doc = applyDefaults({}, fields)
    expect(doc['createdAt']).toBeInstanceOf(Date)
    expect((doc['createdAt'] as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z')
  })
})
