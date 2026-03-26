# turso-level

An [`abstract-level`](https://github.com/Level/abstract-level) database backed by [Turso](https://turso.tech/) / [libSQL](https://github.com/tursodatabase/libsql).

Use any library from the [`level`](https://github.com/Level/community) ecosystem on any serverless platform — Vercel, Netlify, Cloudflare Workers, Fly.io, Railway, or your own server.

> 📌 New to `abstract-level`? Head over to the [Level FAQ](https://github.com/Level/community#faq).

[![Tests](https://img.shields.io/badge/tests-876%20passing-brightgreen)](#tests)
[![abstract-level](https://img.shields.io/badge/abstract--level-compliant-blue)](https://github.com/Level/abstract-level)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```sh
npm install @alexbruf/turso-level @libsql/client
```

## Usage

### Remote database (edge / serverless)

```typescript
import { TursoLevel } from '@alexbruf/turso-level'
import { createClient } from '@libsql/client/web'  // use /web for edge runtimes

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

const db = new TursoLevel({ client })

await db.put('hello', 'world')
const value = await db.get('hello') // 'world'

for await (const [key, value] of db.iterator({ gte: 'a', lte: 'z' })) {
  console.log(key, value)
}
```

### Local development (SQLite file)

```typescript
import { TursoLevel } from '@alexbruf/turso-level'
import { createClient } from '@libsql/client'

const client = createClient({ url: 'file:local.db' })
const db = new TursoLevel({ client })
```

### Embedded replicas (Node.js — Fly.io, Railway, VPS)

Reads are local (microseconds). Writes go to the remote primary and sync back.

```typescript
import { TursoLevel } from '@alexbruf/turso-level'
import { createClient } from '@libsql/client'

const client = createClient({
  url: 'file:replica.db',
  syncUrl: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  syncInterval: 60,
})

const db = new TursoLevel({ client })
```

### With TinaCMS

```typescript
// tina/database.ts
import { TursoLevel } from '@alexbruf/turso-level'
import { createClient } from '@libsql/client/web'
import { createDatabase } from '@tinacms/datalayer'
import { GitHubProvider } from 'tinacms-gitprovider-github'

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

export const database = createDatabase({
  level: new TursoLevel({ client }),
  gitProvider: new GitHubProvider({
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
    branch: process.env.GITHUB_BRANCH,
  }),
})
```

## Setup

### Creating a Turso database

```sh
# Install CLI
brew install tursodatabase/tap/turso

# Auth
turso auth login

# Create database
turso db create my-db

# Get connection details
turso db show my-db --url
turso db tokens create my-db
```

Set environment variables:

```sh
TURSO_DATABASE_URL=libsql://my-db-yourorg.turso.io
TURSO_AUTH_TOKEN=eyJ...
```

### Table creation

The default `createTable: true` runs `CREATE TABLE IF NOT EXISTS` on open — no migrations needed for development.

For production, create the table explicitly:

```sh
turso db shell MY_DB \
  "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;"
```

Then pass `createTable: false`:

```typescript
const db = new TursoLevel({ client, createTable: false })
```

### Namespace (shared databases)

Use `namespace` to isolate this adapter's table when sharing a database:

```typescript
const db = new TursoLevel({ client, namespace: 'tina' })
// → uses table "tina_kv" instead of "kv"
```

### Which `@libsql/client` import?

| Runtime | Import |
|---------|--------|
| Node.js, Bun, Deno | `@libsql/client` (supports `file:` and `:memory:` URLs) |
| Cloudflare Workers, Vercel Edge, Netlify Edge | `@libsql/client/web` (HTTP only, no native deps) |

The adapter works identically with both.

## API

### `new TursoLevel(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `Client` | **required** | A `@libsql/client` instance from `createClient()` |
| `namespace` | `string` | `''` | Table name prefix. `''` → table `kv`; `'tina'` → table `tina_kv` |
| `createTable` | `boolean` | `true` | Run `CREATE TABLE IF NOT EXISTS` on open |

All other options are forwarded to [`abstract-level`](https://github.com/Level/abstract-level#db--new-abstractlevelmanifest-options).

`TursoLevel` inherits the full `abstract-level` API: `put`, `get`, `del`, `getMany`, `batch`, `iterator`, `keys`, `values`, `clear`, `sublevel`, and more.

## How it works

Turso is libSQL (a SQLite fork) as a managed service. Entries are stored in a two-column table:

```sql
CREATE TABLE kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
```

`WITHOUT ROWID` keeps the B-tree compact — the primary key IS the data, so there's no rowid indirection overhead.

**Iteration** uses cursor-based pagination. Since libSQL's HTTP protocol is stateless, there's no persistent server-side cursor. The iterator fetches rows in pages of 100, using `WHERE key > lastKey` to advance between pages.

**Batches** use libSQL's `client.batch()` with `'write'` mode, which executes all statements as a single atomic transaction.

### Limitations

- **No snapshot isolation** — iterators read live data. Declared via `supports.snapshots = false`.
- **No `seek()`** — repositioning an open iterator is not implemented.
- **UTF-8 keys and values only** — libSQL TEXT columns only.

## Tests

876 tests pass — the full [abstract-level compliance suite](https://github.com/Level/abstract-level/tree/main/test) runs against an in-memory libSQL database (no Turso account needed to run tests).

```sh
bun test
```

## License

[Apache-2.0](LICENSE)
