import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AuditEntry } from '../../src/shared/game/lootAudit.ts'
import { describeEntry, showValue } from '../../src/features/loot/auditText.ts'

// Invented names.
const entry = (overrides: Partial<AuditEntry>): AuditEntry => ({ id: 'x', at: null, by: 'uid', byName: 'A Leader', targetType: 'priority', targetId: 'p1', rev: 1, action: 'edit', item: 'Test Sword', changed: [], before: {}, after: {}, reason: '', ...overrides })
const phaseName = (no: number) => (no === 0 ? 'Launch' : no === 1 ? 'Second' : `Phase ${no}`)
const text = (overrides: Partial<AuditEntry>) => describeEntry(entry(overrides), phaseName)

describe('showValue', () => {
  it('reads a list as names, an empty list as nobody, nothing as none, an empty text as empty', () => {
    assert.equal(showValue('rankedPlayers', ['Aria', 'Brock'], phaseName), 'Aria, Brock')
    assert.equal(showValue('rankedPlayers', [], phaseName), '(nobody)')
    assert.equal(showValue('itemId', null, phaseName), '(none)')
    assert.equal(showValue('councilNote', '  ', phaseName), '(empty)')
  })
  it('names a phase by its number', () => {
    assert.equal(showValue('phaseNo', 1, phaseName), 'Second')
    assert.equal(showValue('itemId', 1, phaseName), '1')
  })
  it('shortens a very long text', () => {
    const shown = showValue('councilNote', 'x'.repeat(500), phaseName)
    assert.equal(shown.length, 160)
    assert.ok(shown.endsWith('\u2026'))
  })
})

describe('describeEntry for a phase', () => {
  const phase = (overrides: Partial<AuditEntry>) => text({ targetType: 'phase', targetId: 'settings', item: 'Second', ...overrides })
  it('says a phase was started, which phase closed and what changed', () => {
    const { title, details } = phase({ action: 'start', changed: ['currentPhase', 'phaseHistory'], before: { currentPhase: 'Launch', phaseHistory: null }, after: { currentPhase: 'Second', phaseHistory: ['Launch'] } })
    assert.equal(title, 'Started \u201cSecond\u201d')
    assert.deepEqual(details, ['\u201cLaunch\u201d is closed and read-only', 'Current phase: Launch \u2192 Second', 'Finished phases: (none) \u2192 Launch'])
  })
  it('says a phase was reopened and which one is the next phase again', () => {
    const { title, details } = phase({ action: 'reopen', item: 'Launch', changed: ['currentPhase', 'nextPhase', 'phaseHistory'], before: { currentPhase: 'Second', nextPhase: 'To be announced', phaseHistory: ['Launch'] }, after: { currentPhase: 'Launch', nextPhase: 'Second', phaseHistory: null } })
    assert.equal(title, 'Reopened \u201cLaunch\u201d')
    assert.equal(details[0], '\u201cSecond\u201d is the next phase again')
    assert.ok(details.includes('Finished phases: Launch \u2192 (none)'))
  })
  it('still reads an entry with nothing in it', () => {
    assert.equal(phase({ action: 'start', after: {} }).title, 'Started \u201cSecond\u201d')
  })
})

describe('describeEntry', () => {
  it('says a priority was added, with the fields it started with', () => {
    const { title, details } = text({ action: 'create', changed: ['item', 'rankedPlayers', 'phaseNo'], after: { item: 'Test Sword', rankedPlayers: [], phaseNo: 1 } })
    assert.equal(title, 'Added \u201cTest Sword\u201d to the list')
    assert.deepEqual(details, ['Item: Test Sword', 'Candidates: (nobody)', 'Phase: Second'])
  })
  it('says a priority was removed, with what it had', () => {
    const { title, details } = text({ action: 'delete', changed: ['rankedPlayers'], before: { rankedPlayers: ['Aria'] } })
    assert.equal(title, 'Removed \u201cTest Sword\u201d from the list')
    assert.deepEqual(details, ['Candidates: Aria'])
  })
  it('shows a reorder as the list before and after', () => {
    const { title, details } = text({ action: 'reorder', changed: ['rankedPlayers'], before: { rankedPlayers: ['Aria', 'Brock'] }, after: { rankedPlayers: ['Brock', 'Aria'] } })
    assert.equal(title, 'Reordered the candidates for \u201cTest Sword\u201d')
    assert.deepEqual(details, ['Before: Aria, Brock', 'After: Brock, Aria'])
  })
  it('shows an edit as each changed field, old value to new value', () => {
    const { title, details } = text({ changed: ['councilNote', 'itemId'], before: { councilNote: '', itemId: null }, after: { councilNote: 'Healer first', itemId: 101 } })
    assert.equal(title, 'Changed \u201cTest Sword\u201d')
    assert.deepEqual(details, ['Council note: (empty) \u2192 Healer first', 'Item id: (none) \u2192 101'])
  })
  it('says who got an award, and what else was recorded with it', () => {
    const { title, details } = text({ targetType: 'award', action: 'create', changed: ['priorityId', 'item', 'recipient', 'awardedAt', 'awardNote', 'phaseNo'], after: { priorityId: 'p1', item: 'Test Sword', recipient: 'Aria', awardedAt: '2026-12-09', awardNote: '', phaseNo: 0 } })
    assert.equal(title, 'Awarded \u201cTest Sword\u201d to Aria')
    assert.deepEqual(details, ['Award date: 2026-12-09', 'Award note: (empty)', 'Phase: Launch'])
  })
  it('says an award was corrected or removed, with the reason', () => {
    assert.deepEqual(text({ targetType: 'award', changed: ['recipient'], before: { recipient: 'Aria' }, after: { recipient: 'Brock' } }), { title: 'Corrected the award of \u201cTest Sword\u201d', details: ['Recipient: Aria \u2192 Brock'] })
    const removed = text({ targetType: 'award', action: 'remove', changed: ['status', 'removedReason'], before: { status: null }, after: { status: 'removed' }, reason: 'Entered twice' })
    assert.equal(removed.title, 'Removed the award of \u201cTest Sword\u201d')
    assert.deepEqual(removed.details, ['Reason: Entered twice'])
  })
  it('does not break on an entry it does not know, or an item with no name', () => {
    assert.equal(text({ targetType: 'raid', action: 'cancel', item: '' }).title, 'cancel raid \u201cUntitled\u201d')
    assert.equal(text({ action: 'create', item: '' }).title, 'Added \u201cUntitled\u201d to the list')
  })
})
