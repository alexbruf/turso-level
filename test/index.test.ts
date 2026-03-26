import { describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@libsql/client'
import { TursoLevel } from '../src/index.js'

function makeDB(namespace?: string): TursoLevel {
  const client = createClient({ url: ':memory:' })
  return new TursoLevel({ client, namespace })
}

async function withDB(fn: (db: TursoLevel) => Promise<void>, namespace?: string): Promise<void> {
  const db = makeDB(namespace)
  await db.open()
  try {
    await fn(db)
  } finally {
    await db.close()
  }
}

async function collect(iter: AsyncIterable<[string, string]>): Promise<Array<[string, string]>> {
  const results: Array<[string, string]> = []
  for await (const e of iter) results.push(e)
  return results
}

describe('put / get / del', () => {
  it('puts and gets a value', () => withDB(async db => {
    await db.put('hello', 'world')
    expect(await db.get('hello')).toBe('world')
  }))

  it('overwrites an existing key', () => withDB(async db => {
    await db.put('k', 'v1')
    await db.put('k', 'v2')
    expect(await db.get('k')).toBe('v2')
  }))

  it('throws LEVEL_NOT_FOUND for a missing key', () => withDB(async db => {
    await expect(db.get('nope')).rejects.toMatchObject({ code: 'LEVEL_NOT_FOUND' })
  }))

  it('deletes a key', () => withDB(async db => {
    await db.put('k', 'v')
    await db.del('k')
    await expect(db.get('k')).rejects.toMatchObject({ code: 'LEVEL_NOT_FOUND' })
  }))

  it('del on a missing key does not throw', () => withDB(async db => {
    await expect(db.del('nope')).resolves.toBeUndefined()
  }))
})

describe('getMany', () => {
  it('returns values in key order with undefined for missing', () => withDB(async db => {
    await db.put('a', '1')
    await db.put('b', '2')
    expect(await db.getMany(['b', 'a', 'missing'])).toEqual(['2', '1', undefined])
  }))

  it('returns empty array for empty key list', () => withDB(async db => {
    expect(await db.getMany([])).toEqual([])
  }))
})

describe('batch', () => {
  it('executes put and del atomically', () => withDB(async db => {
    await db.put('old', 'x')
    await db.batch([
      { type: 'put', key: 'a', value: '1' },
      { type: 'del', key: 'old' },
    ])
    expect(await db.get('a')).toBe('1')
    await expect(db.get('old')).rejects.toMatchObject({ code: 'LEVEL_NOT_FOUND' })
  }))

  it('empty batch does nothing', () => withDB(async db => {
    await expect(db.batch([])).resolves.toBeUndefined()
  }))
})

describe('iterator - basic', () => {
  it('iterates all entries in ascending order', () => withDB(async db => {
    await db.batch(['c', 'a', 'b'].map((k, i) => ({ type: 'put' as const, key: k, value: `${i}` })))
    const entries = await collect(db.iterator() as any)
    expect(entries.map(([k]) => k)).toEqual(['a', 'b', 'c'])
  }))

  it('returns empty when database is empty', () => withDB(async db => {
    expect(await collect(db.iterator() as any)).toEqual([])
  }))
})

describe('iterator - range bounds', () => {
  let db: TursoLevel
  beforeEach(async () => {
    db = makeDB()
    await db.open()
    await db.batch(['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ type: 'put' as const, key: k, value: `${i}` })))
  })

  it('gte', async () => {
    expect((await collect(db.iterator({ gte: 'c' }) as any)).map(([k]) => k)).toEqual(['c', 'd', 'e'])
  })
  it('gt', async () => {
    expect((await collect(db.iterator({ gt: 'c' }) as any)).map(([k]) => k)).toEqual(['d', 'e'])
  })
  it('lte', async () => {
    expect((await collect(db.iterator({ lte: 'c' }) as any)).map(([k]) => k)).toEqual(['a', 'b', 'c'])
  })
  it('lt', async () => {
    expect((await collect(db.iterator({ lt: 'c' }) as any)).map(([k]) => k)).toEqual(['a', 'b'])
  })
  it('gte + lte', async () => {
    expect((await collect(db.iterator({ gte: 'b', lte: 'd' }) as any)).map(([k]) => k)).toEqual(['b', 'c', 'd'])
  })
  it('gt + lt', async () => {
    expect((await collect(db.iterator({ gt: 'a', lt: 'e' }) as any)).map(([k]) => k)).toEqual(['b', 'c', 'd'])
  })
})

describe('iterator - reverse', () => {
  it('iterates in descending order', () => withDB(async db => {
    await db.batch(['a', 'b', 'c'].map((k, i) => ({ type: 'put' as const, key: k, value: `${i}` })))
    const keys = (await collect(db.iterator({ reverse: true }) as any)).map(([k]) => k)
    expect(keys).toEqual(['c', 'b', 'a'])
  }))

  it('reverse with range', () => withDB(async db => {
    await db.batch(['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ type: 'put' as const, key: k, value: `${i}` })))
    const keys = (await collect(db.iterator({ reverse: true, gte: 'b', lte: 'd' }) as any)).map(([k]) => k)
    expect(keys).toEqual(['d', 'c', 'b'])
  }))
})

describe('iterator - limit', () => {
  it('respects limit', () => withDB(async db => {
    await db.batch(['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ type: 'put' as const, key: k, value: `${i}` })))
    const keys = (await collect(db.iterator({ limit: 3 }) as any)).map(([k]) => k)
    expect(keys).toEqual(['a', 'b', 'c'])
  }))

  it('reverse + range + limit', () => withDB(async db => {
    await db.batch(['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ type: 'put' as const, key: k, value: `${i}` })))
    const keys = (await collect(db.iterator({ reverse: true, limit: 3 }) as any)).map(([k]) => k)
    expect(keys).toEqual(['e', 'd', 'c'])
  }))
})

describe('iterator - pagination (> PAGE_SIZE = 100)', () => {
  it('correctly iterates 200 entries', () => withDB(async db => {
    const ops = Array.from({ length: 200 }, (_, i) => ({
      type: 'put' as const,
      key: String(i).padStart(3, '0'),
      value: `v${i}`,
    }))
    await db.batch(ops)
    const entries = await collect(db.iterator() as any)
    expect(entries.length).toBe(200)
    expect(entries[0][0]).toBe('000')
    expect(entries[199][0]).toBe('199')
  }))
})

describe('iterator - keys / values options', () => {
  it('keys: false returns only values', () => withDB(async db => {
    await db.put('a', '1')
    const entries = await collect(db.iterator({ keys: false }) as any)
    expect(entries).toEqual([[undefined, '1']])
  }))

  it('values: false returns only keys', () => withDB(async db => {
    await db.put('a', '1')
    const entries = await collect(db.iterator({ values: false }) as any)
    expect(entries).toEqual([['a', undefined]])
  }))
})

describe('clear', () => {
  it('clears all entries', () => withDB(async db => {
    await db.batch(['a', 'b', 'c'].map((k, i) => ({ type: 'put' as const, key: k, value: `${i}` })))
    await db.clear()
    expect(await collect(db.iterator() as any)).toEqual([])
  }))

  it('clears a gte + lte range', () => withDB(async db => {
    await db.batch(['a', 'b', 'c', 'd'].map((k, i) => ({ type: 'put' as const, key: k, value: `${i}` })))
    await db.clear({ gte: 'b', lte: 'c' })
    expect((await collect(db.iterator() as any)).map(([k]) => k)).toEqual(['a', 'd'])
  }))

  it('clears with gt + lt', () => withDB(async db => {
    await db.batch(['a', 'b', 'c', 'd'].map((k, i) => ({ type: 'put' as const, key: k, value: `${i}` })))
    await db.clear({ gt: 'a', lt: 'd' })
    expect((await collect(db.iterator() as any)).map(([k]) => k)).toEqual(['a', 'd'])
  }))

  it('clears with limit', () => withDB(async db => {
    await db.batch(['a', 'b', 'c', 'd'].map((k, i) => ({ type: 'put' as const, key: k, value: `${i}` })))
    await db.clear({ limit: 2 })
    expect((await collect(db.iterator() as any)).map(([k]) => k)).toEqual(['c', 'd'])
  }))
})

describe('sublevel', () => {
  it('namespaces keys so they do not collide with parent', () => withDB(async db => {
    const sub = db.sublevel('s')
    await sub.put('key', 'sub')
    await db.put('key', 'root')
    expect(await sub.get('key')).toBe('sub')
    expect(await db.get('key')).toBe('root')
  }))

  it('iterates only sublevel keys', () => withDB(async db => {
    const sub = db.sublevel('s')
    await sub.put('a', '1')
    await db.put('other', 'x')
    const entries = await collect(sub.iterator() as any)
    expect(entries.length).toBe(1)
    expect(entries[0][0]).toBe('a')
  }))
})

describe('namespace option', () => {
  it('uses a prefixed table name', () => withDB(async db => {
    await db.put('k', 'v')
    expect(await db.get('k')).toBe('v')
  }, 'myns'))

  it('two different namespaces are isolated', async () => {
    const client1 = createClient({ url: ':memory:' })
    const client2 = createClient({ url: ':memory:' })
    const db1 = new TursoLevel({ client: client1, namespace: 'ns1' })
    const db2 = new TursoLevel({ client: client2, namespace: 'ns2' })
    await db1.open()
    await db2.open()
    await db1.put('k', 'from-db1')
    await expect(db2.get('k')).rejects.toMatchObject({ code: 'LEVEL_NOT_FOUND' })
    await db1.close()
    await db2.close()
  })
})
