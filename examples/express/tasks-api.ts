/**
 * Express + jcell Example — Task Management REST API
 *
 * Demonstrates using jcell with Express.js on Node.js.
 * Requires: npx tsx examples/express/tasks-api.ts
 * Or:       bun run examples/express/tasks-api.ts
 *
 * Install: npm install express @types/express
 */

import express from 'express'
import { createDB, schema, t, fileAdapter } from '@sajjadbzn/jcell'

// ── Schema ─────────────────────────────────────────────────────────────────

const taskSchema = schema({
  id: t.id(),
  title: t.string(),
  completed: t.boolean().default(false),
  priority: t.enum(['low', 'medium', 'high'] as const),
  createdAt: t.date().default(() => new Date()),
})

// ── Database setup ─────────────────────────────────────────────────────────

const db = createDB({ adapter: fileAdapter({ path: './data' }) })
const tasks = db.collection('tasks', taskSchema)

// ── Express app ────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

// GET /tasks — list all tasks
app.get('/tasks', async (_req, res) => {
  const all = await tasks.find()
  res.json(all)
})

// POST /tasks — create a new task
app.post('/tasks', async (req, res) => {
  try {
    const task = await tasks.insert({
      title: req.body.title,
      priority: req.body.priority ?? 'medium',
      completed: req.body.completed ?? false,
    })
    res.status(201).json(task)
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// PATCH /tasks/:id — update a task
app.patch('/tasks/:id', async (req, res) => {
  const count = await tasks.update({ id: req.params.id }, req.body)
  if (count === 0) return res.status(404).json({ error: 'Not found' })
  const updated = await tasks.first({ id: req.params.id })
  res.json(updated)
})

// DELETE /tasks/:id — delete a task
app.delete('/tasks/:id', async (req, res) => {
  const count = await tasks.delete({ id: req.params.id })
  if (count === 0) return res.status(404).json({ error: 'Not found' })
  res.json({ deleted: true })
})

// GET /tasks/high-priority — query builder example
app.get('/tasks/high-priority', async (_req, res) => {
  const high = await tasks
    .where('priority')
    .eq('high')
    .where('completed')
    .eq(false)
    .find()
  res.json(high)
})

// ── Start server ───────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, () => {
  console.log(`Express + jcell running at http://localhost:${PORT}`)
  console.log(`Try: curl http://localhost:${PORT}/tasks`)
})
