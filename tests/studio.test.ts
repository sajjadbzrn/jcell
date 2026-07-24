/**
 * jcell Studio — End-to-End Test
 *
 * Starts the studio server with sample data in a temp directory,
 * tests all REST API endpoints, then shuts down cleanly.
 *
 * Run: bun test tests/studio.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { startServer } from '../packages/studio/src/server.js'
import { createDB, schema, t, fileAdapter } from '../packages/core/src/index.js'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const TEST_PORT = 5588
const TEST_HOST = '127.0.0.1'
const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`
const TEST_DIR = join(import.meta.dir, '.test-data-studio')

// Sample data schemas
const userSchema = schema({
  id: t.id(),
  name: t.string(),
  email: t.string().optional(),
  age: t.number().optional(),
  role: t.enum(['admin', 'user', 'guest'] as const),
})

const postSchema = schema({
  id: t.id(),
  title: t.string(),
  content: t.string().optional(),
  authorId: t.string(),
  published: t.boolean().default(false),
})

type User = typeof userSchema.infer
type Post = typeof postSchema.infer

let server: { stop: () => void } | null = null

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

async function seedData(): Promise<void> {
  const db = createDB({ adapter: fileAdapter({ path: TEST_DIR }) })

  const users = db.collection<User>('users', userSchema)
  const posts = db.collection<Post>('posts', postSchema)

  await users.insert({ name: 'Alice', email: 'alice@example.com', age: 30, role: 'admin' })
  await users.insert({ name: 'Bob', email: 'bob@example.com', age: 25, role: 'user' })
  await users.insert({ name: 'Charlie', age: 35, role: 'admin' })
  await users.insert({ name: 'Diana', email: 'diana@test.com', age: 20, role: 'guest' })
  await users.insert({ name: 'Eve', age: 28, role: 'user' })

  await posts.insert({ title: 'Getting Started', content: 'Hello world!', authorId: '1', published: true })
  await posts.insert({ title: 'Advanced Topics', content: 'Deep dive...', authorId: '1', published: true })
  await posts.insert({ title: 'Draft Post', content: 'Work in progress', authorId: '2', published: false })
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function api(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
  })
}

async function apiJson(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await api(path, options)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${options.method || 'GET'} ${path} returned ${res.status}: ${body}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('jcell Studio', () => {
  // ── Lifecycle ───────────────────────────────────────────────────────
  beforeAll(async () => {
    // Clean any leftover test data
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true })
    }
    await mkdir(TEST_DIR, { recursive: true })

    // Seed sample data
    await seedData()

    // Start the server
    server = await startServer({
      adapter: 'file',
      path: TEST_DIR,
      port: TEST_PORT,
      host: TEST_HOST,
      open: false,
    })
  })

  afterAll(async () => {
    // Stop the server
    if (server) {
      server.stop()
      server = null
    }

    // Clean up test data
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true })
    }
  })

  // ── Health check ────────────────────────────────────────────────────
  it('GET /api/health returns ok', async () => {
    const res = await apiJson('/api/health') as Record<string, unknown>
    expect(res.status).toBe('ok')
    expect(res.adapter).toBe('file')
  })

  // ── Stats / Dashboard ───────────────────────────────────────────────
  it('GET /api/stats returns collection counts', async () => {
    const res = await apiJson('/api/stats') as Record<string, unknown>
    expect(res.totalCollections).toBe(2)
    expect(res.totalDocuments).toBe(8) // 5 users + 3 posts
    expect(res.adapter).toBe('file')

    const collections = res.collections as Array<{ name: string; documentCount: number }>
    expect(collections.length).toBe(2)

    const usersCol = collections.find((c) => c.name === 'users')
    expect(usersCol).toBeDefined()
    expect(usersCol!.documentCount).toBe(5)

    const postsCol = collections.find((c) => c.name === 'posts')
    expect(postsCol).toBeDefined()
    expect(postsCol!.documentCount).toBe(3)
  })

  // ── List collections ────────────────────────────────────────────────
  it('GET /api/collections lists all collections', async () => {
    const res = await apiJson('/api/collections') as Array<{ name: string; documentCount: number }>
    expect(res.length).toBe(2)
    expect(res.some((c) => c.name === 'users')).toBe(true)
    expect(res.some((c) => c.name === 'posts')).toBe(true)
  })

  // ── Browse collection data ──────────────────────────────────────────
  it('GET /api/collections/:name returns documents', async () => {
    const res = await apiJson('/api/collections/users') as { docs: Record<string, unknown>[]; total: number }
    expect(res.total).toBe(5)
    expect(res.docs.length).toBe(5)
    expect(res.docs[0]).toHaveProperty('id')
    expect(res.docs[0]).toHaveProperty('name')
    expect(res.docs[0]).toHaveProperty('role')
  })

  // ── Filter data ─────────────────────────────────────────────────────
  it('GET /api/collections/:name?filter= searches across all fields', async () => {
    const res = await apiJson('/api/collections/users?filter=alice') as { docs: Record<string, unknown>[]; total: number }
    expect(res.total).toBe(1)
    expect(res.docs[0]!.name).toBe('Alice')
  })

  // ── Sort data ───────────────────────────────────────────────────────
  it('GET /api/collections/:name?sort= sorts ascending', async () => {
    const res = await apiJson('/api/collections/users?sort=age&order=asc') as { docs: Record<string, unknown>[] }
    const ages = res.docs.map((d) => d.age as number)
    expect(ages).toEqual([20, 25, 28, 30, 35])
  })

  it('GET /api/collections/:name?sort= sorts descending', async () => {
    const res = await apiJson('/api/collections/users?sort=age&order=desc') as { docs: Record<string, unknown>[] }
    const ages = res.docs.map((d) => d.age as number)
    expect(ages).toEqual([35, 30, 28, 25, 20])
  })

  // ── Pagination ──────────────────────────────────────────────────────
  it('GET /api/collections/:name?page=&limit= paginates', async () => {
    const page1 = await apiJson('/api/collections/users?page=1&limit=2') as { docs: Record<string, unknown>[]; total: number }
    expect(page1.docs.length).toBe(2)
    expect(page1.total).toBe(5)

    const page2 = await apiJson('/api/collections/users?page=2&limit=2') as { docs: Record<string, unknown>[]; total: number }
    expect(page2.docs.length).toBe(2)

    const page3 = await apiJson('/api/collections/users?page=3&limit=2') as { docs: Record<string, unknown>[]; total: number }
    expect(page3.docs.length).toBe(1)
  })

  // ── Schema viewer ───────────────────────────────────────────────────
  it('GET /api/collections/:name/schema returns field info', async () => {
    const res = await apiJson('/api/collections/users/schema') as Record<string, unknown>
    expect(res.name).toBe('users')
    expect(res.documentCount).toBe(5)
    const fields = res.fields as Record<string, { type: string }>
    expect(fields['name'].type).toBe('string')
    expect(fields['age'].type).toBe('number')
    expect(fields['role'].type).toBe('string')
  })

  // ── Insert document ─────────────────────────────────────────────────
  it('POST /api/collections/:name/documents inserts a doc', async () => {
    const doc = await apiJson('/api/collections/users/documents', {
      method: 'POST',
      body: JSON.stringify({ name: 'Frank', age: 40, role: 'admin' }),
    }) as Record<string, unknown>

    expect(doc.name).toBe('Frank')
    expect(doc.age).toBe(40)
    expect(doc.id).toBeDefined()

    // Verify it persisted
    const res = await apiJson('/api/collections/users') as { docs: Record<string, unknown>[]; total: number }
    expect(res.total).toBe(6) // 5 original + 1 new
    expect(res.docs.some((d) => d.name === 'Frank')).toBe(true)
  })

  // ── Update document ─────────────────────────────────────────────────
  it('PUT /api/collections/:name/documents/:id updates a doc', async () => {
    // Get the first user
    const list = await apiJson('/api/collections/users?limit=1') as { docs: Array<{ id: string; name: string }> }
    const firstUser = list.docs[0]!

    const updated = await apiJson(`/api/collections/users/documents/${firstUser.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Alice Updated', email: 'alice.new@example.com' }),
    }) as Record<string, unknown>

    expect(updated.name).toBe('Alice Updated')
    expect(updated.email).toBe('alice.new@example.com')

    // Verify it persisted via the collection data endpoint
    const check = await apiJson('/api/collections/users') as { docs: Array<Record<string, unknown>> }
    const found = check.docs.find((d) => d.id === firstUser.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe('Alice Updated')
    expect(found!.email).toBe('alice.new@example.com')
  })

  // ── Delete document ─────────────────────────────────────────────────
  it('DELETE /api/collections/:name/documents/:id deletes a doc', async () => {
    const list = await apiJson('/api/collections/posts') as { docs: Array<{ id: string; title: string }>; total: number }
    const before = list.total
    const postToDelete = list.docs[0]!

    const result = await apiJson(`/api/collections/posts/documents/${postToDelete.id}`, {
      method: 'DELETE',
    }) as Record<string, unknown>
    expect(result.deleted).toBe(true)

    // Verify
    const after = await apiJson('/api/collections/posts') as { total: number }
    expect(after.total).toBe(before - 1)
  })

  // ── Query runner ────────────────────────────────────────────────────
  it('POST /api/query executes a query', async () => {
    const result = await apiJson('/api/query', {
      method: 'POST',
      body: JSON.stringify({ collection: 'users', filter: { role: 'admin' } }),
    }) as { collection: string; count: number; documents: Record<string, unknown>[] }

    expect(result.collection).toBe('users')
    // Alice, Charlie, Frank (from our insert above) are admins
    expect(result.count).toBe(3)
    expect(result.documents.every((d) => d.role === 'admin')).toBe(true)
  })

  it('POST /api/query returns all docs with empty filter', async () => {
    const result = await apiJson('/api/query', {
      method: 'POST',
      body: JSON.stringify({ collection: 'users', filter: {} }),
    }) as { count: number }

    expect(result.count).toBe(6) // 5 original + 1 Frank
  })

  // ── Migrations ──────────────────────────────────────────────────────
  it('GET /api/migrations returns applied migrations', async () => {
    const result = await apiJson('/api/migrations') as unknown[]
    // No migrations were applied in this test
    expect(Array.isArray(result)).toBe(true)
  })

  // ── Relations ───────────────────────────────────────────────────────
  it('GET /api/relations discovers relations from ref fields', async () => {
    const result = await apiJson('/api/relations') as Array<{ from: string; field: string; to: string }>
    // posts has authorId which should be detected
    const authorRelation = result.find((r) => r.field === 'authorId')
    expect(authorRelation).toBeDefined()
    expect(authorRelation!.from).toBe('posts')
    expect(authorRelation!.to).toBe('authors') // 'author' + 's' = 'authors'
  })

  // ── Security: Path traversal ────────────────────────────────────────
  it('rejects path traversal in collection name', async () => {
    // URL-encode the traversal so it survives URL normalization
    // %2E%2E%2F = ../  (decoded by the server's decodeURIComponent)
    const res = await api('/api/collections/%2E%2E%2Fetc%2Fpasswd')
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('Invalid collection name')
  })

  // ── Static frontend ─────────────────────────────────────────────────
  it('GET / serves the frontend', async () => {
    const res = await fetch(`${BASE_URL}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')

    const text = await res.text()
    expect(text).toContain('jcell Studio')
    expect(text).toContain('sidebar')
  })

  it('GET /styles.css serves the stylesheet', async () => {
    const res = await fetch(`${BASE_URL}/styles.css`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/css')

    const text = await res.text()
    expect(text).toContain(':root')
    expect(text).toContain('sidebar')
  })

  it('GET /app.js serves the application JS', async () => {
    const res = await fetch(`${BASE_URL}/app.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')

    const text = await res.text()
    expect(text).toContain('renderDashboard')
    expect(text).toContain('renderDataBrowser')
    expect(text).toContain('escapeHtml')
  })

  // ── Error handling ──────────────────────────────────────────────────
  it('returns 404 for unknown routes', async () => {
    const res = await api('/api/nonexistent')
    expect(res.status).toBe(404)
  })

  it('returns empty data for non-existent collection', async () => {
    const res = await apiJson('/api/collections/nonexistent') as { docs: unknown[]; total: number }
    expect(res.docs).toEqual([])
    expect(res.total).toBe(0)
  })

  it('returns 400 for missing collection in query', async () => {
    const res = await api('/api/query', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
