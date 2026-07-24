/**
 * Custom error classes for jcell.
 *
 * All errors extend from {@link JcellError} so consumers can catch
 * any jcell-specific error with a single `instanceof` check.
 *
 * ```ts
 * import { ValidationError, DuplicateError, NotFoundError } from '@sajjadbzn/jcell'
 *
 * try {
 *   await users.insert({ name: 42 } as any)
 * } catch (err) {
 *   if (err instanceof ValidationError) {
 *     console.error('Validation failed:', err.message)
 *   }
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

/**
 * Base class for all jcell-specific errors.
 * Every jcell error inherits from this so you can catch them all:
 *
 * ```ts
 * try { ... } catch (err) {
 *   if (err instanceof JcellError) { ... }
 * }
 * ```
 */
export class JcellError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------

/**
 * Thrown when a document fails schema validation on insert or update.
 *
 * ```ts
 * try {
 *   await users.insert({ name: 42 } as any)
 * } catch (err) {
 *   if (err instanceof ValidationError) {
 *     console.error(err.message)
 *     // "Validation failed:\nInvalid value for field \"name\": expected string, got number"
 *   }
 * }
 * ```
 */
export class ValidationError extends JcellError {
  constructor(message: string) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// DuplicateError
// ---------------------------------------------------------------------------

/**
 * Thrown when trying to insert a document with an id that already exists.
 *
 * ```ts
 * try {
 *   await users.insert({ id: 'existing-id', name: 'Alice' })
 * } catch (err) {
 *   if (err instanceof DuplicateError) {
 *     console.error(err.message)
 *     // 'Document with id "existing-id" already exists'
 *   }
 * }
 * ```
 */
export class DuplicateError extends JcellError {
  constructor(message: string) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// NotFoundError
// ---------------------------------------------------------------------------

/**
 * Thrown when a required document is not found.
 *
 * Used by `firstOrFail()` and other methods that expect a document to exist.
 *
 * ```ts
 * try {
 *   const user = await users.firstOrFail({ id: 'non-existent' })
 * } catch (err) {
 *   if (err instanceof NotFoundError) {
 *     console.error(err.message)
 *     // 'Document matching filter not found'
 *   }
 * }
 * ```
 */
export class NotFoundError extends JcellError {
  constructor(message?: string) {
    super(message ?? 'Document matching filter not found')
  }
}
