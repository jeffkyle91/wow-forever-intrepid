import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { parseBacklog, renderBacklog, renderRelease, retirePages, type BacklogItem } from '../../scripts/discord-content.ts'
import { parsePosts, parseState, parseWebhook, publishBatches } from '../../scripts/discord-backlog.ts'

const heading = '2026-10-16 - abcdef1'
const changelog = `# Patch notes\n\n## Unreleased\n\nNot live\n\n## ${heading}\n\nVerified changes.\n\n- Test feature.\n`
const item = (overrides: Partial<BacklogItem> = {}): BacklogItem => ({
  id: 'RAID-001', title: 'Starting snapshots', status: 'planned', priority: 'critical', target: '2026-12-09',
  commitment: 'required', dependsOn: [], prs: [], release: null, notes: 'Preserve history.', ...overrides,
})
const backlog = (items: BacklogItem[]) => ({ schemaVersion: 1, items })
const webhook = (id: string) => parseWebhook(`https://discord.com/api/webhooks/${id}/invented-token`)

describe('Shared Discord content', () => {
  it('validates unique IDs, values, dates, dependency cycles and release references', () => {
    assert.equal(parseBacklog(backlog([item()]), changelog).length, 1)
    for (const items of [
      [item(), item()], [item({ target: '2026-02-30' })], [item({ dependsOn: ['RAID-002'] })],
      [item({ dependsOn: ['RAID-002'] }), item({ id: 'RAID-002', dependsOn: ['RAID-001'] })],
      [item({ status: 'released' })], [item({ release: heading })], [item({ status: 'released', release: 'Unreleased' })],
    ]) assert.throws(() => parseBacklog(backlog(items), changelog))
    assert.equal(parseBacklog(backlog([item({ status: 'released', release: heading })]), changelog).length, 1)
  })
  it('renders active items including awaiting-deployment and hides released/cancelled items', () => {
    const posts = renderBacklog([item(), item({ id: 'LOOT-001', status: 'awaiting-deployment' }),
      item({ id: 'OLD-001', status: 'released', release: heading }), item({ id: 'OLD-002', status: 'cancelled' })])
    assert.ok(posts.some((p) => p.content.includes('awaiting-deployment')))
    assert.ok(!posts.some((p) => p.content.includes('OLD-')))
    assert.ok(renderBacklog([])[0].content.includes('No active'))
  })
  it('paginates under 2000 characters with deterministic keys and explicit overflow failure', () => {
    const items = Array.from({ length: 15 }, (_, index) => item({ id: `RAID-${String(index + 1).padStart(3, '0')}`, notes: 'a'.repeat(400) }))
    const posts = renderBacklog(items)
    assert.ok(posts.length > 1)
    assert.ok(posts.every((post) => post.content.length <= 2000))
    assert.deepEqual(renderBacklog(items), posts)
    assert.throws(() => renderBacklog([item({ notes: 'a'.repeat(2000) })]))
    assert.throws(() => parsePosts({ posts: renderBacklog([item({ notes: 'https://discord.com/api/webhooks/123/secret' })]) }))
  })
  it('selects exactly one dated release, excludes Unreleased and uses a stable release key', () => {
    const posts = renderRelease(changelog, heading)
    assert.ok(posts[0].content.includes('Test feature'))
    assert.ok(!posts[0].content.includes('Not live'))
    assert.equal(renderRelease(changelog + '\n', heading)[0].key, posts[0].key)
    assert.throws(() => renderRelease(changelog, 'Unreleased'))
    assert.throws(() => renderRelease(changelog, '2026-10-16 - 1234567'))
    assert.throws(() => renderRelease(changelog + `\n## ${heading}\nDuplicate`, heading))
    assert.throws(() => renderRelease(`## ${heading}`, heading), /empty/)
    assert.throws(() => renderRelease('## 2026-02-30 - abcdef1\n\nExample', '2026-02-30 - abcdef1'))
    const overhead = `**Intrepid patch notes - ${heading}**\n\n`.length
    const exact = `## ${heading}\n\n${'a'.repeat(2000 - overhead)}`
    assert.equal(renderRelease(exact, heading)[0].content.length, 2000)
    assert.throws(() => renderRelease(exact + 'a', heading), /exceeds/)
  })
  it('retires only obsolete pages in the selected namespace without deleting messages', () => {
    const posts = renderBacklog([item()])
    const retired = retirePages(posts, ['backlog-raid-1', 'backlog-raid-2', 'release-other-1', 'custom'], 'backlog-')
    assert.equal(retired.length, 2)
    assert.equal(retired[1].key, 'backlog-raid-2')
    assert.match(retired[1].content, /Archived/)
  })
  it('validates and renders the real repository sources without network or credentials', async () => {
    const log = await readFile(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
    const items = parseBacklog(JSON.parse(await readFile(new URL('../../docs/backlog.json', import.meta.url), 'utf8')), log)
    assert.ok(parsePosts({ posts: renderBacklog(items) }).length > 0)
    assert.ok(renderRelease(log, '2026-10-16 - bbefbc2').length > 0)
  })
})

describe('Coordinated publication (mock transport only)', () => {
  it('recovers after backlog failure without duplicating already-sent release messages', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intrepid-release-test-'))
    const batches = () => [
      { destination: 'patch-notes', webhook: webhook('111'), posts: renderRelease(changelog, heading) },
      { destination: 'backlog', webhook: webhook('222'), posts: renderBacklog([item()]), retirePrefix: 'backlog-' },
    ]
    try {
      const sent: string[] = []
      let failBacklog = true
      const request: typeof fetch = async (url) => {
        const location = String(url)
        sent.push(location.includes('/111/') ? 'patch-notes' : 'backlog')
        if (location.includes('/222/') && failBacklog) return new Response('', { status: 429 })
        return Response.json({ id: '999' })
      }
      await assert.rejects(publishBatches(batches(), directory, request), /HTTP 429/)
      assert.deepEqual(sent, ['patch-notes', 'backlog'])
      failBacklog = false
      await publishBatches(batches(), directory, request)
      assert.deepEqual(sent, ['patch-notes', 'backlog', 'backlog'])
      await publishBatches(batches(), directory, request)
      assert.equal(sent.length, 3)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('retains unresolved deliveries on disk and blocks retries after ambiguous failures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intrepid-release-uncertain-'))
    try {
      const batch = { destination: 'backlog', webhook: webhook('222'), posts: renderBacklog([item()]) }
      let calls = 0
      const request: typeof fetch = async () => { calls++; throw new Error('network failed') }
      await assert.rejects(publishBatches([batch], directory, request), /Delivery may have succeeded/)
      const tracking = parseState(JSON.parse(await readFile(join(directory, 'messages-222.json'), 'utf8')), '222')
      assert.ok(tracking.pending)
      await assert.rejects(publishBatches([batch], directory, request), /Unresolved/)
      assert.equal(calls, 1)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('rejects same-webhook destinations and invalid second-batch state before any sends', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intrepid-release-preflight-'))
    try {
      const batch = { destination: 'backlog', webhook: webhook('222'), posts: renderBacklog([item()]) }
      let calls = 0
      const request: typeof fetch = async () => { calls++; return Response.json({ id: '999' }) }
      await assert.rejects(publishBatches([batch, batch], directory, request), /distinct/)
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(directory, 'messages-333.json'), 'invalid')
      await assert.rejects(publishBatches([batch, { ...batch, webhook: webhook('333') }], directory, request))
      assert.equal(calls, 0)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('archives obsolete generated pages with PATCH while leaving manual messages untouched', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intrepid-retired-pages-'))
    try {
      const batch = (items: BacklogItem[]) => ({
        destination: 'backlog', webhook: webhook('222'), posts: renderBacklog(items), retirePrefix: 'backlog-',
      })
      let id = 100
      const updates: { method: string; content: string }[] = []
      const request: typeof fetch = async (url, options) => {
        const method = String(options?.method)
        updates.push({ method, content: JSON.parse(String(options?.body)).content })
        return Response.json({ id: method === 'POST' ? String(++id) : String(url).split('/').at(-1) })
      }
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(directory, 'messages-222.json'), JSON.stringify({
        webhookId: '222', messages: { 'backlog-manual-1': { id: '99', hash: 'a'.repeat(64) } },
      }))
      await publishBatches([batch([item(), item({ id: 'LOOT-001' })])], directory, request)
      await publishBatches([batch([item()])], directory, request)
      assert.deepEqual(updates.map((update) => update.method), ['POST', 'POST', 'PATCH'])
      assert.match(updates[2].content, /Archived/)
      const tracking = parseState(JSON.parse(await readFile(join(directory, 'messages-222.json'), 'utf8')), '222')
      assert.equal(tracking.messages['backlog-manual-1'].hash, 'a'.repeat(64))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('retains pending tracking after server errors and sends nothing if the second lock is held', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intrepid-locks-'))
    try {
      const { writeFile, unlink } = await import('node:fs/promises')
      const batch = (id: string) => ({ destination: 'backlog', webhook: webhook(id), posts: renderBacklog([item()]) })
      let calls = 0
      const request: typeof fetch = async () => { calls++; return new Response('', { status: 503 }) }
      await writeFile(join(directory, 'messages-333.lock'), 'held')
      await assert.rejects(publishBatches([batch('222'), batch('333')], directory, request), /lock/)
      assert.equal(calls, 0)
      await unlink(join(directory, 'messages-333.lock'))
      await publishBatches([batch('222')], directory, request).then(
        () => assert.fail('Expected uncertain server error'),
        (error: Error) => assert.match(error.message, /may have succeeded/),
      )
      const tracking = parseState(JSON.parse(await readFile(join(directory, 'messages-222.json'), 'utf8')), '222')
      assert.ok(tracking.pending)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

describe('Named Windows destinations', () => {
  it('previews a coordinated release without credentials and rejects Unreleased', { skip: process.platform !== 'win32' }, () => {
    const wrapper = fileURLToPath(new URL('../../scripts/discord-backlog.ps1', import.meta.url))
    const preview = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', wrapper, '-Release', '2026-10-16 - bbefbc2'], { encoding: 'utf8', timeout: 15000 })
    assert.equal(preview.status, 0, preview.stderr)
    assert.match(preview.stdout, /Destination: patch-notes/)
    assert.match(preview.stdout, /Destination: backlog/)
    assert.match(preview.stdout, /Nothing posted/)
    assert.ok(!preview.stdout.includes('Earlier releases have not been reconstructed'))
    const rejected = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', wrapper, '-Release', 'Unreleased'], { encoding: 'utf8', timeout: 15000 })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /not Unreleased/)
  })
  it('configures patch notes without overwriting the original backlog credential', { skip: process.platform !== 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intrepid-destinations-'))
    try {
      const wrapper = fileURLToPath(new URL('../../scripts/discord-backlog.ps1', import.meta.url))
      for (const destination of ['backlog', 'patch-notes']) {
        const command = `function Get-Clipboard { 'https://discord.com/api/webhooks/123/invented-token' }; function Set-Clipboard {}; & '${wrapper.replaceAll("'", "''")}' -ConfigureFromClipboard -Destination ${destination}`
        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
          encoding: 'utf8', env: { ...process.env, LOCALAPPDATA: directory }, timeout: 15000,
        })
        assert.equal(result.status, 0, result.stderr)
        const path = join(directory, 'IntrepidRaidDesk', 'Discord', 'webhook.xml')
        if (destination === 'backlog') {
          const { copyFile } = await import('node:fs/promises')
          await copyFile(path, join(directory, 'original.xml'))
        } else {
          assert.equal(await readFile(path, 'utf8'), await readFile(join(directory, 'original.xml'), 'utf8'))
          assert.ok((await readFile(join(directory, 'IntrepidRaidDesk', 'Discord', 'webhook-patch-notes.xml'))).length > 0)
        }
      }
      const command = `
        function node {
          if (-not $env:INTREPID_DISCORD_WEBHOOK -or -not $env:INTREPID_DISCORD_PATCH_NOTES_WEBHOOK) { throw 'Missing credential transfer' }
          Write-Output 'Both configured destinations reached the mock child.'
          throw 'Simulated child failure'
        }
        try { & '${wrapper.replaceAll("'", "''")}' -Release '2026-10-16 - bbefbc2' -Publish }
        catch {
          if ($_.Exception.Message -ne 'Simulated child failure') { throw }
          if ((Test-Path Env:\\INTREPID_DISCORD_WEBHOOK) -or (Test-Path Env:\\INTREPID_DISCORD_PATCH_NOTES_WEBHOOK)) { throw 'Credential environment was not cleared' }
          Write-Output 'Both environment variables cleared.'
        }
      `
      const cleanup = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8', env: { ...process.env, LOCALAPPDATA: directory }, timeout: 15000,
      })
      assert.equal(cleanup.status, 0, cleanup.stderr)
      assert.match(cleanup.stdout, /Both configured destinations reached the mock child/)
      assert.match(cleanup.stdout, /Both environment variables cleared/)
      assert.ok(!cleanup.stdout.includes('invented-token'))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
