// Starts the rules test environment against the local Firestore emulator and hands tests the pieces
// they need: a client per persona, an admin that bypasses the rules, and a way to ask "did the
// rules allow this?". Run it through `npm run test:rules`, which starts the emulator first.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach } from 'node:test'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, setLogLevel, type DocumentData, type Firestore } from 'firebase/firestore'
import { GUILD_ID, UID, seedBaseline, type Persona } from './fixtures.ts'

/** Must match `--project` in the `test:rules` script. A demo- project id never contacts Google. */
export const PROJECT_ID = 'demo-intrepid'

const RULES_FILE = new URL('../../../firestore.rules', import.meta.url)

let testEnv: RulesTestEnvironment | undefined

function env(): RulesTestEnvironment {
  if (!testEnv) throw new Error('The rules test environment is not running. Call setUpGuildEmulator() at the top of the test file.')
  return testEnv
}

function requireLocalEmulator(): void {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run these tests with `npm run test:rules`, which starts the Firestore emulator for you.')
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) throw new Error(`Refusing to run against ${host}: the rules tests only talk to a local emulator.`)
}

/** Wipe the emulator and write the baseline guild again. Tests call this to start a case from scratch. */
export async function resetData(): Promise<void> {
  await env().clearFirestore()
  await env().withSecurityRulesDisabled((ctx) => seedBaseline(asModular(ctx.firestore())))
}

/**
 * Call once at the top of a test file. Loads the repository's firestore.rules into the emulator,
 * resets the data before every test, and cleans up at the end. Test files run one at a time (see the
 * `test:rules` script) because they share one emulator and one project.
 */
export function setUpGuildEmulator(): void {
  requireLocalEmulator() // up front, so a missing emulator is one clear error and not a failure of every test
  before(async () => {
    setLogLevel('silent') // denied writes are the point here; the SDK would log each one
    testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync(RULES_FILE, 'utf8') } })
  })
  beforeEach(resetData)
  after(async () => {
    await testEnv?.cleanup()
  })
}

// The test environment hands out compat Firestore objects. The modular functions (doc, setDoc, ...)
// accept them at runtime, but the types differ, so cast once here.
function asModular(db: unknown): Firestore {
  return db as Firestore
}

/** A Firestore client signed in as the persona (or signed out for `anonymous`). */
export function dbFor(who: Persona): Firestore {
  const context = who === 'anonymous' ? env().unauthenticatedContext() : env().authenticatedContext(UID[who])
  return asModular(context.firestore())
}

/** A client signed in as any uid, for people who are not one of the personas. */
export function dbForUid(uid: string): Firestore {
  return asModular(env().authenticatedContext(uid).firestore())
}

/** Run something with the security rules switched off: for arranging state, never for the thing under test. */
export async function asAdmin<T>(fn: (db: Firestore) => Promise<T>): Promise<T> {
  let result: T | undefined
  await env().withSecurityRulesDisabled(async (ctx) => {
    result = await fn(asModular(ctx.firestore()))
  })
  return result as T
}

/** Paths inside the test guild: `guildDoc(db, 'roster/player-1')`. */
export const guildDoc = (db: Firestore, path: string) => doc(db, `guilds/${GUILD_ID}/${path}`)
export const guildCollection = (db: Firestore, path: string) => collection(db, `guilds/${GUILD_ID}/${path}`)

/** What is stored right now, read with the rules off. `undefined` when the document does not exist. */
export async function stored(path: string): Promise<DocumentData | undefined> {
  return asAdmin(async (db) => (await getDoc(guildDoc(db, path))).data())
}

export type Outcome = 'allowed' | 'denied' | `error: ${string}`

/**
 * Await a Firestore operation and say what the rules did with it. `denied` means PERMISSION_DENIED;
 * anything else that fails (a malformed request, a size limit) is reported as an error rather than
 * a rules decision, so a broken test payload cannot pass as "denied".
 */
export async function outcomeOf(operation: Promise<unknown>): Promise<Outcome> {
  try {
    await operation
    return 'allowed'
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'permission-denied') return 'denied'
    return `error: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Assert the rules allowed the operation. `what` says what was attempted, for the failure message. */
export async function expectAllowed(operation: Promise<unknown>, what = 'the operation'): Promise<void> {
  assert.equal(await outcomeOf(operation), 'allowed', `${what} should have been allowed`)
}

/** Assert the rules refused the operation with PERMISSION_DENIED (not some other failure). */
export async function expectDenied(operation: Promise<unknown>, what = 'the operation'): Promise<void> {
  assert.equal(await outcomeOf(operation), 'denied', `${what} should have been denied`)
}
