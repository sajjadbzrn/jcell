/**
 * Advanced Query Example — Blog Engine
 *
 * Demonstrates nested schemas, array fields, enum fields, date comparisons,
 * and chained query filters with jcell.
 *
 * Run: bun run examples/advanced-query.ts
 */

import { createDB, schema, t, memoryAdapter } from "../packages/core/src/index.js";

// ---------------------------------------------------------------------------
// 1. Define schemas with nested types
// ---------------------------------------------------------------------------

const commentSchema = t.object({
  author: t.string(),
  body: t.string(),
  likes: t.number().default(0),
});

const postSchema = schema({
  id: t.id(),
  title: t.string(),
  body: t.string(),
  status: t.enum(["draft", "published", "archived"] as const),
  tags: t.array(t.string()),
  metadata: t.object({
    views: t.number().default(0),
    estimatedReadMinutes: t.number(),
  }),
  comments: t.array(commentSchema).default(() => []),
  publishedAt: t.date().optional(),
  createdAt: t.date().default(() => new Date()),
});

type Post = typeof postSchema.infer;

// ---------------------------------------------------------------------------
// 2. Seed data
// ---------------------------------------------------------------------------

const db = createDB({ adapter: memoryAdapter() });
const posts = db.collection("posts", postSchema);

const postsData: Array<Omit<Post, "id" | "createdAt">> = [
  {
    title: "Getting Started with TypeScript",
    body: "TypeScript is a typed superset of JavaScript...",
    status: "published",
    tags: ["typescript", "javascript"],
    metadata: { views: 1200, estimatedReadMinutes: 5 },
    comments: [
      { author: "Alice", body: "Great post!", likes: 3 },
      { author: "Bob", body: "Very helpful, thanks!", likes: 1 },
    ],
    publishedAt: new Date("2024-01-15"),
  },
  {
    title: "Advanced Bun Patterns",
    body: "Bun is a fast all-in-one JavaScript runtime...",
    status: "published",
    tags: ["bun", "javascript", "performance"],
    metadata: { views: 850, estimatedReadMinutes: 8 },
    comments: [{ author: "Charlie", body: "Nice write-up", likes: 5 }],
    publishedAt: new Date("2024-03-01"),
  },
  {
    title: "Why JSON Databases Work",
    body: "Sometimes you don't need Postgres...",
    status: "draft",
    tags: ["database", "json"],
    metadata: { views: 0, estimatedReadMinutes: 4 },
    comments: [],
    publishedAt: undefined,
  },
  {
    title: "Monorepos with Bun Workspaces",
    body: "Bun makes monorepo management easy...",
    status: "published",
    tags: ["bun", "monorepo", "tooling"],
    metadata: { views: 320, estimatedReadMinutes: 6 },
    comments: [],
    publishedAt: new Date("2024-06-10"),
  },
  {
    title: "Old Post About Something",
    body: "This is an old archived post...",
    status: "archived",
    tags: ["legacy"],
    metadata: { views: 50, estimatedReadMinutes: 2 },
    comments: [],
    publishedAt: new Date("2023-05-20"),
  },
];

for (const data of postsData) {
  await posts.insert(data as unknown as Partial<Post>);
}
console.log(`Seeded ${postsData.length} posts\n`);

// ---------------------------------------------------------------------------
// 3. Query: published posts with > 500 views
// ---------------------------------------------------------------------------

// Use the simple filter approach for nested fields
const allPosts = await posts.find();
const popular = allPosts.filter(
  (p) => p.status === "published" && p.metadata.views > 500,
);

console.log("Popular published posts (>500 views):");
for (const p of popular) {
  console.log(
    `  - "${p.title}" (${p.metadata.views} views, ${p.comments.length} comments)`,
  );
}

// ---------------------------------------------------------------------------
// 4. Query: posts tagged with "bun"
// ---------------------------------------------------------------------------

const bunPosts = allPosts.filter((p) => p.tags.includes("bun"));
console.log(`\nPosts tagged "bun": ${bunPosts.length}`);
for (const p of bunPosts) {
  console.log(`  - "${p.title}" [tags: ${p.tags.join(", ")}]`);
}

// ---------------------------------------------------------------------------
// 5. Query: posts published in 2024
// ---------------------------------------------------------------------------

const yearStart = new Date("2024-01-01");
const yearEnd = new Date("2024-12-31");

const posts2024 = allPosts.filter(
  (p) =>
    p.publishedAt && p.publishedAt >= yearStart && p.publishedAt <= yearEnd,
);
console.log(`\nPosts published in 2024: ${posts2024.length}`);
for (const p of posts2024) {
  console.log(
    `  - "${p.title}" (${p.publishedAt!.toISOString().slice(0, 10)})`,
  );
}

// ---------------------------------------------------------------------------
// 6. Query: posts with at least 2 comments
// ---------------------------------------------------------------------------

const withComments = allPosts.filter((p) => p.comments.length >= 2);
console.log(`\nPosts with 2+ comments: ${withComments.length}`);
for (const p of withComments) {
  console.log(`  - "${p.title}" (${p.comments.length} comments)`);
  for (const c of p.comments) {
    console.log(`    • ${c.author}: "${c.body}" (${c.likes} ❤️)`);
  }
}

// ---------------------------------------------------------------------------
// 7. Bulk update: publish all drafts
// ---------------------------------------------------------------------------

const drafts = allPosts.filter((p) => p.status === "draft");
for (const d of drafts) {
  await posts.update({ id: d.id }, {
    status: "published",
    publishedAt: new Date(),
  } as Partial<Post>);
}
console.log(`\nPublished ${drafts.length} draft(s)`);

// ---------------------------------------------------------------------------
// 8. Verify final state
// ---------------------------------------------------------------------------

const finalPosts = await posts.find();
const statusCounts: Record<string, number> = {};
for (const p of finalPosts) {
  statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
}
console.log("\nFinal post statuses:");
for (const [status, count] of Object.entries(statusCounts)) {
  console.log(`  ${status}: ${count}`);
}
