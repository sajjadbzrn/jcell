# @sajjadbzn/jcell

**Lightweight, type-safe JSON-file database + ORM for TypeScript — runs on Node.js, Bun, and Cloudflare Workers.**

No external database server required. No codegen. No heavy dependencies. Full TypeScript inference, schema validation, pagination, aggregation, hooks, migrations, and D1 support.

```ts
import { createDB, schema, t, fileAdapter } from '@sajjadbzn/jcell'

const userSchema = schema({
  id: t.id(),
  name: t.string(),
  age: t.number().optional(),
  role: t.enum(['admin', 'user', 'guest'] as const),
  createdAt: t.date().default(() => new Date()),
})

const db = createDB({ adapter: fileAdapter({ path: './data' }) })
const users = db.collection('users', userSchema)

// CRUD
const user = await users.insert({ name: 'Sajjad', role: 'admin' })
await users.update({ id: user.id }, { age: 29 })
await users.delete({ id: user.id })

// Query builder
const admins = await users.where('role').eq('admin').orderByDesc('age').limit(10).find()

// Aggregation
const avgAge = await users.avg('age')
const total = await users.where('role').eq('admin').count()
```

## Install

```bash
npm install @sajjadbzn/jcell
# or
bun add @sajjadbzn/jcell
```

## Quick Start

### 1. Define a schema

```ts
import { schema, t } from '@sajjadbzn/jcell'

const taskSchema = schema({
  id: t.id(),
  title: t.string(),
  completed: t.boolean().default(false),
  priority: t.enum(['low', 'medium', 'high'] as const),
  tags: t.array(t.string()),
  createdAt: t.date().default(() => new Date()),
})
```

### 2. Create a database + collection

```ts
import { createDB, fileAdapter } from '@sajjadbzn/jcell'

// File adapter — persists to JSON files on disk
const db = createDB({ adapter: fileAdapter({ path: './data' }) })

// Memory adapter — ephemeral, great for tests
// import { memoryAdapter } from '@sajjadbzn/jcell'
// const db = createDB({ adapter: memoryAdapter() })

const tasks = db.collection('tasks', taskSchema)
```

### 3. Insert, find, update, delete

```ts
// Insert
const task = await tasks.insert({
  title: 'Write documentation',
  priority: 'high',
  tags: ['docs', 'typescript'],
})

// Find all
const all = await tasks.find()

// Find with filter
const incomplete = await tasks.find({ completed: false })

// Find first
const first = await tasks.first({ priority: 'high' })

// Update
await tasks.update({ id: task.id }, { completed: true, priority: 'medium' })

// Delete
await tasks.delete({ id: task.id })
```

---

## Schema Builders

| Builder | TS type | Notes |
|---------|---------|-------|
| `t.id()` | `string` | Auto-generated UUID |
| `t.string()` | `string` | |
| `t.number()` | `number` | |
| `t.boolean()` | `boolean` | |
| `t.date()` | `Date` | Serialized as ISO string |
| `t.array(t.string())` | `string[]` | Nested arrays of any type |
| `t.object({ ... })` | `{ ... }` | Nested objects |
| `t.enum(['a', 'b'] as const)` | `'a' \| 'b'` | Literal union |
| `t.ref('collectionName')` | `string` | Foreign key reference |

### Modifiers

```ts
t.string().optional()          // string | undefined
t.number().default(0)          // auto-filled with 0
t.date().default(() => new Date())  // factory function
t.string().index({ unique: true })  // index metadata
```

---

## Querying

### Simple filters

```ts
const admins = await users.find({ role: 'admin' })
const user = await users.first({ name: 'Alice' })
```

### Query builder

```ts
const results = await users
  .where('age').gt(18)
  .where('role').eq('admin')
  .where('name').startsWith('A')
  .find()
```

### Filter operators

| Operator | Description |
|----------|-------------|
| `.eq(value)` | Equal |
| `.ne(value)` | Not equal |
| `.gt(value)` | Greater than (number \| Date) |
| `.gte(value)` | Greater than or equal |
| `.lt(value)` | Less than |
| `.lte(value)` | Less than or equal |
| `.in(values)` | Value in array |
| `.contains(str)` | String contains substring |
| `.startsWith(str)` | String starts with |

### Sorting & Pagination

```ts
// Sort
const sorted = await posts
  .orderByDesc('views')
  .orderBy('title')
  .find()

// Limit & offset
const page = await posts
  .where('status').eq('published')
  .orderByDesc('createdAt')
  .limit(10).offset(0)
  .find()

// Page-based pagination (1-indexed)
const page2 = await posts.page(2, 10).orderByDesc('createdAt').find()

// Query without filter
const newest = await posts.query().orderByDesc('createdAt').limit(5).find()
```

### Aggregation

```ts
const total = await products.count()
const active = await products.count({ status: 'active' })
const totalRevenue = await products.sum('price')
const avgPrice = await products.avg('price')
const cheapest = await products.min('price')
const mostExpensive = await products.max('price')

// Chained with filters
const highValueTotal = await products
  .where('price').gt(100)
  .sum('price')
```

---

## Hooks / Middleware

Lifecycle hooks let you react to document changes:

```ts
const users = db.collection('users', userSchema)

users.hook('before:insert', async (doc) => {
  doc.createdAt = new Date()
})

users.hook('after:insert', async (doc) => {
  await auditLog.insert({ action: 'user_created', userId: doc.id })
})

users.hook('before:update', async (filter, changes) => {
  if (changes.role === 'admin') {
    // Validate the user is authorized
  }
})

users.hook('after:delete', async (filter, count) => {
  console.log(`Deleted ${count} user(s)`)
})
```

Available hooks: `before:insert`, `after:insert`, `before:update`, `after:update`, `before:delete`, `after:delete`.

---

## Relationships

Reference documents across collections with `t.ref()`:

```ts
const postSchema = schema({
  id: t.id(),
  title: t.string(),
  body: t.string(),
  authorId: t.ref('users'),
})

const commentSchema = schema({
  id: t.id(),
  postId: t.ref('posts'),
  body: t.string(),
})
```

Use `.with('field')` to populate relationships (available when using the Delegate strategy / D1 adapter):

```ts
const posts = await db.collection('posts', postSchema)
  .where('status').eq('published')
  .with('authorId')
  .find()
// Each post now has the full author document populated
```

---

## Transactions

Atomic multi-operation execution (supported by D1 adapter):

```ts
await db.transaction(async (tx) => {
  const from = await tx.collection('accounts').first({ id: 'acc1' })
  const to = await tx.collection('accounts').first({ id: 'acc2' })

  await tx.collection('accounts').update({ id: 'acc1' }, { balance: from!.balance - 100 })
  await tx.collection('accounts').update({ id: 'acc2' }, { balance: to!.balance + 100 })
})
// If anything throws, all changes are rolled back
```

---

## Indexing

```ts
// Create an index on a field
await users.createIndex('email', { unique: true })

// Drop an index
await users.dropIndex('email')
```

- **D1 adapter**: Creates real SQL indexes
- **Cache adapters** (file/memory): Builds in-memory Map-based indexes for O(1) lookups

---

## Migrations

Version your database schema with named migrations:

```ts
import { createDB, createMigration, schema, t } from '@sajjadbzn/jcell'

// Define migrations
const m001 = createMigration('001_create_users', {
  async up(db) {
    // Collections are auto-created on first use — no DDL needed with file/memory
    // With D1: db.collection('users', userSchema) triggers `CREATE TABLE IF NOT EXISTS`
    const users = db.collection('users', userSchema)
    await users.insert({ name: 'admin', email: 'admin@example.com', role: 'admin' })
  },
  async down(db) {
    // Only needed if you want rollback support
  },
})

// Apply pending migrations
const db = createDB({ adapter: fileAdapter({ path: './data' }) })
await db.migrate([m001])
```

Applied migrations are tracked in a `_migrations` collection — already-run migrations are safely skipped on subsequent calls.

---

## Adapters

### File adapter — Local JSON files

```ts
import { fileAdapter } from '@sajjadbzn/jcell'

const db = createDB({
  adapter: fileAdapter({ path: './data' }),
})
```

- Atomic writes (temp file → rename)
- Crash recovery via `.bak` fallback
- Write queue per collection

### Memory adapter — Ephemeral in-memory

```ts
import { memoryAdapter } from '@sajjadbzn/jcell'

const db = createDB({ adapter: memoryAdapter() })
```

All data lives in a Map. Perfect for tests, serverless functions, or transient workloads.

### D1 adapter — Cloudflare Workers

```ts
import { createDB, schema, t } from '@sajjadbzn/jcell'
import { d1Adapter } from '@sajjadbzn/jcell/d1'

const userSchema = schema({
  id: t.id(),
  name: t.string(),
  email: t.string(),
  role: t.enum(['admin', 'user'] as const),
})

export default {
  async fetch(request: Request, env: Env) {
    const db = createDB({ adapter: d1Adapter({ binding: env.DB }) })
    const users = db.collection('users', userSchema)

    const url = new URL(request.url)

    if (url.pathname === '/users') {
      const all = await users.find()
      return Response.json(all)
    }

    if (url.pathname === '/users/search') {
      const query = url.searchParams.get('q') ?? ''
      const results = await users.where('name').contains(query).limit(20).find()
      return Response.json(results)
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
}
```

Features on D1:
- Schema → SQL DDL auto-generation
- Nested objects/arrays stored as JSON TEXT columns
- Full query translation (filters → parameterized WHERE clauses)
- Aggregation via SQL `SUM/AVG/MIN/MAX/COUNT`
- Transactions via D1's batch API
- Real SQL indexes

### Custom adapter

Implement the `StorageAdapter` interface:

```ts
import type { StorageAdapter } from '@sajjadbzn/jcell'

const myAdapter: StorageAdapter = {
  async read(collection: string) { /* ... */ },
  async write(collection: string, data: string) { /* ... */ },
  async exists(collection: string) { /* ... */ },
  // Optional pro methods:
  // async query(collection, params) { ... }
  // async insertOne(collection, doc) { ... }
  // async transaction(fn) { ... }
}
```

| Adapter | Import path | Runtime |
|---------|-------------|---------|
| File | `@sajjadbzn/jcell` | Node.js, Bun |
| Memory | `@sajjadbzn/jcell` | Any |
| D1 | `@sajjadbzn/jcell/d1` | Cloudflare Workers |

---

## Express Example

```ts
import express from 'express'
import { createDB, schema, t, fileAdapter } from '@sajjadbzn/jcell'

const taskSchema = schema({
  id: t.id(),
  title: t.string(),
  completed: t.boolean().default(false),
  priority: t.enum(['low', 'medium', 'high'] as const),
  createdAt: t.date().default(() => new Date()),
})

const db = createDB({ adapter: fileAdapter({ path: './data' }) })
const tasks = db.collection('tasks', taskSchema)

const app = express()
app.use(express.json())

app.get('/tasks', async (_req, res) => {
  const page = Number(_req.query.page) || 1
  const result = await tasks.orderByDesc('createdAt').page(page, 20).find()
  res.json(result)
})

app.post('/tasks', async (req, res) => {
  try {
    const task = await tasks.insert({
      title: req.body.title,
      priority: req.body.priority ?? 'medium',
    })
    res.status(201).json(task)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

app.patch('/tasks/:id', async (req, res) => {
  const count = await tasks.update({ id: req.params.id }, req.body)
  if (count === 0) return res.status(404).json({ error: 'Not found' })
  const updated = await tasks.first({ id: req.params.id })
  res.json(updated)
})

app.delete('/tasks/:id', async (req, res) => {
  const count = await tasks.delete({ id: req.params.id })
  if (count === 0) return res.status(404).json({ error: 'Not found' })
  res.json({ deleted: true })
})

app.listen(3000, () => console.log('Running on http://localhost:3000'))
```

---

## Elysia Example (Bun)

```ts
import { Elysia, t as elysiaT } from 'elysia'
import { createDB, schema, t, fileAdapter } from '@sajjadbzn/jcell'

const taskSchema = schema({
  id: t.id(),
  title: t.string(),
  completed: t.boolean().default(false),
  priority: t.enum(['low', 'medium', 'high'] as const),
  createdAt: t.date().default(() => new Date()),
})

const db = createDB({ adapter: fileAdapter({ path: './data' }) })
const tasks = db.collection('tasks', taskSchema)

const app = new Elysia()
  .get('/tasks', async () => tasks.find())
  .get('/tasks/high-priority', async () =>
    tasks.where('priority').eq('high').where('completed').eq(false).find()
  )
  .post('/tasks', async ({ body }) => tasks.insert({ title: body.title, priority: body.priority }), {
    body: elysiaT.Object({ title: elysiaT.String(), priority: elysiaT.String() }),
  })
  .patch('/tasks/:id', async ({ params, body }) => {
    await tasks.update({ id: params.id }, body)
    return tasks.first({ id: params.id })
  })
  .delete('/tasks/:id', async ({ params }) => {
    await tasks.delete({ id: params.id })
    return { deleted: true }
  })
  .listen(3000)

console.log(`Running on http://localhost:${app.server?.port}`)
```

---

## Feature Comparison

| Feature | File/Memory | D1 |
|---------|:-----------:|:--:|
| Schema validation | ✓ | ✓ |
| CRUD | ✓ | ✓ |
| Query builder | ✓ | ✓ |
| Filter operators | ✓ | ✓ |
| Sorting | ✓ | ✓ |
| Pagination | ✓ | ✓ |
| Aggregation | ✓ | ✓ |
| Hooks | ✓ | ✓ |
| Relationships (t.ref) | ✓ | ✓ |
| Transactions | — | ✓ |
| Native indexing | Map-based | SQL indexes |
| Crash recovery | ✓ (.bak) | D1 built-in |
| Atomic writes | ✓ (rename) | SQL transactions |

---

## License

MIT
