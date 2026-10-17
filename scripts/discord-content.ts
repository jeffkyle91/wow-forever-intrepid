import { createHash } from 'node:crypto'

export type Post = { key: string; content: string }
export class ContentError extends Error {}
export type BacklogItem = {
  id: string
  title: string
  status: 'planned' | 'in-progress' | 'awaiting-deployment' | 'released' | 'cancelled'
  priority: 'critical' | 'high' | 'normal'
  target: string | null
  commitment: 'required' | 'target' | 'external-dependency'
  dependsOn: string[]
  prs: number[]
  release: string | null
  notes: string
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())

export function parseBacklog(input: unknown, changelog: string): BacklogItem[] {
  if (!record(input) || input.schemaVersion !== 1 || !Array.isArray(input.items)) throw new ContentError('Invalid backlog schema.')
  const items: BacklogItem[] = []
  for (const item of input.items) {
    if (!record(item) || !text(item.id) || !/^[A-Z]+-\d{3}$/.test(item.id) || !text(item.title)
      || !['planned', 'in-progress', 'awaiting-deployment', 'released', 'cancelled'].includes(String(item.status))
      || !['critical', 'high', 'normal'].includes(String(item.priority))
      || !['required', 'target', 'external-dependency'].includes(String(item.commitment))
      || !(item.target === null || (text(item.target) && /^\d{4}-\d{2}-\d{2}$/.test(item.target)
        && !Number.isNaN(Date.parse(item.target)) && new Date(item.target).toISOString().slice(0, 10) === item.target))
      || !Array.isArray(item.dependsOn) || !item.dependsOn.every(text)
      || !Array.isArray(item.prs) || !item.prs.every((pr) => Number.isInteger(pr) && pr > 0)
      || typeof item.notes !== 'string'
      || !(item.release === null || text(item.release))) throw new ContentError('Invalid backlog item fields.')
    items.push(item as BacklogItem)
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  if (byId.size !== items.length) throw new ContentError('Duplicate backlog IDs.')
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(id: string) {
    if (visiting.has(id)) throw new ContentError('Backlog dependencies contain a cycle.')
    if (visited.has(id)) return
    const item = byId.get(id)
    if (!item) throw new ContentError('Unknown backlog dependency.')
    visiting.add(id)
    for (const dependency of item.dependsOn) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const item of items) {
    visit(item.id)
    if (item.status === 'released') {
      if (!item.release) throw new ContentError('Released items require a changelog release.')
      releaseSection(changelog, item.release)
    } else if (item.release !== null) throw new ContentError('Unreleased items cannot have a release reference.')
  }
  return items
}

export function releaseSection(changelog: string, heading: string): string {
  const date = heading.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2} - [a-f0-9]{7,40}$/.test(heading)
    || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new ContentError('Select an exact dated commit release heading, not Unreleased.')
  }
  const sections = changelog.replace(/\r\n/g, '\n').split(/^## /m).slice(1)
  const matches = sections.filter((section) => section.split('\n')[0].trim() === heading)
  if (matches.length !== 1) throw new ContentError('Release heading must exist exactly once in the changelog.')
  const newline = matches[0].indexOf('\n')
  const body = newline === -1 ? '' : matches[0].slice(newline + 1).trim()
  if (!body) throw new ContentError('Release notes must not be empty.')
  return body
}

function paginate(prefix: string, title: string, blocks: string[]): Post[] {
  const posts: Post[] = []
  let content = `**${title}**`
  for (const block of blocks) {
    if (content.length + block.length + 2 > 2000) {
      if (content === `**${title}**`) throw new ContentError('A content block exceeds Discord limits; shorten or split it in the source file.')
      posts.push({ key: `${prefix}-${posts.length + 1}`, content })
      content = `**${title} (continued)**`
    }
    content += `\n\n${block}`
    if (content.length > 2000) throw new ContentError('A content block exceeds Discord limits; shorten or split it in the source file.')
  }
  posts.push({ key: `${prefix}-${posts.length + 1}`, content })
  return posts
}

export function renderBacklog(items: BacklogItem[]): Post[] {
  const active = items.filter((item) => !['released', 'cancelled'].includes(item.status))
  const groups = [...new Set(active.map((item) => item.id.split('-')[0]))].sort()
  return groups.length ? groups.flatMap((group) => paginate(`backlog-${group.toLowerCase()}`, `Intrepid backlog - ${group}`,
    active.filter((item) => item.id.startsWith(`${group}-`)).map((item) =>
      `**${item.id}: ${item.title}**\n${item.status} | ${item.priority} | ${item.target ?? 'Unscheduled'} (${item.commitment})${item.dependsOn.length ? `\nNeeds: ${item.dependsOn.join(', ')}` : ''}${item.notes ? `\n${item.notes}` : ''}`)))
    : [{ key: 'backlog-empty-1', content: '**Intrepid backlog**\n\nNo active backlog items.' }]
}

export function renderRelease(changelog: string, heading: string): Post[] {
  const prefix = `release-${createHash('sha256').update(heading).digest('hex').slice(0, 24)}`
  return paginate(prefix, `Intrepid patch notes - ${heading}`, releaseSection(changelog, heading).split(/\n\s*\n/))
}

export function retirePages(posts: Post[], tracked: string[], prefix: string): Post[] {
  const current = new Set(posts.map((post) => post.key))
  return [...posts, ...tracked.filter((key) => key.startsWith(prefix) && !current.has(key)).map((key) => ({
    key, content: '**Archived page**\n\nThis page has been superseded. See the current messages for the active backlog or corrected release notes.',
  }))]
}
