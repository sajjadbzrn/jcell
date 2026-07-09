/**
 * Elysia + jcell Example — Task Management REST API
 *
 * Demonstrates using jcell with Elysia on Bun.
 * Elysia is a performant Bun-first web framework with End-to-End Type Safety.
 *
 * Run: bun run examples/elysia/tasks-api.ts
 * Install: bun add elysia
 */

import { Elysia, t as elysiaT } from 'elysia'
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

// ── Elysia app ─────────────────────────────────────────────────────────────

const app = new Elysia()
  .get('/tasks', async () => {
    return await tasks.find()
  })

  .post(
    '/tasks',
    async ({ body }) => {
      try {
        const task = await tasks.insert({
          title: body.title,
          priority: body.priority ?? 'medium',
        })
        return task
      } catch (err) {
        return { error: (err as Error).message }
      }
    },
    {
      body: elysiaT.Object({
        title: elysiaT.String(),
        priority: elysiaT.Optional(
          elysiaT.Union([
            elysiaT.Literal('low'),
            elysiaT.Literal('medium'),
            elysiaT.Literal('high'),
          ]),
        ),
      }),
    },
  )

  .patch('/tasks/:id', async ({ params, body }) => {
    const count = await tasks.update({ id: params.id }, body)
    if (count === 0) return { error: 'Not found' }
    return await tasks.first({ id: params.id })
  })

  .delete('/tasks/:id', async ({ params }) => {
    const count = await tasks.delete({ id: params.id })
    if (count === 0) return { error: 'Not found' }
    return { deleted: true }
  })

  .get('/tasks/high-priority', async () => {
    return await tasks
      .where('priority')
      .eq('high')
      .where('completed')
      .eq(false)
      .find()
  })

  .listen(3000)

console.log(`Elysia + jcell running at http://localhost:${app.server?.port}`)
