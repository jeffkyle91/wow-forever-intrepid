// The Cloud Storage side of the rules tests. It starts the same demo project as harness.ts with firestore.rules AND storage.rules loaded (storage.rules reads the
// members documents of Firestore to learn a person's role), seeds the same baseline guild, and hands tests a storage client per persona. Run it through
// `npm run test:rules`, which starts the Firestore and Storage emulators.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach } from 'node:test'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import type { Firestore } from 'firebase/firestore'
import type { GuildRole } from '../../../src/security.ts'
import { UID, memberDoc, seedBaseline, type Persona } from './fixtures.ts'
import { PROJECT_ID, type Outcome } from './harness.ts'

const FIRESTORE_RULES = new URL('../../../firestore.rules', import.meta.url)
const STORAGE_RULES = new URL('../../../storage.rules', import.meta.url)

let testEnv: RulesTestEnvironment | undefined

type Bucket = ReturnType<RulesTestEnvironment['authenticatedContext']>['storage'] extends (...args: never[]) => infer Storage ? Storage : never

function env(): RulesTestEnvironment {
  if (!testEnv) throw new Error('The storage rules test environment is not running. Call setUpStorageEmulator() at the top of the test file.')
  return testEnv
}

function requireLocalEmulators(): void {
  for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
    const host = process.env[name]
    if (!host) throw new Error(`${name} is not set. Run these tests with \`npm run test:rules\`, which starts the Firestore and Storage emulators for you.`)
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) throw new Error(`Refusing to run against ${host}: the rules tests only talk to a local emulator.`)
  }
}

// clearStorage() of the test library leaves files behind in the emulator (checked), so every test starts by deleting what is in the bucket, rules off.
async function wipeBucket(): Promise<void> {
  await env().withSecurityRulesDisabled(async (ctx) => {
    const remove = async (folder: ReturnType<ReturnType<typeof ctx.storage>['ref']>): Promise<void> => {
      const listing = await folder.listAll()
      await Promise.all([...listing.items.map((item) => item.delete()), ...listing.prefixes.map(remove)])
    }
    await remove(ctx.storage().ref('guilds'))
  })
}

/** Seed the baseline guild (Firestore, rules off) and empty the bucket. */
export async function resetStorageData(): Promise<void> {
  await env().clearFirestore()
  await wipeBucket()
  await env().withSecurityRulesDisabled(async (ctx) => seedBaseline(ctx.firestore() as unknown as Firestore))
}

export function setUpStorageEmulator(): void {
  requireLocalEmulators()
  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(FIRESTORE_RULES, 'utf8') },
      storage: { rules: readFileSync(STORAGE_RULES, 'utf8') },
    })
  })
  beforeEach(resetStorageData)
  after(async () => {
    await testEnv?.cleanup()
  })
}

/** The bucket as the persona sees it (signed out for `anonymous`). */
export function bucketFor(who: Persona): Bucket {
  const context = who === 'anonymous' ? env().unauthenticatedContext() : env().authenticatedContext(UID[who])
  return context.storage()
}

/** The bucket as any uid sees it, for people who are not one of the personas. */
export function bucketForUid(uid: string): Bucket {
  return env().authenticatedContext(uid).storage()
}

/** Give a uid a members document in the test guild with the security rules off, for roles the baseline does not seed (such as `Removed`). */
export async function seedMemberRole(uid: string, role: string): Promise<void> {
  await env().withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`guilds/guild-test/members/${uid}`).set(memberDoc(uid, role as GuildRole))
  })
}

/** Put a file in the bucket with the security rules off, to arrange a case. */
export async function putAsAdmin(path: string, bytes = 10, contentType = 'image/jpeg'): Promise<void> {
  await env().withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref(path).put(new Uint8Array(bytes), { contentType })
  })
}

/** Whether a file exists, looked at with the rules off. (withSecurityRulesDisabled gives back nothing, so the answer is carried out in a variable.) */
export async function existsAsAdmin(path: string): Promise<boolean> {
  let found = false
  await env().withSecurityRulesDisabled(async (ctx) => {
    try {
      await ctx.storage().ref(path).getMetadata()
      found = true
    } catch {
      found = false
    }
  })
  return found
}

/** Upload a file of the given size and say what the rules did. */
export function upload(bucket: Bucket, path: string, bytes: number, contentType: string) {
  return bucket.ref(path).put(new Uint8Array(bytes), { contentType })
}

/** `denied` is the rules' refusal (storage/unauthorized); any other failure is reported as an error so a broken request cannot pass as "denied". */
export async function storageOutcome(operation: PromiseLike<unknown>): Promise<Outcome> {
  try {
    await operation
    return 'allowed'
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') return 'denied'
    return `error: ${error instanceof Error ? error.message : String(error)}`
  }
}

export async function expectStorageAllowed(operation: PromiseLike<unknown>, what = 'the operation'): Promise<void> {
  assert.equal(await storageOutcome(operation), 'allowed', `${what} should have been allowed`)
}

export async function expectStorageDenied(operation: PromiseLike<unknown>, what = 'the operation'): Promise<void> {
  assert.equal(await storageOutcome(operation), 'denied', `${what} should have been denied`)
}
