/**
 * Runs abstract-level's official compliance suite against TursoLevel.
 */
import suite from 'abstract-level/test'
import { tapeRunner } from './tape-bridge.js'
import { createClient } from '@libsql/client'
import { TursoLevel } from '../src/index.js'

suite({
  test: tapeRunner(),

  // Each factory call gets a fresh in-memory SQLite DB → full isolation
  factory(options?: Record<string, unknown>) {
    const client = createClient({ url: ':memory:' })
    return new TursoLevel({ client, ...options })
  },
})
