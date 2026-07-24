/**
 * jcell Studio — HTTP server with REST API.
 *
 * Provides all endpoints needed by the Studio frontend:
 *   - Browse, filter, sort, paginate collections
 *   - Create, update, delete documents
 *   - View schemas, indexes, relations
 *   - Run custom queries
 *   - Manage migrations
 */

import { createDB, schema, t, fileAdapter, sqliteAdapter } from '@sajjadbzn/jcell'
import type { StorageAdapter, DocWithId, FieldDef, FilterClause } from '@sajjadbzn/jcell'
import { readdir } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StudioConfig {
  adapter: 'file' | 'sqlite'
  path: string
  port: number
  host: string
  open: boolean
}

interface ServerInstance {
  stop: () => void
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function ok(data: unknown): Response {
  return json(data, 200)
}

function created(data: unknown): Response {
  return json(data, 201)
}

function badRequest(message: string): Response {
  return json({ error: message }, 400)
}

function notFound(message = 'Not found'): Response {
  return json({ error: message }, 404)
}

function serverError(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err)
  return json({ error: message }, 500)
}

// ---------------------------------------------------------------------------
// URL parser
// ---------------------------------------------------------------------------

function parseUrl(url: string): { pathname: string; searchParams: URLSearchParams } {
  const u = new URL(url, 'http://localhost')
  return { pathname: u.pathname, searchParams: u.searchParams }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export async function startServer(config: StudioConfig): Promise<ServerInstance> {
  // -----------------------------------------------------------------------
  // Initialize the database
  // -----------------------------------------------------------------------

  let adapter: StorageAdapter

  switch (config.adapter) {
    case 'file':
      adapter = fileAdapter({ path: config.path })
      break
    case 'sqlite':
      adapter = sqliteAdapter({ path: config.path })
      break
    default:
      throw new Error(`Unsupported adapter: ${config.adapter}`)
  }

  const db = createDB({ adapter })

  // -----------------------------------------------------------------------
  // Helper: Discover collections from the database
  //
  // For file adapter: list .json files in the data directory
  // For sqlite adapter: query sqlite_master
  // -----------------------------------------------------------------------

  type CollectionMeta = {
    name: string
    documentCount: number
  }

  /**
   * Validate a collection name to prevent path traversal attacks.
   */
  function validateCollectionName(name: string): string | null {
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      return null
    }
    return name
  }

  async function discoverCollections(): Promise<CollectionMeta[]> {
    const allCollections: CollectionMeta[] = []

    if (config.adapter === 'file') {
      // Scan the data directory for .json files
      if (!existsSync(config.path)) {
        return []
      }
      const entries = await readdir(config.path)
      const jsonFiles = entries.filter((f) => f.endsWith('.json') && !f.endsWith('.bak') && !f.endsWith('.tmp'))

      for (const file of jsonFiles) {
        const name = file.replace('.json', '')
        // Skip system files
        if (name.startsWith('_') || !validateCollectionName(name)) continue

        try {
          const raw = await adapter.read(name)
          if (raw) {
            const docs = JSON.parse(raw) as unknown[]
            allCollections.push({ name, documentCount: docs.length })
          } else {
            allCollections.push({ name, documentCount: 0 })
          }
        } catch {
          allCollections.push({ name, documentCount: 0 })
        }
      }
    } else if (config.adapter === 'sqlite') {
      // Query sqlite_master to discover user tables.
      // The SQLite adapter's read() does SELECT * FROM "table_name", which
      // works on sqlite_master since it's a regular SQLite system table.
      try {
        const raw = await adapter.read('sqlite_master')
        if (raw) {
          const rows = JSON.parse(raw) as Record<string, unknown>[]
          // Filter for user tables only — skip system/internal tables
          const userTables = rows.filter(
            (r) =>
              r.type === 'table' &&
              typeof r.name === 'string' &&
              !r.name.startsWith('_') &&
              !r.name.startsWith('sqlite_'),
          )
          for (const row of userTables) {
            const name = row.name as string
            if (!validateCollectionName(name)) continue
            try {
              const countResult = await adapter.count!(name)
              allCollections.push({ name, documentCount: countResult })
            } catch {
              allCollections.push({ name, documentCount: 0 })
            }
          }
        }
      } catch {
        // sqlite_master query failed — return empty collections
      }
    }

    return allCollections
  }

  // -----------------------------------------------------------------------
  // Helper: Read a collection's documents with optional filtering
  // -----------------------------------------------------------------------

  async function readCollectionData(
    collectionName: string,
    params: {
      filter?: string
      sort?: string
      order?: 'asc' | 'desc'
      page?: number
      limit?: number
    },
  ): Promise<{ docs: Record<string, unknown>[]; total: number }> {
    const raw = await adapter.read(collectionName)
    if (!raw) return { docs: [], total: 0 }

    let docs: Record<string, unknown>[]
    try {
      docs = JSON.parse(raw) as Record<string, unknown>[]
    } catch {
      return { docs: [], total: 0 }
    }

    // Filter
    if (params.filter) {
      const search = params.filter.toLowerCase()
      docs = docs.filter((doc) =>
        Object.values(doc).some((v) =>
          String(v).toLowerCase().includes(search),
        ),
      )
    }

    // Sort
    if (params.sort) {
      const field = params.sort
      const dir = params.order === 'desc' ? -1 : 1
      docs.sort((a, b) => {
        const aVal = a[field]
        const bVal = b[field]
        if (aVal == null) return 1
        if (bVal == null) return -1
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return (aVal - bVal) * dir
        }
        return String(aVal).localeCompare(String(bVal)) * dir
      })
    }

    const total = docs.length

    // Paginate
    const page = params.page ?? 1
    const limit = params.limit ?? 50
    const start = (page - 1) * limit
    docs = docs.slice(start, start + limit)

    return { docs, total }
  }

  // -----------------------------------------------------------------------
  // Helper: Inspect schema from a sample document
  // -----------------------------------------------------------------------

  function inferSchema(docs: Record<string, unknown>[]): Record<string, { type: string; required: boolean; sample: unknown }> {
    const schema: Record<string, { type: string; required: boolean; sample: unknown }> = {}
    const seen = new Set<string>()

    for (const doc of docs) {
      for (const [key, value] of Object.entries(doc)) {
        if (!seen.has(key)) {
          seen.add(key)
          schema[key] = {
            type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
            required: true,
            sample: value,
          }
        }
      }
    }

    return schema
  }

  // -----------------------------------------------------------------------
  // Routes
  // -----------------------------------------------------------------------

  const frontendDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend')

  async function handleRequest(req: Request): Promise<Response> {
    const { pathname, searchParams } = parseUrl(req.url)
    const method = req.method

    try {
      // ── Health ──────────────────────────────────────────────────────
      if (method === 'GET' && pathname === '/api/health') {
        return ok({ status: 'ok', adapter: config.adapter, path: config.path })
      }

      // ── Collections list ────────────────────────────────────────────
      if (method === 'GET' && pathname === '/api/collections') {
        const collections = await discoverCollections()
        return ok(collections)
      }

      // ── Collection data ─────────────────────────────────────────────
      const collectionMatch = pathname.match(/^\/api\/collections\/([^/]+)$/)
      if (collectionMatch && method === 'GET') {
        const name = decodeURIComponent(collectionMatch[1]!)
        if (!validateCollectionName(name)) return badRequest('Invalid collection name')
        const data = await readCollectionData(name, {
          filter: searchParams.get('filter') || undefined,
          sort: searchParams.get('sort') || undefined,
          order: (searchParams.get('order') as 'asc' | 'desc') || undefined,
          page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : undefined,
          limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
        })
        return ok(data)
      }

      // ── Collection schema ───────────────────────────────────────────
      const schemaMatch = pathname.match(/^\/api\/collections\/([^/]+)\/schema$/)
      if (schemaMatch && method === 'GET') {
        const name = decodeURIComponent(schemaMatch[1]!)
        if (!validateCollectionName(name)) return badRequest('Invalid collection name')
        const raw = await adapter.read(name)
        if (!raw) return notFound(`Collection "${name}" not found`)

        let docs: Record<string, unknown>[]
        try {
          docs = JSON.parse(raw) as Record<string, unknown>[]
        } catch {
          docs = []
        }

        const inferred = inferSchema(docs)
        return ok({
          name,
          fields: inferred,
          documentCount: docs.length,
        })
      }

      // ── Insert document ─────────────────────────────────────────────
      const insertMatch = pathname.match(/^\/api\/collections\/([^/]+)\/documents$/)
      if (insertMatch && method === 'POST') {
        const name = decodeURIComponent(insertMatch[1]!)
        if (!validateCollectionName(name)) return badRequest('Invalid collection name')
        const body = await req.json() as Record<string, unknown>

        // Read existing docs
        const raw = await adapter.read(name)
        let docs: Record<string, unknown>[] = []
        if (raw) {
          try { docs = JSON.parse(raw) as Record<string, unknown>[] } catch {}
        }

        // Generate id if not provided
        if (!body.id) {
          body.id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        }

        docs.push(body)
        await adapter.write(name, JSON.stringify(docs, null, 2))
        return created(body)
      }

      // ── Update document ─────────────────────────────────────────────
      const updateMatch = pathname.match(/^\/api\/collections\/([^/]+)\/documents\/([^/]+)$/)
      if (updateMatch && method === 'PUT') {
        const name = decodeURIComponent(updateMatch[1]!)
        if (!validateCollectionName(name)) return badRequest('Invalid collection name')
        const id = decodeURIComponent(updateMatch[2]!)
        const body = await req.json() as Record<string, unknown>

        const raw = await adapter.read(name)
        if (!raw) return notFound(`Collection "${name}" not found`)

        let docs: Record<string, unknown>[]
        try {
          docs = JSON.parse(raw) as Record<string, unknown>[]
        } catch {
          return serverError('Failed to parse collection data')
        }

        const index = docs.findIndex((d) => d.id === id)
        if (index === -1) return notFound(`Document "${id}" not found`)

        docs[index] = { ...docs[index], ...body, id }
        await adapter.write(name, JSON.stringify(docs, null, 2))
        return ok(docs[index])
      }

      // ── Delete document ─────────────────────────────────────────────
      const deleteMatch = pathname.match(/^\/api\/collections\/([^/]+)\/documents\/([^/]+)$/)
      if (deleteMatch && method === 'DELETE') {
        const name = decodeURIComponent(deleteMatch[1]!)
        if (!validateCollectionName(name)) return badRequest('Invalid collection name')
        const id = decodeURIComponent(deleteMatch[2]!)

        const raw = await adapter.read(name)
        if (!raw) return notFound(`Collection "${name}" not found`)

        let docs: Record<string, unknown>[]
        try {
          docs = JSON.parse(raw) as Record<string, unknown>[]
        } catch {
          return serverError('Failed to parse collection data')
        }

        const before = docs.length
        docs = docs.filter((d) => d.id !== id)
        if (docs.length === before) return notFound(`Document "${id}" not found`)

        await adapter.write(name, JSON.stringify(docs, null, 2))
        return ok({ deleted: true, id })
      }

      // ── Query runner ────────────────────────────────────────────────
      if (method === 'POST' && pathname === '/api/query') {
        const body = await req.json() as { collection: string; filter?: Record<string, unknown> }
        const { collection: colName, filter } = body

        if (!colName) return badRequest('Missing "collection" field')

        const raw = await adapter.read(colName)
        if (!raw) return notFound(`Collection "${colName}" not found`)

        let docs: Record<string, unknown>[]
        try {
          docs = JSON.parse(raw) as Record<string, unknown>[]
        } catch {
          return serverError('Failed to parse collection data')
        }

        // Apply filter if provided
        if (filter && Object.keys(filter).length > 0) {
          docs = docs.filter((doc) =>
            Object.entries(filter).every(([key, value]) => doc[key] === value),
          )
        }

        return ok({ collection: colName, count: docs.length, documents: docs })
      }

      // ── Migrations ──────────────────────────────────────────────────
      if (method === 'GET' && pathname === '/api/migrations') {
        // Read _migrations collection if it exists
        const raw = await adapter.read('_migrations')
        let migrations: Record<string, unknown>[] = []
        if (raw) {
          try { migrations = JSON.parse(raw) as Record<string, unknown>[] } catch {}
        }
        return ok(migrations)
      }

      // ── Relations ───────────────────────────────────────────────────
      if (method === 'GET' && pathname === '/api/relations') {
        // Infer relations by scanning documents for ref-like fields
        const collections = await discoverCollections()
        const relations: Array<{ from: string; field: string; to: string }> = []

        for (const col of collections) {
          const raw = await adapter.read(col.name)
          if (!raw) continue

          let docs: Record<string, unknown>[]
          try { docs = JSON.parse(raw) as Record<string, unknown>[] } catch { continue }

          if (docs.length === 0) continue

          // Look at the first document's fields to guess relations
          const first = docs[0]
          for (const [key, value] of Object.entries(first)) {
            if (key === 'id') continue
            if ((typeof value === 'string' && key.endsWith('Id')) || key.endsWith('_id') || key === 'parentId' || key.endsWith('IdRef')) {
              // The field likely references another collection
              let toCollection = key.replace(/[Ii]d$/, '').replace(/[Ii]d[Rr]ef$/, '').replace(/_id$/, '')
              // Pluralize by adding 's' if not already plural
              if (!toCollection.endsWith('s')) toCollection += 's'
              relations.push({
                from: col.name,
                field: key,
                to: toCollection,
              })
            }
          }
        }

        return ok(relations)
      }

      // ── Statistics/Dashboard ────────────────────────────────────────
      if (method === 'GET' && pathname === '/api/stats') {
        const collections = await discoverCollections()
        let totalDocs = 0
        let totalCollections = collections.length

        for (const col of collections) {
          totalDocs += col.documentCount
        }

        return ok({
          adapter: config.adapter,
          path: config.path,
          totalCollections,
          totalDocuments: totalDocs,
          collections,
        })
      }

      // ── Static frontend files ───────────────────────────────────────
      // Serve index.html for the root and any non-API path
      if (!pathname.startsWith('/api/')) {
        let filePath: string
        let mimeType: string

        if (pathname === '/' || pathname === '/index.html') {
          filePath = join(frontendDir, 'index.html')
          mimeType = 'text/html; charset=utf-8'
        } else {
          filePath = join(frontendDir, pathname)
          const ext = extname(pathname)
          mimeType = MIME[ext] || 'application/octet-stream'
        }

        try {
          const content = await Bun.file(filePath).bytes()
          return new Response(content, {
            status: 200,
            headers: { 'content-type': mimeType },
          })
        } catch {
          // SPA fallback: serve index.html for client-side routing
          try {
            const content = await Bun.file(join(frontendDir, 'index.html')).bytes()
            return new Response(content, {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8' },
            })
          } catch {
            return notFound('File not found')
          }
        }
      }

      return notFound(`Route not found: ${method} ${pathname}`)
    } catch (err) {
      return serverError(err)
    }
  }

  // -----------------------------------------------------------------------
  // Start server
  // -----------------------------------------------------------------------

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: handleRequest,
  })

  return {
    stop: () => {
      server.stop()
    },
  }
}
