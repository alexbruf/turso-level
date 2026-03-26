import { AbstractIterator } from 'abstract-level'
import { buildRangeSQL } from './utils.js'
import type { RangeOptions } from './utils.js'
import type { Client } from '@libsql/client'

const PAGE_SIZE = 100

type RawEntry = [string, string]
type MaskedEntry = [string | undefined, string | undefined]
type NextCb = (err: Error | null, key?: string | undefined, value?: string | undefined) => void
type ManyCb = (err: Error | null, entries?: MaskedEntry[]) => void

export class SQLIterator extends AbstractIterator<any, string, string> {
  readonly #client: Client
  readonly #table: string
  readonly #options: RangeOptions & { keys?: boolean; values?: boolean }
  #buffer: RawEntry[] = []
  #finished = false
  #lastKey: string | null = null

  constructor(db: any, client: Client, table: string, options: RangeOptions & { keys?: boolean; values?: boolean }) {
    super(db, options as any)
    this.#client = client
    this.#table = table
    this.#options = options
  }

  _next(callback: NextCb): void {
    if (this.#buffer.length > 0) {
      const [k, v] = this.#mask(this.#buffer.shift()!)
      return callback(null, k, v)
    }
    if (this.#finished) {
      return callback(null)
    }
    this.#fetchPage(PAGE_SIZE).then(() => {
      if (this.#buffer.length > 0) {
        const [k, v] = this.#mask(this.#buffer.shift()!)
        callback(null, k, v)
      } else {
        callback(null)
      }
    }, callback as (err: Error) => void)
  }

  _nextv(size: number, _options: unknown, callback: ManyCb): void {
    const go = (): void => {
      if (this.#buffer.length >= size || this.#finished) {
        return callback(null, this.#buffer.splice(0, size).map(e => this.#mask(e)))
      }
      this.#fetchPage(Math.max(size, PAGE_SIZE)).then(go, callback as (err: Error) => void)
    }
    go()
  }

  async #fetchPage(size: number): Promise<void> {
    const { sql, params } = buildRangeSQL(this.#table, this.#options, this.#lastKey, size)
    const result = await this.#client.execute({ sql, args: params })
    const rows = result.rows

    if (rows.length < size) this.#finished = true

    if (rows.length > 0) {
      this.#lastKey = String(rows[rows.length - 1][0])
      for (const row of rows) {
        this.#buffer.push([String(row[0]), String(row[1])])
      }
    }
  }

  #mask(entry: RawEntry): MaskedEntry {
    return [
      this.#options.keys !== false ? entry[0] : undefined,
      this.#options.values !== false ? entry[1] : undefined,
    ]
  }
}
