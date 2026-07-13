import type { FieldDef } from './schema'

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateValue(value: unknown, def: FieldDef): boolean {
  // Skip validation for undefined optional fields with no default
  if (value === undefined) {
    return def.optional || def.hasDefault
  }

  switch (def.type) {
    case 'id':
      return typeof value === 'string' && value.length > 0
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'date':
      return value instanceof Date && !Number.isNaN(value.getTime())
    case 'ref':
      return typeof value === 'string' && value.length > 0
    case 'array': {
      if (!Array.isArray(value)) return false
      if (!def.itemField) return false
      return value.every((item) => validateValue(item, def.itemField!))
    }
    case 'object': {
      if (!isPlainObject(value)) return false
      if (!def.fields) return false
      for (const [key, fieldDef] of Object.entries(def.fields)) {
        if (!(key in value) && !fieldDef.optional && !fieldDef.hasDefault) {
          return false
        }
        if (key in value && !validateValue(value[key], fieldDef)) {
          return false
        }
      }
      return true
    }
    case 'enum': {
      if (!def.enumValues) return false
      return def.enumValues.includes(value)
    }
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// ID generation (portable, no crypto dependency)
// ---------------------------------------------------------------------------

function generateId(): string {
  // Simple UUID v4 generator that works in any JS runtime
  // Uses Math.random as fallback — fine for IDs since we don't need cryptographic uniqueness
  const hex = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      id += '-'
    } else if (i === 14) {
      id += '4' // version 4
    } else if (i === 19) {
      id += hex[(Math.random() * 4) | 8] // variant
    } else {
      id += hex[(Math.random() * 16) | 0]
    }
  }
  return id
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function applyDefaults(
  doc: Record<string, unknown>,
  fields: Record<string, FieldDef>,
): Record<string, unknown> {
  const result = { ...doc }

  for (const [key, def] of Object.entries(fields)) {
    if (key in result) continue

    if (def.hasDefault) {
      if (def.defaultFn !== undefined) {
        result[key] = def.defaultFn()
      } else if (def.defaultValue !== undefined) {
        result[key] = def.defaultValue
      } else {
        result[key] = undefined
      }
    }
  }

  // Auto-generate id for id fields
  for (const [key, def] of Object.entries(fields)) {
    if (def.type === 'id' && !(key in result)) {
      result[key] = generateId()
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Public validation API
// ---------------------------------------------------------------------------

/**
 * Validate a document against the schema's field definitions.
 * Returns an array of error messages (empty = valid).
 */
export function validateDocument(
  doc: Record<string, unknown>,
  fields: Record<string, FieldDef>,
): string[] {
  const errors: string[] = []

  for (const [key, def] of Object.entries(fields)) {
    const value = doc[key]

    // Check required fields
    if (value === undefined && !def.optional && !def.hasDefault && def.type !== 'id') {
      errors.push(`Missing required field: "${key}"`)
      continue
    }

    // Validate value if present
    if (value !== undefined && !validateValue(value, def)) {
      errors.push(`Invalid value for field "${key}": expected ${def.type}, got ${typeof value}`)
    }
  }

  // Check for unknown fields
  for (const key of Object.keys(doc)) {
    if (!(key in fields)) {
      errors.push(`Unknown field: "${key}"`)
    }
  }

  return errors
}
