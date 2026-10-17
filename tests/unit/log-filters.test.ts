import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { logFacts, logFilterActive, logPlayers, matchesLogFilter, noLogFilter, type LogFacts } from '../../src/features/loot/logFilters.ts'

// Invented names.
const priorities = [
  { id: 'p1', item: 'Iron Ring', encounter: 'Test Hall \u00b7 Warden', rankedPlayers: ['Aria', 'Brock'], itemId: 101 },
  { id: 'p2', item: 'Old Cloak', encounter: 'Cave \u00b7 Queen', rankedPlayers: ['Cleo'] },
]
const byId = (id: string) => priorities.find((priority) => priority.id === id)
const entry = (overrides: Record<string, unknown>) => ({ targetType: 'priority', targetId: 'p1', item: 'Iron Ring', before: {}, after: {}, ...overrides }) as Parameters<typeof logFacts>[0]
const slotOf = (item: { item: string; itemId?: number }) => (item.itemId === 101 ? 'Finger' : item.itemId === undefined ? 'Other' : undefined)

describe('logFacts', () => {
  it('takes what the entry lists, and the rest from the priority as it stands', () => {
    const facts = logFacts(entry({ after: { councilNote: 'x' } }), byId)
    assert.deepEqual(facts, { about: 'item', item: 'Iron Ring', itemId: 101, encounter: 'Test Hall \u00b7 Warden', players: ['Aria', 'Brock'] })
  })
  it('prefers what the entry says, and knows the players an edit added or took off', () => {
    const facts = logFacts(entry({ before: { rankedPlayers: ['Aria', 'Dax'], encounter: 'Old Hall \u00b7 Boss' }, after: { rankedPlayers: ['Aria', 'Brock'], encounter: 'Test Hall \u00b7 Warden' } }), byId)
    assert.equal(facts.encounter, 'Test Hall \u00b7 Warden')
    assert.deepEqual([...facts.players].sort(), ['Aria', 'Brock', 'Dax'])
  })
  it('works for a priority that no longer exists, from the entry alone', () => {
    const facts = logFacts(entry({ targetId: 'gone', item: 'Lost Hat', action: 'delete', before: { encounter: 'Cave \u00b7 Queen', rankedPlayers: ['Cleo'], itemId: 7 } }), byId)
    assert.deepEqual(facts, { about: 'item', item: 'Lost Hat', itemId: 7, encounter: 'Cave \u00b7 Queen', players: ['Cleo'] })
  })
  it('reads an award as its recipient and the candidates it was decided among, and finds its item through the priority', () => {
    const facts = logFacts(entry({ targetType: 'award', targetId: 'a1', after: { priorityId: 'p1', recipient: 'Brock', prioritySnapshot: ['Aria', 'Brock'], encounter: 'Test Hall \u00b7 Warden' } }), byId)
    assert.deepEqual(facts.players, ['Brock', 'Aria'])
    assert.equal(facts.itemId, 101)
  })
  it('has nothing to say about an item for a phase entry, and never throws on odd values', () => {
    assert.equal(logFacts(entry({ targetType: 'phase', targetId: 'settings' }), byId).about, 'phase')
    assert.deepEqual(logFacts(entry({ targetId: 'p2', after: { rankedPlayers: 'Cleo', itemId: 'x', encounter: 5 } }), byId).players, ['Cleo'])
  })
})

describe('matchesLogFilter', () => {
  const facts: LogFacts = { about: 'item', item: 'Iron Ring', itemId: 101, encounter: 'Test Hall \u00b7 Warden', players: ['Aria', 'Brock'] }
  it('lets everything through when no dropdown is set, a phase entry included', () => {
    assert.ok(matchesLogFilter(facts, noLogFilter, slotOf))
    assert.ok(matchesLogFilter({ about: 'phase', item: '', encounter: '', players: [] }, noLogFilter, slotOf))
  })
  it('filters by player, ignoring case and spacing', () => {
    assert.ok(matchesLogFilter(facts, { ...noLogFilter, player: ' aria ' }, slotOf))
    assert.equal(matchesLogFilter(facts, { ...noLogFilter, player: 'Cleo' }, slotOf), false)
  })
  it('filters by slot, and an item whose slot is not known yet matches none', () => {
    assert.ok(matchesLogFilter(facts, { ...noLogFilter, slot: 'Finger' }, slotOf))
    assert.equal(matchesLogFilter(facts, { ...noLogFilter, slot: 'Head' }, slotOf), false)
    assert.equal(matchesLogFilter({ ...facts, itemId: 5 }, { ...noLogFilter, slot: 'Other' }, slotOf), false)
  })
  it('filters by dungeon or boss', () => {
    assert.ok(matchesLogFilter(facts, { ...noLogFilter, encounter: 'd:test hall' }, slotOf))
    assert.ok(matchesLogFilter(facts, { ...noLogFilter, encounter: 'b:test hall|warden' }, slotOf))
    assert.equal(matchesLogFilter(facts, { ...noLogFilter, encounter: 'b:test hall|queen' }, slotOf), false)
    assert.equal(matchesLogFilter({ ...facts, encounter: '' }, { ...noLogFilter, encounter: 'd:test hall' }, slotOf), false)
  })
  it('needs every dropdown that is set to match, and hides a phase entry as soon as one is set', () => {
    assert.ok(matchesLogFilter(facts, { player: 'Brock', slot: 'Finger', encounter: 'd:test hall' }, slotOf))
    assert.equal(matchesLogFilter(facts, { player: 'Brock', slot: 'Head', encounter: 'd:test hall' }, slotOf), false)
    assert.equal(matchesLogFilter({ about: 'phase', item: '', encounter: '', players: [] }, { ...noLogFilter, player: 'Aria' }, slotOf), false)
  })
  it('knows whether any dropdown is set', () => {
    assert.equal(logFilterActive(noLogFilter), false)
    assert.ok(logFilterActive({ ...noLogFilter, slot: 'Head' }))
  })
})

describe('logPlayers', () => {
  it('lists each player once, alphabetically, and keeps the current choice', () => {
    const all: LogFacts[] = [
      { about: 'item', item: 'A', encounter: '', players: ['Brock', 'aria'] },
      { about: 'item', item: 'B', encounter: '', players: ['Aria', ' Cleo '] },
    ]
    assert.deepEqual(logPlayers(all, ''), ['aria', 'Brock', 'Cleo'])
    assert.deepEqual(logPlayers(all, 'Dax'), ['aria', 'Brock', 'Cleo', 'Dax'])
  })
})
