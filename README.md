# @sajjadbzn/jcell

**Lightweight, type-safe document database + ORM for TypeScript — runs on Node.js, Bun, and Cloudflare Workers.**

No external database server. No codegen. No heavy dependencies. Full TypeScript inference, schema validation, pagination, aggregation, hooks, migrations, **SQLite support**, and a **built-in Studio UI**.

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

---

## Packages

| Package | Description | Docs |
|---------|-------------|------|
| `@sajjadbzn/jcell` | Core database engine + adapters | [below](#features) |
| `@sajjadbzn/jcell/d1` | Cloudflare Workers entrypoint | [D1 section](#d1-adapter--cloudflare-workers) |
| `@sajjadbzn/jcell-studio` | 🔥 **Studio UI** — browse data visually | [Studio section](#jcell-studio-ui) |

---

## Install

```bash
npm install @sajjadbzn/jcell
# or
bun add @sajjadbzn/jcell
```

### Studio (optional)

```bash
npm install -D @sajjadbzn/jcell-studio
# or
bun add -D @sajjadbzn/jcell-studio
```

---

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

// TypeScript types are inferred automatically:
type Task = typeof taskSchema.infer
// { id: string; title: string; completed: boolean; priority: 'low' | 'medium' | 'high'; tags: string[]; createdAt: Date }
```

### 2. Create a database + collection

```ts
import { createDB, fileAdapter } from '@sajjadbzn/jcell'

// File adapter — persists to JSON files on disk
const db = createDB({ adapter: fileAdapter({ path: './data' }) })

// Memory adapter — ephemeral, great for tests
// const db = createDB({ adapter: memoryAdapter() })

// SQLite adapter — local SQLite database
// const db = createDB({ adapter: sqliteAdapter({ path: './app.db' }) })

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

### 4. Open Studio (optional)

```bash
npx jcell-studio
# → Opens http://127.0.0.1:5555 with a full data browser UI
```

---

## Features

- ✅ **Zero setup** — install and start storing data
- ✅ **Fully typed** — schemas infer TypeScript types automatically, no codegen
- ✅ **4 adapters** — File, Memory, SQLite, Cloudflare D1
- ✅ **Atomic writes** — temp file + rename (file adapter)
- ✅ **Crash recovery** — `.bak` snapshot fallback (file adapter)
- ✅ **Schema validation** — every document validated on insert/update
- ✅ **Query builder** — fluent API with 10 filter operators
- ✅ **Aggregation** — `sum`, `avg`, `min`, `max`, `count` with optional filters
- ✅ **Pagination** — `limit`/`offset` and `page()` helper
- ✅ **Sorting** — multi-field, ascending/descending
- ✅ **Hooks / middleware** — `before:insert`, `after:update`, etc.
- ✅ **Relationships** — `t.ref('collection')` with `.with()` population
- ✅ **Transactions** — atomic multi-operation (SQLite, D1)
- ✅ **Indexing** — in-memory Map indexes + SQL indexes
- ✅ **Migrations** — named, version-tracked schema migrations
- ✅ **OR queries** — `orWhere()` with mixed AND/OR logic
- ✅ **Aggregation pipeline** — `$match`, `$group`, `$sort`, `$or`, `$and`, etc.
- ✅ **Studio UI** — visual data browser (optional package)

---

## Schema Builders

| Builder | TS type | Notes |
|---------|---------|-------|
| `t.id()` | `string` | Auto-generated UUID v4 |
| `t.string()` | `string` | |
| `t.number()` | `number` | |
| `t.boolean()` | `boolean` | |
| `t.date()` | `Date` | Serialized as ISO string |
| `t.array(t.string())` | `string[]` | Nested arrays of any type |
| `t.object({ ... })` | `{ ... }` | Nested objects with typed fields |
| `t.enum(['a', 'b'] as const)` | `'a' \| 'b'` | Literal union type |
| `t.ref('collectionName')` | `string` | Foreign key reference |

### Modifiers

```ts
t.string().optional()                        // string | undefined
t.number().default(0)                        // auto-filled with 0
t.date().default(() => new Date())           // factory function
t.string().index({ unique: true })           // index metadata
t.array(t.object({ key: t.string() }))       // array of objects
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

### OR queries

```ts
// role = 'guest' OR age >= 30
const results = await users
  .where('role').eq('guest')
  .orWhere('age').gte(30)
  .find()
```

### Sorting & Pagination

```ts
// Multi-field sort
const sorted = await posts
  .orderByDesc('views')
  .orderBy('title')
  .find()

// Limit & offset
const page1 = await posts
  .where('status').eq('published')
  .orderByDesc('createdAt')
  .limit(10).offset(0)
  .find()

// Page-based pagination (1-indexed)
const page2 = await posts
  .page(2, 10)
  .orderByDesc('createdAt')
  .find()

// Query without initial filter
const newest = await posts
  .query()
  .orderByDesc('createdAt')
  .limit(5)
  .find()
```

### Select (projection)

```ts
const partial = await users
  .where('role').eq('admin')
  .select(['id', 'name'])
  .find()
// Returns documents with only id and name fields
```

### firstOrFail

```ts
const user = await users.firstOrFail({ id: 'abc' })
// Throws NotFoundError if no document matches
```

### Chained count

```ts
const adminCount = await users.where('role').eq('admin').count()
```

---

## Aggregation

```ts
const total = await products.count()
const active = await products.count({ status: 'active' })
const totalRevenue = await products.sum('price')
const avgPrice = await products.avg('price')
const cheapest = await products.min('price')
const mostExpensive = await products.max('price')

// Chained with query filters
const highValueTotal = await products
  .where('price').gt(100)
  .sum('price')
```

### Aggregation Pipeline

For advanced use cases, the memory and file adapters support a MongoDB-style aggregation pipeline:

```ts
// @ts-expect-error - access adapter internals
const result = await adapter.aggregate('users', [
  { $match: { $or: [{ role: 'admin' }, { age: { $gte: 30 } }] } },
  { $group: { _id: null, totalScore: { $sum: '$score' } } },
])
```

Supported stages: `$match`, `$group` (`$sum`/`$avg`/`$min`/`$max`), `$sort`, `$limit`, `$skip`, `$count`, `$or`, `$and`.

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
    // Validate authorization
  }
})

users.hook('after:delete', async (filter, count) => {
  console.log(`Deleted ${count} user(s)`)
})
```

Available hooks: `before:insert`, `after:insert`, `before:update`, `after:update`, `before:delete`, `after:delete`.

---

## Batch Operations

```ts
// Insert multiple at once
const users = await db.collection('users', userSchema)
  .insertMany([
    { name: 'Alice', role: 'admin' },
    { name: 'Bob', role: 'user' },
  ])

// Update ALL documents
const count = await users.updateAll({ role: 'guest' })

// Delete ALL documents
const deleted = await users.deleteAll()
```

---

## Relationships

Reference documents across collections with `t.ref()`:

```ts
const postSchema = schema({
  id: t.id(),
  title: t.string(),
  authorId: t.ref('users'),  // references the 'users' collection
})
```

Use `.with('field')` to populate referenced documents:

```ts
const posts = await db.collection('posts', postSchema)
  .where('status').eq('published')
  .with('authorId')
  .find()
// Each post.authorId is now the full author document
```

---

## Transactions

Atomic multi-operation execution (supported by SQLite and D1 adapters):

```ts
await db.transaction(async (tx) => {
  const accounts = tx.collection('accounts', accountSchema)

  const from = await accounts.first({ id: 'acc1' })
  const to = await accounts.first({ id: 'acc2' })

  await accounts.update({ id: 'acc1' }, { balance: from!.balance - 100 })
  await accounts.update({ id: 'acc2' }, { balance: to!.balance + 100 })
})
// If anything throws, ALL changes are rolled back
```

---

## Indexing

```ts
// Create an index on a field
await users.createIndex('email', { unique: true })

// Drop an index
await users.dropIndex('email')
```

- **D1 / SQLite adapters**: Creates real SQL indexes
- **Cache adapters** (file/memory): Builds in-memory Map-based indexes for O(1) lookups

---

## Migrations

Version your database schema with named migrations:

```ts
import { createDB, createMigration, schema, t, fileAdapter } from '@sajjadbzn/jcell'

const m001 = createMigration('001_create_users', {
  async up(db) {
    const users = db.collection('users', userSchema)
    await users.insert({ name: 'admin', role: 'admin' })
  },
  async down(db) {
    // Rollback logic here
  },
})

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

- Atomic writes (temp file → rename over target)
- Crash recovery via `.bak` fallback
- Single-writer queue per collection
- Best for: local development, single-user apps

### SQLite adapter — Local SQLite database

```ts
import { sqliteAdapter } from '@sajjadbzn/jcell'

const db = createDB({
  adapter: sqliteAdapter({ path: './app.db' }),
})
```

Requires `better-sqlite3`: `npm install better-sqlite3`

- Real SQL DDL auto-generation from schemas
- Full query translation (filters → parameterized WHERE clauses)
- Native aggregation via SQL `SUM/AVG/MIN/MAX/COUNT`
- Real SQL indexes (`CREATE INDEX`)
- WAL mode for concurrent read performance
- Foreign key enforcement
- Transactions support
- Best for: larger datasets, concurrent access, production

### Memory adapter — Ephemeral in-memory

```ts
import { memoryAdapter } from '@sajjadbzn/jcell'

const db = createDB({ adapter: memoryAdapter() })
```

All data lives in a `Map`. Perfect for tests, serverless functions, or transient workloads.

### D1 adapter — Cloudflare Workers

```ts
import { createDB, schema, t } from '@sajjadbzn/jcell'
import { d1Adapter } from '@sajjadbzn/jcell/d1'

export default {
  async fetch(request: Request, env: Env) {
    const db = createDB({ adapter: d1Adapter({ binding: env.DB }) })
    const users = db.collection('users', userSchema)

    const url = new URL(request.url)
    if (url.pathname === '/users') {
      const all = await users.find()
      return Response.json(all)
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
}
```

Features on D1:
- Schema → SQL DDL auto-generation
- Nested objects/arrays stored as JSON TEXT columns
- Full query translation to parameterized SQL
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

### Adapter comparison

| Adapter | Import path | Runtime | Transactions | Native indexes |
|---------|-------------|---------|:------------:|:--------------:|
| File | `@sajjadbzn/jcell` | Node.js, Bun | — | Map-based |
| Memory | `@sajjadbzn/jcell` | Any | — | Map-based |
| SQLite | `@sajjadbzn/jcell` | Node.js, Bun | ✅ | SQL indexes |
| D1 | `@sajjadbzn/jcell/d1` | Cloudflare Workers | ✅ | SQL indexes |

---

## jcell Studio UI

🔥 **Visual database browser** — like Prisma Studio for your jcell projects.

![Studio screenshot placeholder]

```bash
# Install
npm install -D @sajjadbzn/jcell-studio

# Launch
npx jcell-studio
# or
bunx jcell-studio
# → Opens http://127.0.0.1:5555
```

> **Runtime requirement**: jcell-studio requires **Bun** 1.0+ (uses `Bun.serve()` internally).
> Install Bun: `npm install -g bun` or visit https://bun.sh

### Studio features

| Feature | Description |
|---------|-------------|
| **📊 Dashboard** | Overview stats — collection counts, document totals, adapter info |
| **🗂️ Data Browser** | Browse, search, sort, paginate, inline edit, add/delete documents |
| **📋 Schema Viewer** | Inspect field types, PK/required flags, sample values per collection |
| **⚡ Query Runner** | Write and test JSON queries against any collection |
| **🔗 Relations Explorer** | Auto-discover reference fields between collections |
| **📦 Migration Runner** | View applied migrations |
| **🌙 Dark Mode** | Full dark/light theme toggle (persisted in localStorage) |

### Studio CLI options

```bash
jcell-studio [options]

Options:
  -a, --adapter <type>    Adapter: "file" (default) or "sqlite"
  -p, --path <path>       Data path. Default: "./data" (file) or "./data.db" (sqlite)
  --port <number>         Port. Default: 5555
  --host <string>         Host. Default: "127.0.0.1"
  --no-open               Don't open browser automatically
  -h, --help              Show help

Examples:
  jcell-studio
  jcell-studio --adapter sqlite --path ./app.db
  jcell-studio --adapter file --path ./my-data --port 3000 --no-open
```

### Studio API

The Studio exposes a REST API on `http://127.0.0.1:<port>/api/`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/stats` | GET | Dashboard statistics |
| `/api/collections` | GET | List all collections |
| `/api/collections/:name` | GET | Browse data (supports `?filter=`, `?sort=`, `?page=`, `?limit=`) |
| `/api/collections/:name/schema` | GET | View field schema |
| `/api/collections/:name/documents` | POST | Insert a document |
| `/api/collections/:name/documents/:id` | PUT | Update a document |
| `/api/collections/:name/documents/:id` | DELETE | Delete a document |
| `/api/query` | POST | Execute custom query |
| `/api/relations` | GET | Discover relations |
| `/api/migrations` | GET | List applied migrations |

You can use any HTTP client to interact with the Studio API programmatically.

---

## Examples

### Express.js

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
    const task = await tasks.insert({ title: req.body.title, priority: req.body.priority ?? 'medium' })
    res.status(201).json(task)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

app.patch('/tasks/:id', async (req, res) => {
  const count = await tasks.update({ id: req.params.id }, req.body)
  if (count === 0) return res.status(404).json({ error: 'Not found' })
  res.json(await tasks.first({ id: req.params.id }))
})

app.delete('/tasks/:id', async (req, res) => {
  const count = await tasks.delete({ id: req.params.id })
  if (count === 0) return res.status(404).json({ error: 'Not found' })
  res.json({ deleted: true })
})

app.listen(3000)
```

### Hono

```ts
import { Hono } from 'hono'
import { createDB, schema, t, fileAdapter } from '@sajjadbzn/jcell'

const taskSchema = schema({ /* ... */ })
const db = createDB({ adapter: fileAdapter({ path: './data' }) })
const tasks = db.collection('tasks', taskSchema)

const app = new Hono()

app.get('/tasks', async (c) => {
  const all = await tasks.find()
  return c.json(all)
})

app.post('/tasks', async (c) => {
  const body = await c.req.json()
  const task = await tasks.insert(body)
  return c.json(task, 201)
})

export default app
```

### Elysia (Bun)

```ts
import { Elysia } from 'elysia'
import { createDB, schema, t, fileAdapter } from '@sajjadbzn/jcell'

const taskSchema = schema({ /* ... */ })
const db = createDB({ adapter: fileAdapter({ path: './data' }) })
const tasks = db.collection('tasks', taskSchema)

const app = new Elysia()
  .get('/tasks', async () => tasks.find())
  .get('/tasks/high-priority', async () =>
    tasks.where('priority').eq('high').where('completed').eq(false).find()
  )
  .post('/tasks', async ({ body }) => tasks.insert(body))
  .listen(3000)
```

---

## Testing

```bash
# Run all tests
bun test

# Run specific test files
bun test tests/query.test.ts
bun test tests/pro-features.test.ts

# Run the Studio E2E tests
bun test tests/studio.test.ts --timeout 30000

# Run with watch mode
bun test:watch
```

The test suite covers:
- **105+ tests** across 8 test files
- CRUD operations, query builder, aggregation, hooks, pagination, sorting
- Batch operations, migrations, concurrency, crash recovery
- OR/AND logical operators, aggregation pipeline
- Type inference validation
- **Studio E2E tests**: full HTTP API coverage (all endpoints, security, static files)

---

## Feature Matrix

| Feature | File | Memory | SQLite | D1 |
|---------|:----:|:------:|:------:|:--:|
| Schema validation | ✅ | ✅ | ✅ | ✅ |
| CRUD | ✅ | ✅ | ✅ | ✅ |
| Query builder | ✅ | ✅ | ✅ | ✅ |
| 10 filter operators | ✅ | ✅ | ✅ | ✅ |
| Sorting | ✅ | ✅ | ✅ | ✅ |
| Pagination | ✅ | ✅ | ✅ | ✅ |
| Aggregation | ✅ | ✅ | ✅ | ✅ |
| Hooks | ✅ | ✅ | ✅ | ✅ |
| Relationships | ✅ | ✅ | ✅ | ✅ |
| Batch operations | ✅ | ✅ | ✅ | ✅ |
| OR queries | ✅ | ✅ | ✅ | ✅ |
| Aggregation pipeline | ✅ | ✅ | ✅ | ✅ |
| Transactions | — | — | ✅ | ✅ |
| Native indexing | Map-based | Map-based | SQL | SQL |
| Crash recovery | ✅ (.bak) | — | ✅ (WAL) | D1 built-in |
| Atomic writes | ✅ (rename) | — | ✅ (SQL) | ✅ (SQL) |

---

## Project Structure

```
jcell/
├── packages/
│   ├── core/                 # @sajjadbzn/jcell — core engine + adapters
│   │   └── src/
│   │       ├── adapters/     # file, memory, sqlite, d1
│   │       ├── db.ts         # Database class + migrations
│   │       ├── schema.ts     # Schema builder (t.*)
│   │       ├── query-engine.ts # Collection + QueryBuilder
│   │       ├── validator.ts  # Validation + defaults
│   │       ├── errors.ts     # Custom error classes
│   │       └── types.ts       # TypeScript interfaces
│   └── studio/               # @sajjadbzn/jcell-studio — Studio UI
│       ├── src/
│       │   ├── cli.ts        # CLI entry point
│       │   └── server.ts     # HTTP server + REST API
│       └── frontend/
│           ├── index.html    # SPA shell
│           ├── styles.css    # 700+ lines of modern CSS
│           └── app.js        # Vanilla JS SPA (7 views)
├── tests/                    # 105+ tests
│   ├── query.test.ts
│   ├── pro-features.test.ts
│   ├── schema.test.ts
│   ├── studio.test.ts        # Studio E2E (23 tests)
│   └── ...
└── examples/                 # Framework examples
    ├── express/
    ├── hono/
    └── elysia/
```

---

## License

MIT © Sajjad Bazarnajibi
