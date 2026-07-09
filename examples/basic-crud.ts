/**
 * Basic CRUD Example — Task Management
 *
 * Demonstrates the full insert/update/delete/find/query cycle with jcell.
 *
 * Run: bun run examples/basic-crud.ts
 */

import { createDB, schema, t, memoryAdapter, fileAdapter } from '../packages/core/src/index.js'

// ---------------------------------------------------------------------------
// 1. Define a schema
// ---------------------------------------------------------------------------

const taskSchema = schema({
  id: t.id(),
  title: t.string(),
  completed: t.boolean().default(false),
  priority: t.enum(['low', 'medium', 'high'] as const),
  createdAt: t.date().default(() => new Date()),
})

// ---------------------------------------------------------------------------
// 2. Create DB + collection
// ---------------------------------------------------------------------------

const db = createDB({ adapter: memoryAdapter() })
// To persist to disk instead:
// const db = createDB({ adapter: fileAdapter({ path: './data' }) })

const tasks = db.collection('tasks', taskSchema)

// ---------------------------------------------------------------------------
// 3. Insert documents
// ---------------------------------------------------------------------------

const task1 = await tasks.insert({
  title: 'Buy groceries',
  priority: 'medium',
})

const task2 = await tasks.insert({
  title: 'Write docs',
  priority: 'high',
})

const task3 = await tasks.insert({
  title: 'Clean desk',
  priority: 'low',
  completed: true,
})

console.log('Inserted 3 tasks:')
console.log(`  - ${task1.title} (id: ${task1.id}, priority: ${task1.priority})`)
console.log(`  - ${task2.title} (id: ${task2.id}, priority: ${task2.priority})`)
console.log(`  - ${task3.title} (id: ${task3.id}, priority: ${task3.priority})`)

// ---------------------------------------------------------------------------
// 4. Find documents
// ---------------------------------------------------------------------------

const all = await tasks.find()
console.log(`\nAll tasks: ${all.length}`)

const incomplete = await tasks.find({ completed: false })
console.log(`Incomplete tasks: ${incomplete.length}`)

const highPriority = await tasks.where('priority').eq('high').first()
console.log(`First high-priority task: ${highPriority?.title ?? 'none'}`)

// ---------------------------------------------------------------------------
// 5. Update a document
// ---------------------------------------------------------------------------

await tasks.update({ id: task1.id }, { completed: true })
const updated = await tasks.first({ id: task1.id })
console.log(`\nUpdated "${updated!.title}" → completed: ${updated!.completed}`)

// ---------------------------------------------------------------------------
// 6. Query with filters
// ---------------------------------------------------------------------------

const lowOrMedium = await tasks
  .where('priority')
  .in(['low', 'medium'])
  .find()
console.log(`\nLow or medium priority tasks: ${lowOrMedium.length}`)
for (const task of lowOrMedium) {
  console.log(`  - ${task.title} [${task.priority}] ${task.completed ? '✓' : '○'}`)
}

// ---------------------------------------------------------------------------
// 7. Delete a document
// ---------------------------------------------------------------------------

const deleted = await tasks.delete({ id: task3.id })
console.log(`\nDeleted ${deleted} task(s)`)
console.log(`Remaining tasks: ${(await tasks.find()).length}`)
