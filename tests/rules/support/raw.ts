// A "modified browser" for the rules tests: sends a commit straight to the emulator's REST API with an unsigned
// user token, so a test can send values the JavaScript SDK never would (a double that equals an integer, 1.0).
// It goes through the same security rules as any client; the negative controls in audit.test.ts prove that.
import { GUILD_ID } from './fixtures.ts'
import { PROJECT_ID } from './harness.ts'

/** A number sent as a double, even when it is a whole number. */
export const asDouble = (n: number) => ({ $double: n })
/** The server's request time (what serverTimestamp() means). */
export const requestTime = { $requestTime: true }

type Fields = Record<string, unknown>

function toValue(v: unknown): unknown {
  if (v === null) return { nullValue: null }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }
  const object = v as Record<string, unknown>
  if ('$double' in object) return { doubleValue: object.$double }
  return { mapValue: { fields: Object.fromEntries(Object.entries(object).map(([key, value]) => [key, toValue(value)])) } }
}

/** One write inside the test guild: `path` is relative, like 'awards/award-1'. `mask` makes it an update of just those fields. */
export type RawWrite = { path: string; fields: Fields; mask?: string[] }

const base64Url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

function tokenFor(uid: string): string {
  const now = Math.floor(Date.now() / 1000)
  const claims = { iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID, iat: now, exp: now + 3600, auth_time: now, user_id: uid, sub: uid, firebase: { sign_in_provider: 'custom', identities: {} } }
  return `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url(claims)}.`
}

function encode(write: RawWrite): Record<string, unknown> {
  const name = `projects/${PROJECT_ID}/databases/(default)/documents/guilds/${GUILD_ID}/${write.path}`
  const plain: Fields = {}
  const transforms: unknown[] = []
  for (const [field, value] of Object.entries(write.fields)) {
    if (value && typeof value === 'object' && '$requestTime' in value) transforms.push({ fieldPath: field, setToServerValue: 'REQUEST_TIME' })
    else plain[field] = value
  }
  const out: Record<string, unknown> = { update: { name, fields: Object.fromEntries(Object.entries(plain).map(([field, value]) => [field, toValue(value)])) } }
  if (write.mask) out.updateMask = { fieldPaths: write.mask }
  if (transforms.length) out.updateTransforms = transforms
  return out
}

/** Commit the writes as `uid` (or with no sign-in when `uid` is null): 'allowed', 'denied' (PERMISSION_DENIED) or 'error: ...'. */
export async function rawCommit(uid: string | null, writes: RawWrite[]): Promise<string> {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run these tests with `npm run test:rules`.')
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) throw new Error(`Refusing to run against ${host}: the rules tests only talk to a local emulator.`)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (uid) headers.authorization = `Bearer ${tokenFor(uid)}`
  const response = await fetch(`http://${host}/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`, { method: 'POST', headers, body: JSON.stringify({ writes: writes.map(encode) }) })
  if (response.ok) return 'allowed'
  const body = (await response.json()) as { error?: { status?: string; message?: string } }
  return body.error?.status === 'PERMISSION_DENIED' ? 'denied' : `error: ${body.error?.status} ${body.error?.message}`
}
