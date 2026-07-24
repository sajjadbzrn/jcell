import type { DocWithId } from './types'

// ---------------------------------------------------------------------------
// Internal field descriptor
// ---------------------------------------------------------------------------

export interface FieldDef {
  type: 'string' | 'number' | 'boolean' | 'id' | 'date' | 'array' | 'object' | 'enum' | 'ref'
  optional: boolean
  hasDefault: boolean
  defaultValue?: unknown
  defaultFn?: () => unknown
  /** For array fields – the element field descriptor */
  itemField?: FieldDef
  /** For object fields – nested field descriptors */
  fields?: Record<string, FieldDef>
  /** For enum fields – allowed values */
  enumValues?: readonly unknown[]
  /** For ref fields – the target collection name */
  refCollection?: string
  /** Whether this field should be indexed (set via .index()) */
  indexed?: boolean
  /** Whether the index should enforce uniqueness */
  indexUnique?: boolean
}

// ---------------------------------------------------------------------------
// Field builder – the `t.string()`, `t.number()`, … API
// ---------------------------------------------------------------------------

/** Phantom brand so we can track the *inferred* type at the type level. */
export interface Field<T> {
  /** @internal field descriptor used at runtime */
  readonly _def: FieldDef
  /** @internal phantom property for type inference – never read at runtime */
  readonly _infer: T

  optional(): Field<T | undefined>
  default(value: T | (() => T)): Field<T>

  /** Mark this field as indexed for faster lookups. */
  index(options?: { unique?: boolean }): Field<T>
}

class FieldImpl<T> implements Field<T> {
  readonly _def: FieldDef
  declare readonly _infer: T

  constructor(def: FieldDef) {
    this._def = def
  }

  optional(): Field<T | undefined> {
    return new FieldImpl<T | undefined>({ ...this._def, optional: true })
  }

  default(value: T | (() => T)): Field<T> {
    return new FieldImpl<T>({
      ...this._def,
      hasDefault: true,
      defaultValue: typeof value !== 'function' ? (value as unknown) : undefined,
      defaultFn: typeof value === 'function' ? (value as unknown as () => unknown) : undefined,
    })
  }

  index(options?: { unique?: boolean }): Field<T> {
    return new FieldImpl<T>({
      ...this._def,
      indexed: true,
      indexUnique: options?.unique,
    })
  }
}

// ---------------------------------------------------------------------------
// The `t` namespace
// ---------------------------------------------------------------------------

function baseField<T>(type: FieldDef['type']): Field<T> {
  return new FieldImpl<T>({ type, optional: false, hasDefault: false })
}

export const t = {
  id: (): Field<string> => baseField<string>('id'),
  string: (): Field<string> => baseField<string>('string'),
  number: (): Field<number> => baseField<number>('number'),
  boolean: (): Field<boolean> => baseField<boolean>('boolean'),
  date: (): Field<Date> => baseField<Date>('date'),
  array:
    <T>(itemField: Field<T>): Field<T[]> =>
      new FieldImpl<T[]>({
        type: 'array',
        optional: false,
        hasDefault: false,
        itemField: itemField._def,
      }),
  object:
    <T extends Record<string, Field<unknown>>>(fields: T): Field<{ [K in keyof T]: T[K] extends Field<infer U> ? U : never }> =>
      new FieldImpl({
        type: 'object',
        optional: false,
        hasDefault: false,
        fields: Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, (v as Field<unknown>)._def]),
        ),
      }) as never,
  enum:
    <const T extends readonly unknown[]>(values: T): Field<T[number]> =>
      new FieldImpl<T[number]>({
        type: 'enum',
        optional: false,
        hasDefault: false,
        enumValues: values,
      }),
  /**
   * Reference to another collection.
   * Stores the id of the related document.
   *
   * ```ts
   * authorId: t.ref('users')       // stores a user id
   * ```
   */
  ref:
    (collectionName: string): Field<string> =>
      new FieldImpl<string>({
        type: 'ref',
        optional: false,
        hasDefault: false,
        refCollection: collectionName,
      }),
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Extract the inferred document type from a schema.
 *
 * ```ts
 * const userSchema = schema({ name: t.string(), age: t.number().optional() })
 * type User = typeof userSchema.infer  // { name: string; age: number | undefined }
 * ```
 */

export type InferSchema<T> = {
  [K in keyof T]: T[K] extends Field<infer U> ? U : never
}

export interface SchemaInstance<T extends DocWithId> {
  /** The inferred TypeScript type of documents in this collection. */
  readonly infer: T
  /** @internal The raw field definitions. */
  readonly _fields: Record<string, FieldDef>
  /** @internal Fields that have .index() applied. */
  readonly _indexes: { field: string; unique?: boolean }[]
}

/**
 * Define a schema for a collection.
 *
 * ```ts
 * const userSchema = schema({
 *   id: t.id(),
 *   name: t.string(),
 *   age: t.number().optional(),
 *   createdAt: t.date().default(() => new Date()),
 * })
 * ```
 */
export function schema<T extends Record<string, Field<unknown>>>(
  fields: T,
): SchemaInstance<InferSchema<T> & { id: string }> {
  const entries = Object.entries(fields)
  const fieldDefs: Record<string, FieldDef> = {}
  const indexes: { field: string; unique?: boolean }[] = []

  for (const [k, v] of entries) {
    const field = v as Field<unknown>
    fieldDefs[k] = field._def
    // Collect index metadata from fields that have .index() applied
    if (field._def.indexed) {
      indexes.push({ field: k, unique: field._def.indexUnique })
    }
  }

  return {
    infer: null as never,
    _fields: fieldDefs,
    _indexes: indexes,
  } as never
}
