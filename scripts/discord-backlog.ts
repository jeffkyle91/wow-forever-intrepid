import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

type Post = { key: string; content: string }
type State = { webhookId: string; messages: Record<string, { id: string; hash: string }> }
class PublisherError extends Error {}

export function parsePosts(input: unknown): Post[] {
  if (!input || typeof input !== 'object' || !('posts' in input) || !Array.isArray(input.posts)
    || input.posts.length === 0 || input.posts.length > 20) throw new PublisherError('Expected 1 to 20 posts.')
  const keys = new Set<string>()
  return input.posts.map((post: unknown) => {
    if (!post || typeof post !== 'object' || !('key' in post) || !('content' in post)
      || typeof post.key !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(post.key)
      || ['constructor', 'prototype'].includes(post.key)
      || typeof post.content !== 'string' || !post.content.trim() || post.content.length > 2000) {
      throw new PublisherError('Each post needs a unique lowercase key and 1 to 2000 characters of content.')
    }
    if (/discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\//i.test(post.content)) {
      throw new PublisherError('Webhook URLs must not appear in post content.')
    }
    if (keys.has(post.key)) throw new PublisherError('Post keys must be unique.')
    keys.add(post.key)
    return { key: post.key, content: post.content }
  })
}

export function parseWebhook(secret: string) {
  const match = /^https:\/\/discord(?:app)?\.com\/api(?:\/v10)?\/webhooks\/([0-9]+)\/([A-Za-z0-9_.-]+)$/.exec(secret.trim())
  if (!match) throw new PublisherError('Invalid webhook configuration. Run the secure setup again.')
  return { id: match[1], url: `https://discord.com/api/v10/webhooks/${match[1]}/${match[2]}` }
}

export function parseState(input: unknown, webhookId: string): State {
  if (!input || typeof input !== 'object' || !('webhookId' in input) || input.webhookId !== webhookId
    || !('messages' in input) || !input.messages || typeof input.messages !== 'object' || Array.isArray(input.messages)) {
    throw new PublisherError('Invalid tracking state or changed webhook. Restore the correct state before publishing.')
  }
  for (const entry of Object.values(input.messages)) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^\d+$/.test(entry.id)
      || typeof entry.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash)) throw new PublisherError('Invalid message tracking state.')
  }
  return input as State
}

export async function sendPost(url: string, post: Post, messageId?: string, request: typeof fetch = fetch): Promise<string> {
  let response: Response
  try {
    response = await request(messageId ? `${url}/messages/${messageId}` : `${url}?wait=true`, {
      method: messageId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: post.content, allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new PublisherError('Discord request failed or timed out. Delivery may have succeeded; check Discord before retrying to avoid duplicates.')
  }
  if (!response.ok) {
    throw new PublisherError(`Discord returned HTTP ${response.status}. ${response.status === 404 ? 'Restore the tracked message/webhook; it will not be recreated automatically.' : 'No automatic retry was attempted.'}`)
  }
  let data: unknown
  try { data = await response.json() } catch {
    throw new PublisherError('Discord returned an unreadable receipt. Check Discord before retrying.')
  }
  if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string' || !/^\d+$/.test(data.id)
    || (messageId && data.id !== messageId)) throw new PublisherError('Discord returned an invalid receipt. Check Discord before retrying.')
  return data.id
}

export async function publishPosts(posts: Post[], state: State, url: string, save: (state: State) => Promise<void>, request: typeof fetch = fetch) {
  for (const post of posts) {
    const hash = createHash('sha256').update(post.content).digest('hex')
    const previous = state.messages[post.key]
    if (previous?.hash === hash) {
      console.log(`${post.key}: unchanged`)
      continue
    }
    const id = await sendPost(url, post, previous?.id, request)
    state.messages[post.key] = { id, hash }
    try { await save(state) } catch {
      throw new PublisherError(`Message ${post.key} was sent as ${id}, but tracking could not be saved. Restore tracking before retrying to avoid duplicates.`)
    }
    console.log(`${post.key}: ${previous ? 'updated' : 'posted'} (${id})`)
  }
}

async function main() {
  const { values } = parseArgs({
    options: { file: { type: 'string' }, publish: { type: 'boolean' }, 'state-dir': { type: 'string' }, help: { type: 'boolean' } },
    strict: true,
  })
  if (values.help) {
    console.log('Use scripts\\discord-backlog.ps1 -File <posts.json> [-Publish]. Preview is the default; -Configure stores the webhook securely on Windows.')
    return
  }
  if (!values.file) throw new PublisherError('Specify --file with the posts JSON file.')
  const posts = parsePosts(JSON.parse(await readFile(values.file, 'utf8')))
  if (!values.publish) {
    for (const post of posts) console.log(`\n--- ${post.key} (${post.content.length}/2000 characters) ---\n${post.content}`)
    console.log('\nPreview only. Nothing posted.')
    return
  }
  if (!values['state-dir']) throw new PublisherError('Specify --state-dir outside the repository.')
  const webhook = parseWebhook(process.env.INTREPID_DISCORD_WEBHOOK ?? '')
  delete process.env.INTREPID_DISCORD_WEBHOOK
  const directory = values['state-dir']
  await mkdir(directory, { recursive: true })
  const path = join(directory, `messages-${webhook.id}.json`)
  const lockPath = join(directory, `messages-${webhook.id}.lock`)
  let lock
  try { lock = await open(lockPath, 'wx') } catch {
    throw new PublisherError('Cannot acquire publisher lock. Another publish may be running; inspect the state directory before removing a stale lock.')
  }
  try {
    let state: State
    try {
      state = parseState(JSON.parse(await readFile(path, 'utf8')), webhook.id)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      state = { webhookId: webhook.id, messages: {} }
    }
    const save = async (next: State) => {
      const temp = `${path}.tmp`
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 })
      await rename(temp, path)
    }
    await save(state)
    await publishPosts(posts, state, webhook.url, save)
  } finally {
    await lock.close()
    await unlink(lockPath)
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`Discord publishing stopped: ${error instanceof PublisherError ? error.message : 'Check the input JSON, file permissions, arguments and tracking state. Raw errors are suppressed to protect the webhook credential.'}`)
    process.exitCode = 1
  })
}
