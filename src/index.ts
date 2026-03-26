import { AbstractLevel } from 'abstract-level'
import { SQLIterator } from './iterator.js'
import { buildClearSQL } from './utils.js'
import type { RangeOptions } from './utils.js'
import type { Client } from '@libsql/client'

export interface TursoLevelOptions {
  /** A @libsql/client Client instance (from createClient()) */
  client: Client
  /** Table name prefix. Empty (default) → table 'kv'; 'tina' → table 'tina_kv' */
  namespace?: string
  /** Auto-create table on open. Default: true */
  createTable?: boolean
  [key: string]: unknown
}

type Cb = (err: Error | null) => void

export class TursoLevel extends AbstractLevel<string, string, string> {
  readonly #client: Client
  readonly #table: string
  readonly #createTable: boolean

  constructor(options: TursoLevelOptions) {
    const { client, namespace, createTable = true, ...rest } = options
    super({ encodings: { utf8: true }, snapshots: false }, rest)
    this.#client = client
    this.#table = namespace ? `${namespace}_kv` : 'kv'
    this.#createTable = createTable
  }

  _open(_options: unknown, callback: Cb): void {
    if (!this.#createTable) return callback(null)
    this.#client
      .execute(`CREATE TABLE IF NOT EXISTS "${this.#table}" (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID`)
      .then(() => callback(null), callback)
  }

  _get(key: string, _options: unknown, callback: (err: Error | null, value?: string) => void): void {
    this.#client
      .execute({ sql: `SELECT value FROM "${this.#table}" WHERE key = ?`, args: [key] })
      .then(result => {
        if (result.rows.length === 0) callback(notFound(key))
        else callback(null, String(result.rows[0][0]))
      }, callback)
  }

  _getMany(keys: string[], _options: unknown, callback: (err: Error | null, values?: Array<string | undefined>) => void): void {
    if (keys.length === 0) return callback(null, [])
    const placeholders = keys.map(() => '?').join(', ')
    this.#client
      .execute({ sql: `SELECT key, value FROM "${this.#table}" WHERE key IN (${placeholders})`, args: keys })
      .then(result => {
        const map = new Map(result.rows.map(r => [String(r[0]), String(r[1])]))
        callback(null, keys.map(k => map.get(k)))
      }, callback)
  }

  _put(key: string, value: string, _options: unknown, callback: Cb): void {
    this.#client
      .execute({ sql: `INSERT OR REPLACE INTO "${this.#table}" (key, value) VALUES (?, ?)`, args: [key, value] })
      .then(() => callback(null), callback)
  }

  _del(key: string, _options: unknown, callback: Cb): void {
    this.#client
      .execute({ sql: `DELETE FROM "${this.#table}" WHERE key = ?`, args: [key] })
      .then(() => callback(null), callback)
  }

  _batch(
    operations: Array<{ type: 'put' | 'del'; key: string; value?: string }>,
    _options: unknown,
    callback: Cb
  ): void {
    if (operations.length === 0) return callback(null)
    this.#client
      .batch(
        operations.map(op =>
          op.type === 'put'
            ? { sql: `INSERT OR REPLACE INTO "${this.#table}" (key, value) VALUES (?, ?)`, args: [op.key, op.value!] }
            : { sql: `DELETE FROM "${this.#table}" WHERE key = ?`, args: [op.key] }
        ),
        'write'
      )
      .then(() => callback(null), callback)
  }

  _clear(options: RangeOptions, callback: Cb): void {
    const { sql, params } = buildClearSQL(this.#table, options)
    this.#client
      .execute({ sql, args: params })
      .then(() => callback(null), callback)
  }

  _iterator(options: unknown): SQLIterator {
    return new SQLIterator(this, this.#client, this.#table, options as any)
  }
}

function notFound(key: string): Error {
  const err = new Error(`Key ${key} was not found`)
  ;(err as any).code = 'LEVEL_NOT_FOUND'
  return err
}
