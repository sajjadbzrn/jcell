import type { StorageAdapter } from '../types'
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Internal queue – serialize writes per collection
// ---------------------------------------------------------------------------

class WriteQueue {
  private _queues = new Map<string, Promise<void>>()

  enqueue(collection: string, fn: () => Promise<void>): Promise<void> {
    const prev = this._queues.get(collection) ?? Promise.resolve()
    const next = prev
      .then(fn)
      .then(() => {
        if (this._queues.get(collection) === next) {
          this._queues.delete(collection)
        }
      })
    this._queues.set(collection, next)
    return next
  }
}

// ---------------------------------------------------------------------------
// File adapter
// ---------------------------------------------------------------------------

export interface FileAdapterConfig {
  /** Directory to store collection files. Defaults to `./data`. */
  path?: string
}

/**
 * Create a file-system storage adapter with:
 * - Atomic writes (write to temp, rename over target)
 * - Single-writer queue per collection
 * - Crash recovery via `.bak` fallback
 */
export function fileAdapter(config: FileAdapterConfig = {}): StorageAdapter {
  const dataDir = config.path ?? './data'
  const queue = new WriteQueue()

  function collectionPath(name: string): string {
    return join(dataDir, `${name}.json`)
  }

  function backupPath(name: string): string {
    return join(dataDir, `${name}.json.bak`)
  }

  async function ensureDir(): Promise<void> {
    if (!existsSync(dataDir)) {
      await mkdir(dataDir, { recursive: true })
    }
  }

  async function atomicWrite(filePath: string, data: string): Promise<void> {
    const tmpPath = filePath + '.tmp'
    await writeFile(tmpPath, data, 'utf-8')
    await rename(tmpPath, filePath)
  }

  async function readWithFallback(
    filePath: string,
    backupFilePath: string,
  ): Promise<string | null> {
    if (!existsSync(filePath)) return null

    try {
      const content = await readFile(filePath, 'utf-8')
      JSON.parse(content)
      return content
    } catch {
      // corrupted – try backup
    }

    if (!existsSync(backupFilePath)) return null

    try {
      const content = await readFile(backupFilePath, 'utf-8')
      JSON.parse(content)
      return content
    } catch {
      return null
    }
  }

  return {
    async read(collection: string): Promise<string | null> {
      return readWithFallback(collectionPath(collection), backupPath(collection))
    },

    async write(collection: string, data: string): Promise<void> {
      await ensureDir()
      const filePath = collectionPath(collection)
      const backupFilePath = backupPath(collection)

      await queue.enqueue(collection, async () => {
        if (existsSync(filePath)) {
          try {
            const currentData = await readFile(filePath, 'utf-8')
            await writeFile(backupFilePath, currentData, 'utf-8')
          } catch {
            // best-effort backup
          }
        }
        await atomicWrite(filePath, data)
      })
    },

    async exists(collection: string): Promise<boolean> {
      return existsSync(collectionPath(collection))
    },

    async delete(collection: string): Promise<void> {
      const filePath = collectionPath(collection)
      const backupFilePath = backupPath(collection)

      await queue.enqueue(collection, async () => {
        if (existsSync(filePath)) await unlink(filePath)
        if (existsSync(backupFilePath)) await unlink(backupFilePath)
      })
    },
  }
}
