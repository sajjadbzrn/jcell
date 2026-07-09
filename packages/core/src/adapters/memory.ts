import type { StorageAdapter } from '../types'

/**
 * Create an in-memory storage adapter.
 * All data lives in a Map and is lost when the process exits.
 * Useful for tests and ephemeral runtimes.
 */
export function memoryAdapter(): StorageAdapter {
  const store = new Map<string, string>()

  return {
    async read(collection: string): Promise<string | null> {
      return store.get(collection) ?? null
    },
    async write(collection: string, data: string): Promise<void> {
      store.set(collection, data)
    },
    async exists(collection: string): Promise<boolean> {
      return store.has(collection)
    },
    async delete(collection: string): Promise<void> {
      store.delete(collection)
    },
  }
}
