import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { parsePosts, parseState, parseWebhook, publishPosts, sendPost } from '../../scripts/discord-backlog.ts'

const webhook = 'https://discord.com/api/webhooks/123/invented-token'
const post = { key: 'raid-backlog', content: 'Pending raid snapshots' }
const state = () => ({ webhookId: '123', messages: {} })

describe('Discord backlog validation', () => {
  it('accepts exactly 2000 characters and rejects empty or oversized posts', () => {
    assert.equal(parsePosts({ posts: [{ ...post, content: 'a'.repeat(2000) }] })[0].content.length, 2000)
    for (const content of ['', ' ', 'a'.repeat(2001)]) assert.throws(() => parsePosts({ posts: [{ ...post, content }] }))
  })
  it('rejects invalid keys, duplicate keys, empty batches and credentials in content', () => {
    for (const input of [{ posts: [] }, { posts: [post, post] }, { posts: [{ ...post, key: '__proto__' }] },
      { posts: [{ ...post, content: webhook }] }, { posts: [{ ...post, content: 42 }] }]) {
      assert.throws(() => parsePosts(input))
    }
  })
  it('only accepts the exact Discord HTTPS webhook path', () => {
    assert.equal(parseWebhook(webhook).url, 'https://discord.com/api/v10/webhooks/123/invented-token')
    for (const url of [webhook + '?x=1', webhook + '/messages/1', webhook.replace('discord.com', 'example.test'),
      webhook.replace('https:', 'http:'), webhook.replace('discord.com', 'discord.com.evil.test')]) {
      assert.throws(() => parseWebhook(url))
    }
  })
  it('accepts legacy Discord hosts, dotted tokens and surrounding paste whitespace', () => {
    assert.deepEqual(parseWebhook(' \r\nhttps://discordapp.com/api/webhooks/123/invented.token_- \r\n'), {
      id: '123', url: 'https://discord.com/api/v10/webhooks/123/invented.token_-',
    })
    assert.throws(() => parseWebhook(webhook + '#fragment'))
    assert.throws(() => parseWebhook(webhook.replace('discord.com', 'discordapp.com.evil.test')))
  })
  it('refuses malformed state or tracking for another webhook', () => {
    assert.deepEqual(parseState(state(), '123'), state())
    assert.throws(() => parseState(state(), '456'))
    assert.throws(() => parseState({ webhookId: '123', messages: { x: { id: 'bad', hash: 'bad' } } }, '123'))
  })
})

describe('Discord publishing (mock HTTP only)', () => {
  it('creates with wait=true and disables every mention type', async () => {
    const id = await sendPost(parseWebhook(webhook).url, post, undefined, async (input, init) => {
      assert.equal(String(input), parseWebhook(webhook).url + '?wait=true')
      assert.equal(init?.method, 'POST')
      assert.equal(init?.redirect, 'error')
      const body = JSON.parse(String(init?.body))
      assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
      return Response.json({ id: '456' })
    })

    assert.equal(id, '456')
  })
  it('updates the existing message rather than posting a replacement', async () => {
    await sendPost(parseWebhook(webhook).url, post, '456', async (input, init) => {
      assert.equal(String(input), parseWebhook(webhook).url + '/messages/456')
      assert.equal(init?.method, 'PATCH')
      return Response.json({ id: '456' })
    })
  })
  it('stops on HTTP errors and does not expose response bodies or retry', async () => {
    for (const status of [401, 404, 429, 500]) {
      let calls = 0
      await assert.rejects(sendPost(parseWebhook(webhook).url, post, undefined, async () => {
        calls++
        return new Response(webhook, { status })
      }), error => error instanceof Error && error.message.includes(`HTTP ${status}`) && !error.message.includes(webhook))
      assert.equal(calls, 1)
    }
  })
  it('sanitizes transport errors and refuses invalid receipts', async () => {
    await assert.rejects(sendPost(webhook, post, undefined, async () => { throw new Error(webhook) }),
      error => error instanceof Error && !error.message.includes(webhook) && error.message.includes('Delivery may have succeeded'))
    await assert.rejects(sendPost(webhook, post, '456', async () => Response.json({ id: '789' })), /invalid receipt/)
  })
  it('persists each receipt, skips unchanged content, and updates changed content', async () => {
    const tracking = state()
    let requests = 0
    let saves = 0
    const request: typeof fetch = async () => { requests++; return Response.json({ id: '456' }) }
    const save = async () => { saves++ }
    await publishPosts([post], tracking, webhook, save, request)
    await publishPosts([post], tracking, webhook, save, request)
    assert.equal(requests, 1)
    assert.equal(saves, 2)
    await publishPosts([{ ...post, content: 'Updated backlog' }], tracking, webhook, save, request)
    assert.equal(requests, 2)
    assert.equal(saves, 4)
  })
  it('stops the batch if tracking cannot be saved after a send', async () => {
    let requests = 0
    let saves = 0
    await assert.rejects(publishPosts([post, { ...post, key: 'second' }], state(), webhook,
      async () => { if (++saves === 2) throw new Error('disk failure') }, async () => { requests++; return Response.json({ id: '456' }) }), /tracking could not be saved/)
    assert.equal(requests, 1)
  })
})

describe('Discord preview CLI', () => {
  it('configures from the clipboard without printing the URL and clears it after saving', { skip: process.platform !== 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intrepid-discord-clipboard-'))
    try {
      const wrapper = fileURLToPath(new URL('../../scripts/discord-backlog.ps1', import.meta.url))
      const command = `function Get-Clipboard { 'https://discord.com/api/webhooks/123/invented.token' }; function Set-Clipboard { param($Value) if ($Value -ne 'Webhook configuration saved.') { throw 'Expected harmless replacement text' }; Write-Output 'Clipboard cleared' }; & '${wrapper.replaceAll("'", "''")}' -ConfigureFromClipboard`
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8', env: { ...process.env, LOCALAPPDATA: directory }, timeout: 15000,
      })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Webhook saved using Windows user encryption/)
      assert.match(result.stdout, /Clipboard cleared/)
      assert.doesNotMatch(result.stdout + result.stderr, /invented\.token/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('configures a dotted legacy URL with whitespace using Windows encryption', { skip: process.platform !== 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intrepid-discord-configure-'))
    try {
      const wrapper = fileURLToPath(new URL('../../scripts/discord-backlog.ps1', import.meta.url))
      const command = `function Read-Host { ConvertTo-SecureString ' https://discordapp.com/api/webhooks/123/invented.token_- ' -AsPlainText -Force }; & '${wrapper.replaceAll("'", "''")}' -Configure`
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8', env: { ...process.env, LOCALAPPDATA: directory }, timeout: 15000,
      })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Webhook saved using Windows user encryption/)
      assert.doesNotMatch(result.stdout + result.stderr, /invented\.token/)
      const encrypted = await (await import('node:fs/promises')).readFile(join(directory, 'IntrepidRaidDesk', 'Discord', 'webhook.xml'), 'utf8')
      assert.doesNotMatch(encrypted, /invented\.token|https:\/\/discord/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('previews through the Windows wrapper without credentials or posting', { skip: process.platform !== 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intrepid-discord-preview-'))
    try {
      const file = join(directory, 'posts.json')
      await writeFile(file, JSON.stringify({ posts: [post] }))
      const wrapper = fileURLToPath(new URL('../../scripts/discord-backlog.ps1', import.meta.url))
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', wrapper, '-File', file], {
        encoding: 'utf8',
        env: { ...process.env, INTREPID_DISCORD_WEBHOOK: '', LOCALAPPDATA: directory },
        timeout: 15000,
      })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Preview only. Nothing posted./)
      assert.match(result.stdout, /Pending raid snapshots/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
