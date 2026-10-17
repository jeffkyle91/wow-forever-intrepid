import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { ContentError, parseBacklog, renderBacklog, renderRelease, retirePages, type Post } from './discord-content.ts'

type State = { webhookId: string; messages: Record<string, { id: string; hash: string }>; pending?: { key: string; hash: string }; managed?: string[] }
class PublisherError extends Error {
  ambiguous = false
}
function uncertain(message: string) {
  const error = new PublisherError(message)
  error.ambiguous = true
  return error
}

export function parsePosts(input: unknown): Post[] {
  if (!input || typeof input !== 'object' || !('posts' in input) || !Array.isArray(input.posts)
    || input.posts.length === 0 || input.posts.length > 100) throw new PublisherError('Expected 1 to 100 posts.')
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
  if ('pending' in input && input.pending !== undefined) {
    const pending = input.pending
    if (!pending || typeof pending !== 'object' || !('key' in pending) || typeof pending.key !== 'string'
      || !('hash' in pending) || typeof pending.hash !== 'string' || !/^[a-f0-9]{64}$/.test(pending.hash)) {
      throw new PublisherError('Invalid pending delivery state.')
    }
  }
  if ('managed' in input && (!Array.isArray(input.managed)
    || !input.managed.every((key: unknown) => typeof key === 'string' && /^(?:backlog|release)-[a-z0-9-]+$/.test(key)))) {
    throw new PublisherError('Invalid generated-message tracking state.')
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
    throw uncertain('Discord request failed or timed out. Delivery may have succeeded; check Discord before retrying to avoid duplicates.')
  }
  if (!response.ok) {
    if (response.status >= 500) throw uncertain(`Discord returned HTTP ${response.status}. Delivery may have succeeded; inspect Discord before retrying.`)
    throw new PublisherError(`Discord returned HTTP ${response.status}. ${response.status === 404 ? 'Restore the tracked message/webhook; it will not be recreated automatically.' : 'No automatic retry was attempted.'}`)
  }
  let data: unknown
  try { data = await response.json() } catch {
    throw uncertain('Discord returned an unreadable receipt. Check Discord before retrying.')
  }
  if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string' || !/^\d+$/.test(data.id)
    || (messageId && data.id !== messageId)) throw uncertain('Discord returned an invalid receipt. Check Discord before retrying.')
  return data.id
}

export async function publishPosts(posts: Post[], state: State, url: string, save: (state: State) => Promise<void>, request: typeof fetch = fetch) {
  if (state.pending) throw new PublisherError('A previous delivery is unresolved. Inspect Discord and repair the pending receipt before publishing again.')
  for (const post of posts) {
    const hash = createHash('sha256').update(post.content).digest('hex')
    const previous = state.messages[post.key]
    if (previous?.hash === hash) {
      console.log(`${post.key}: unchanged`)
      continue
    }
    state.pending = { key: post.key, hash }
    await save(state)
    let id: string
    try {
      id = await sendPost(url, post, previous?.id, request)
    } catch (error) {
      if (error instanceof PublisherError && !error.ambiguous) {
        delete state.pending
        await save(state)
      }
      throw error
    }
    state.messages[post.key] = { id, hash }
    delete state.pending
    try { await save(state) } catch {
      throw new PublisherError(`Message ${post.key} was sent as ${id}, but tracking could not be saved. Restore tracking before retrying to avoid duplicates.`)
    }
    console.log(`${post.key}: ${previous ? 'updated' : 'posted'} (${id})`)
  }
}

type Batch = { destination: string; webhook: ReturnType<typeof parseWebhook>; posts: Post[]; retirePrefix?: string }

export async function publishBatches(batches: Batch[], directory: string, request: typeof fetch = fetch) {
  if (new Set(batches.map((batch) => batch.webhook.id)).size !== batches.length) {
    throw new PublisherError('Backlog and patch-notes must use distinct webhooks.')
  }
  await mkdir(directory, { recursive: true })
  const resources: { batch: Batch; state: State; save: (state: State) => Promise<void>; lock: Awaited<ReturnType<typeof open>>; lockPath: string }[] = []
  try {
    for (const batch of batches) {
      const path = join(directory, `messages-${batch.webhook.id}.json`)
      const lockPath = join(directory, `messages-${batch.webhook.id}.lock`)
      let lock
      try { lock = await open(lockPath, 'wx') } catch {
        throw new PublisherError('Cannot acquire publisher lock. Another publish may be running; inspect the state directory before removing a stale lock.')
      }
      const save = async (next: State) => {
        await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 })
        await rename(`${path}.tmp`, path)
      }
      const resource = { batch, state: { webhookId: batch.webhook.id, messages: {} } as State, save, lock, lockPath }
      resources.push(resource)
      try {
        resource.state = parseState(JSON.parse(await readFile(path, 'utf8')), batch.webhook.id)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      if (resource.state.pending) throw new PublisherError('Unresolved Discord delivery. Inspect Discord and repair pending tracking before publishing.')
      if (batch.retirePrefix) {
        batch.posts = retirePages(batch.posts, resource.state.managed ?? [], batch.retirePrefix)
        resource.state.managed = [...new Set([...(resource.state.managed ?? []), ...batch.posts.map((post) => post.key)])]
      }
      parsePosts({ posts: batch.posts })
      await save(resource.state)
    }
    for (const resource of resources) {
      console.log(`Destination: ${resource.batch.destination}`)
      await publishPosts(resource.batch.posts, resource.state, resource.batch.webhook.url, resource.save, request)
    }
  } finally {
    for (const { lock, lockPath } of resources.reverse()) {
      await lock.close()
      await unlink(lockPath)
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' }, backlog: { type: 'boolean' }, release: { type: 'string' },
      destination: { type: 'string', default: 'backlog' }, publish: { type: 'boolean' },
      'state-dir': { type: 'string' }, help: { type: 'boolean' },
    }, strict: true,
  })
  if (values.help) {
    console.log('Use scripts\\discord-backlog.ps1 -File <posts.json> | -Backlog | -Release <exact heading> [-Publish]. Preview is default; -Destination backlog|patch-notes selects manual/configuration destination.')
    return
  }
  if ([values.file, values.backlog, values.release].filter(Boolean).length !== 1) throw new PublisherError('Select exactly one of --file, --backlog or --release.')
  if (!['backlog', 'patch-notes'].includes(values.destination)) throw new PublisherError('Unknown destination.')
  if (!values.file && values.destination !== 'backlog') throw new PublisherError('Generated modes choose their own destinations; omit --destination.')
  const batches: { destination: string; posts: Post[]; retirePrefix?: string }[] = []
  if (values.file) {
    const posts = parsePosts(JSON.parse(await readFile(values.file, 'utf8')))
    if (posts.some((post) => /^(?:backlog|release)-/.test(post.key))) throw new PublisherError('Manual post keys must not use the reserved backlog- or release- prefixes.')
    batches.push({ destination: values.destination, posts })
  }
  else {
    const root = new URL('../', import.meta.url)
    const changelog = await readFile(new URL('CHANGELOG.md', root), 'utf8')
    const items = parseBacklog(JSON.parse(await readFile(new URL('docs/backlog.json', root), 'utf8')), changelog)
    if (values.release) {
      const posts = renderRelease(changelog, values.release)
      batches.push({ destination: 'patch-notes', posts, retirePrefix: posts[0].key.replace(/-\d+$/, '-') })
    }
    batches.push({ destination: 'backlog', posts: renderBacklog(items), retirePrefix: 'backlog-' })
  }
  for (const batch of batches) {
    parsePosts({ posts: batch.posts })
    console.log(`\nDestination: ${batch.destination}`)
    for (const post of batch.posts) console.log(`\n--- ${post.key} (${post.content.length}/2000 characters) ---\n${post.content}`)
  }
  if (!values.publish) {
    console.log('\nPreview only. Nothing posted. Archived overflow pages, if tracked, will be replaced with an archive notice.')
    return
  }
  if (!values['state-dir']) throw new PublisherError('Specify --state-dir outside the repository.')
  const configured = batches.map((batch) => ({
    ...batch,
    webhook: parseWebhook(process.env[batch.destination === 'backlog' ? 'INTREPID_DISCORD_WEBHOOK' : 'INTREPID_DISCORD_PATCH_NOTES_WEBHOOK'] ?? ''),
  }))
  delete process.env.INTREPID_DISCORD_WEBHOOK
  delete process.env.INTREPID_DISCORD_PATCH_NOTES_WEBHOOK
  const repository = fileURLToPath(new URL('../', import.meta.url))
  const location = relative(repository, resolve(values['state-dir']))
  if (location === '' || (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location))) throw new PublisherError('Tracking state must be outside the repository.')
  await publishBatches(configured, values['state-dir'])
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`Discord publishing stopped: ${error instanceof PublisherError || error instanceof ContentError ? error.message : 'Check the input JSON, file permissions, arguments and tracking state. Raw errors are suppressed to protect the webhook credential.'}`)
    process.exitCode = 1
  })
}
