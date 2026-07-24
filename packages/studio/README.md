# @sajjadbzn/jcell-studio

🔥 **Visual database browser for jcell** — like Prisma Studio for your jcell projects.

Browse, query, and manage your jcell databases through a beautiful web UI — no coding required.

![Studio screenshot placeholder]

---

## Install

```bash
npm install -D @sajjadbzn/jcell-studio
# or
bun add -D @sajjadbzn/jcell-studio
```

Requires `@sajjadbzn/jcell` as a peer dependency (installed automatically with npm 7+).

> **Runtime requirement**: jcell-studio requires **Bun** 1.0+ (uses `Bun.serve()` internally).
> Install Bun: `npm install -g bun` or visit https://bun.sh

---

## Quick Start

```bash
# Launch with defaults (file adapter, ./data directory)
npx jcell-studio

# Launch with SQLite
npx jcell-studio --adapter sqlite --path ./app.db

# Custom port
npx jcell-studio --port 3000 --no-open
```

Then open `http://127.0.0.1:5555` in your browser.

---

## Features

| Feature | Description |
|---------|-------------|
| **📊 Dashboard** | Overview stats — collection counts, document totals, adapter info |
| **🗂️ Data Browser** | Browse, search, sort, paginate, inline edit, add/delete documents |
| **📋 Schema Viewer** | Inspect field types, PK/required flags, sample values per collection |
| **⚡ Query Runner** | Write and test JSON queries against any collection |
| **🔗 Relations Explorer** | Auto-discover reference fields between collections |
| **📦 Migration Runner** | View applied migrations |
| **🌙 Dark Mode** | Full dark/light theme toggle — persisted in localStorage |

---

## CLI Options

```
Usage: jcell-studio [options]

Options:
  -a, --adapter <type>    Adapter type: "file" (default) or "sqlite"
  -p, --path <path>       Path to data. Default: "./data" (file), "./data.db" (sqlite)
  --port <number>         Server port. Default: 5555
  --host <string>         Host to bind. Default: "127.0.0.1"
  --no-open               Do not auto-open browser
  -h, --help              Show help

Examples:
  jcell-studio
  jcell-studio --adapter sqlite --path ./app.db --port 3000
  jcell-studio --adapter file --path ./my-data --no-open
```

Press `Ctrl+C` to stop the server.

---

## REST API

The Studio exposes a full REST API at `http://127.0.0.1:<port>/api/` — you can use any HTTP client to interact with it.

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/stats` | GET | Dashboard stats |
| `/api/collections` | GET | List collections |
| `/api/collections/:name` | GET | Browse data |
| `/api/collections/:name/schema` | GET | View schema |
| `/api/collections/:name/documents` | POST | Insert document |
| `/api/collections/:name/documents/:id` | PUT | Update document |
| `/api/collections/:name/documents/:id` | DELETE | Delete document |
| `/api/query` | POST | Custom query |
| `/api/relations` | GET | Discover relations |
| `/api/migrations` | GET | List migrations |

### Query parameters for data browsing

- `?filter=text` — Full-text search across all fields
- `?sort=field` — Sort by field
- `?order=asc|desc` — Sort direction
- `?page=1` — Page number (1-indexed)
- `?limit=50` — Results per page (default: 50)

### Example API usage

```bash
# List collections
curl http://127.0.0.1:5555/api/collections

# Browse users with pagination
curl 'http://127.0.0.1:5555/api/collections/users?page=1&limit=10'

# Search across all fields
curl 'http://127.0.0.1:5555/api/collections/users?filter=alice'

# Insert a document
curl -X POST http://127.0.0.1:5555/api/collections/users/documents \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "role": "admin"}'

# Update a document
curl -X PUT http://127.0.0.1:5555/api/collections/users/documents/abc123 \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice Updated"}'

# Delete a document
curl -X DELETE http://127.0.0.1:5555/api/collections/users/documents/abc123

# Run a custom query
curl -X POST http://127.0.0.1:5555/api/query \
  -H 'Content-Type: application/json' \
  -d '{"collection": "users", "filter": {"role": "admin"}}'
```

---

## Architecture

```
CLI (jcell-studio)
  │
  ├── Bun.serve() HTTP server on port 5555
  │     │
  │     ├── /api/* → REST API routes
  │     │     │
  │     │     ├── Discovery (collections, schema, stats)
  │     │     ├── CRUD (insert, update, delete documents)
  │     │     ├── Query runner
  │     │     ├── Relations explorer
  │     │     └── Migrations viewer
  │     │
  │     └── /* → Static frontend files
  │           (index.html, styles.css, app.js)
  │
  └── Frontend (Vanilla JS SPA)
        ├── Dashboard
        ├── Data Browser
        ├── Schema Viewer
        ├── Query Runner
        ├── Relations Explorer
        └── Migration Runner
```

The frontend is a vanilla JavaScript single-page application with hash-based routing. No build step, no framework — just HTML, CSS, and JS served directly.

---

## Development

```bash
# From the monorepo root
cd packages/studio

# Install deps
bun install

# Build
bun run build

# Test (from repo root)
bun test tests/studio.test.ts --timeout 30000
```

---

## License

MIT
