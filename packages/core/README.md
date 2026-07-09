# @sajjadbzn/jcell

**Core package — schema definitions, validation, and query engine for jcell.**

Zero runtime dependencies. Runtime-portable (no Node/Bun-specific APIs).

## Install

```bash
bun add @sajjadbzn/jcell
# plus a storage adapter:
bun add @sajjadbzn/jcell-adapter-file
```

## Usage

```ts
import { createDB, schema, t } from '@sajjadbzn/jcell'
import { fileAdapter } from '@sajjadbzn/jcell-adapter-file'

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

## API

| Export | Description |
|--------|-------------|
| `createDB(config)` | Create a database instance |
| `schema(fields)` | Define a typed schema |
| `t.string()` / `t.number()` / `t.boolean()` / `t.date()` / `t.id()` | Primitive field builders |
| `t.array(field)` | Array field builder |
| `t.object(fields)` | Nested object field builder |
| `t.enum(values)` | Enum field builder |
| `field.optional()` | Make a field optional |
| `field.default(value)` | Set a default value |
| `Collection.insert()` / `.update()` / `.delete()` / `.find()` / `.first()` | Collection CRUD |
| `Collection.where(field).eq()` / `.gt()` / `.gte()` / `.lt()` / `.lte()` / `.in()` | Query builder |
| `StorageAdapter` | Interface for custom adapters |
