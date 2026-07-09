/**
 * Hono + jcell Example — Task Management REST API
 *
 * Demonstrates using jcell with Hono on Bun.
 * Hono is ultra-fast and works on Node, Bun, Deno, and Cloudflare Workers.
 *
 * Run: bun run examples/hono/tasks-api.ts
 * Install: bun add hono
 */

import { Hono } from 'hono'
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

// ── Hono app ───────────────────────────────────────────────────────────────

const app = new Hono()

// GET /tasks — list all tasks
app.get('/tasks', async (c) => {
  const all = await tasks.find()
  return c.json(all)
})

// POST /tasks — create a task
app.post('/tasks', async (c) => {
  const body = await c.req.json()
  try {
    const task = await tasks.insert({
      title: body.title,
      priority: body.priority ?? 'medium',
    })
    return c.json(task, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

// PATCH /tasks/:id — update a task
app.patch('/tasks/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const count = await tasks.update({ id }, body)
  if (count === 0) return c.json({ error: 'Not found' }, 404)
  const updated = await tasks.first({ id })
  return c.json(updated)
})

// DELETE /tasks/:id — delete a task
app.delete('/tasks/:id', async (c) => {
  const id = c.req.param('id')
  const count = await tasks.delete({ id })
  if (count === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ deleted: true })
})

// GET /tasks/high-priority — query builder example
app.get('/tasks/high-priority', async (c) => {
  const high = await tasks
    .where('priority')
    .eq('high')
    .where('completed')
    .eq(false)
    .find()
  return c.json(high)
})

// ── Start server ───────────────────────────────────────────────────────────

const port = Number(process.env.PORT) || 3000
console.log(`Hono + jcell running at http://localhost:${port}`)
export default { port, fetch: app.fetch }
