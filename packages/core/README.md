# @sajjadbzn/jcell

**Lightweight, type-safe document database + ORM for TypeScript — runs on Node.js, Bun, and Cloudflare Workers.**

No external database server, no codegen, no heavy dependencies. Full TypeScript inference, schema validation, 4 adapters, aggregation, hooks, migrations, and transactions.

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

const user = await users.insert({ name: 'Sajjad', role: 'admin' })
const found = await users.where('name').eq('Sajjad').first()
```

---

## Install

```bash
npm install @sajjadbzn/jcell
# or
bun add @sajjadbzn/jcell
```

**Single package — everything included.** Core (schema, query engine, validation), file adapter (atomic writes, crash recovery), memory adapter (tests), and SQLite adapter are all bundled together.

For Cloudflare Workers, use `@sajjadbzn/jcell/d1` (avoids Node.js APIs).

For a visual Studio UI, install `@sajjadbzn/jcell-studio`.

---

## Adapters

### File — JSON on disk

```ts
import { fileAdapter } from '@sajjadbzn/jcell'
const db = createDB({ adapter: fileAdapter({ path: './data' }) })
```
- Atomic writes (temp → rename)
- Crash recovery via `.bak` fallback
- Write queue per collection

### Memory — ephemeral in-memory

```ts
import { memoryAdapter } from '@sajjadbzn/jcell'
const db = createDB({ adapter: memoryAdapter() })
```
- Perfect for tests and serverless functions

### SQLite — local database

```ts
import { sqliteAdapter } from '@sajjadbzn/jcell'
const db = createDB({ adapter: sqliteAdapter({ path: './app.db' }) })
```
Requires: `npm install better-sqlite3`
- Real SQL DDL from schemas
- Parameterized queries, transactions, native indexes
- WAL mode for concurrency

### D1 — Cloudflare Workers

```ts
import { d1Adapter } from '@sajjadbzn/jcell/d1'
const db = createDB({ adapter: d1Adapter({ binding: env.DB }) })
```
- Import from `@sajjadbzn/jcell/d1` (no Node.js APIs)
- SQL DDL, transactions, indexes

---

## Schema

```ts
const postSchema = schema({
  id: t.id(),                              // string, auto-generated UUID
  title: t.string(),                       // string
  body: t.string().optional(),             // string | undefined
  views: t.number().default(0),            // number, auto-filled 0
  published: t.boolean(),                  // boolean
  tags: t.array(t.string()),               // string[]
  meta: t.object({                         // { key: string, value: number }
    key: t.string(),
    value: t.number(),
  }),
  priority: t.enum(['low', 'high'] as const), // 'low' | 'high'
  authorId: t.ref('users'),                // foreign key reference
  createdAt: t.date().default(() => new Date()), // Date, factory default
})

type Post = typeof postSchema.infer
// { id: string; title: string; body?: string; views: number; ... }
```

---

## CRUD

```ts
const doc = await collection.insert({ name: 'Alice', role: 'admin' })
const all = await collection.find()
const some = await collection.find({ role: 'admin' })
const first = await collection.first({ name: 'Alice' })
const found = await collection.firstOrFail({ id: 'abc' }) // throws if not found
await collection.update({ id: doc.id }, { name: 'Bob' })
await collection.delete({ id: doc.id })
```

### Batch operations

```ts
await collection.insertMany([{ name: 'A' }, { name: 'B' }])
await collection.updateAll({ role: 'guest' })
await collection.deleteAll()
```

---

## Query Builder

```ts
const results = await collection
  .where('age').gt(18)
  .where('role').eq('admin')
  .where('name').startsWith('A')
  .orWhere('role').eq('moderator')
  .orderByDesc('createdAt')
  .limit(10).offset(0)
  .select(['id', 'name'])
  .find()
```

### Operators

`.eq()` · `.ne()` · `.gt()` · `.gte()` · `.lt()` · `.lte()` · `.in()` · `.contains()` · `.startsWith()`

### Sorting

`.orderBy('field')` · `.orderBy('field', 'desc')` · `.orderByDesc('field')`

### Pagination

`.limit(n).offset(n)` · `.page(page, pageSize)` (1-indexed)

---

## Aggregation

```ts
await collection.count()                    // total documents
await collection.count({ role: 'admin' })   // with filter
await collection.sum('price')               // sum numeric field
await collection.avg('price')               // average
await collection.min('price')               // minimum
await collection.max('price')               // maximum
```

---

## Hooks

```ts
collection.hook('before:insert', async (doc) => { /* ... */ })
collection.hook('after:insert', async (doc) => { /* ... */ })
collection.hook('before:update', async (filter, changes) => { /* ... */ })
collection.hook('after:update', async (filter, changes, count) => { /* ... */ })
collection.hook('before:delete', async (filter) => { /* ... */ })
collection.hook('after:delete', async (filter, count) => { /* ... */ })
```

---

## Transactions

```ts
await db.transaction(async (tx) => {
  const accounts = tx.collection('accounts', accountSchema)
  await accounts.update({ id: 'a1' }, { balance: 50 })
  await accounts.update({ id: 'a2' }, { balance: 150 })
})
```

Supported by: SQLite adapter, D1 adapter.

---

## Indexes

```ts
await collection.createIndex('email', { unique: true })
await collection.dropIndex('email')
```

---

## Migrations

```ts
const m001 = createMigration('001_init', {
  async up(db) { /* ... */ },
  async down(db) { /* ... */ },
})

await db.migrate([m001, m002])
```

---

## Studio UI

```bash
npm install -D @sajjadbzn/jcell-studio
npx jcell-studio
```

Opens a browser-based data browser, query runner, schema viewer, and more.

---

## Links

- **Repository**: https://github.com/sajjadbzrn/jcell
- **Issues**: https://github.com/sajjadbzrn/jcell/issues
- **License**: MIT
