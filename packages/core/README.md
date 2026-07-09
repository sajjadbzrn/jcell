# @sajjadbzn/jcell

**Lightweight, type-safe JSON-file database + ORM for TypeScript.**

No external database server required. No codegen. No heavy dependencies. Just JSON files in your project root, with full TypeScript inference and schema validation on every write.

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
await users.update({ id: user.id }, { age: 29 })
await users.delete({ id: user.id })
```

## Install

```bash
npm install @sajjadbzn/jcell
# or
bun add @sajjadbzn/jcell
```

**Single package — everything included.** No separate adapters to install. Core (schema, query engine, validation), file adapter (atomic writes, crash recovery), and memory adapter (for tests) are all bundled together.

## Features

- **Zero setup** — install and start storing data as JSON files
- **Fully typed** — schema definitions infer TypeScript types automatically, no codegen
- **Atomic writes** — writes go to a temp file first, then rename over the target
- **Crash recovery** — `.bak` snapshot fallback if the main file is corrupted
- **Schema validation** — every document validated on insert and update
- **Runtime-portable** — core has zero Node/Bun-specific APIs
- **Tiny API** — learn in 5 minutes

## API

### Schema builders

| Builder | TS type |
|---------|---------|
| `t.id()` | `string` |
| `t.string()` | `string` |
| `t.number()` | `number` |
| `t.boolean()` | `boolean` |
| `t.date()` | `Date` |
| `t.array(t.string())` | `string[]` |
| `t.object({ key: t.string() })` | `{ key: string }` |
| `t.enum(['a', 'b'] as const)` | `'a' \| 'b'` |
| `t.string().optional()` | `string \| undefined` |
| `t.number().default(0)` | `number` (auto-filled) |

### Collection operations

```ts
const doc = await collection.insert({ name: 'Alice' })
const all = await collection.find()
const some = await collection.find({ role: 'admin' })
const result = await collection.where('age').gt(18).where('role').eq('admin').find()
const single = await collection.where('name').eq('Alice').first()
await collection.update({ id: doc.id }, { name: 'Bob' })
await collection.delete({ id: doc.id })
```

### Adapters (both bundled)

| Adapter | Import | Runtime |
|---------|--------|---------|
| File system | `import { fileAdapter } from '@sajjadbzn/jcell'` | Node.js, Bun |
| In-memory | `import { memoryAdapter } from '@sajjadbzn/jcell'` | Any (tests, ephemeral) |

## GitHub

https://github.com/sajjadbzrn/jcell

## License

MIT
