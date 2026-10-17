import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { encounterOptions, groupPriorities, matchesEncounterScope, splitEncounter } from '../../src/features/loot/groupPriorities.ts'

// Invented dungeons, bosses and items.
const p = (id: string, encounter: string) => ({ id, encounter })
// Like the real lookup (bossOrder.ts), it ignores case and extra spaces in the dungeon name.
const order: Record<string, string[]> = { 'test hall': ['Hall Warden', 'Cave Queen', 'Old Mossback'] }
const bossOrder = (dungeon: string) => order[dungeon.trim().replace(/\s+/g, ' ').toLowerCase()] ?? []
const shape = (groups: ReturnType<typeof groupPriorities<{ id: string; encounter: string }>>) =>
  groups.map((group) => [group.dungeon, group.bosses.map((boss) => [boss.boss, boss.priorities.map((priority) => priority.id)])])

describe('splitEncounter', () => {
  it('splits the dungeon from the boss at the middle dot', () => {
    assert.deepEqual(splitEncounter('Test Hall \u00b7 Hall Warden'), { dungeon: 'Test Hall', boss: 'Hall Warden' })
    assert.deepEqual(splitEncounter('  Test Hall\u00b7Hall Warden  '), { dungeon: 'Test Hall', boss: 'Hall Warden' })
  })
  it('keeps a later dot as part of the boss', () => assert.deepEqual(splitEncounter('Test Hall \u00b7 Warden \u00b7 Second'), { dungeon: 'Test Hall', boss: 'Warden \u00b7 Second' }))
  it('gives a text with no dot no dungeon', () => {
    assert.deepEqual(splitEncounter('Hall Warden'), { dungeon: '', boss: 'Hall Warden' })
    assert.deepEqual(splitEncounter(''), { dungeon: '', boss: '' })
  })
})

describe('groupPriorities', () => {
  it('groups by dungeon and then by boss, and keeps the order inside a boss', () => {
    const groups = groupPriorities([p('a', 'Test Hall \u00b7 Hall Warden'), p('b', 'Test Hall \u00b7 Hall Warden'), p('c', 'Test Hall \u00b7 Cave Queen')], bossOrder)
    assert.deepEqual(shape(groups), [['Test Hall', [['Hall Warden', ['a', 'b']], ['Cave Queen', ['c']]]]])
    assert.equal(groups[0].count, 3)
  })
  it('orders the bosses of a dungeon as its drop list does, not as they were added', () => {
    const groups = groupPriorities([p('a', 'Test Hall \u00b7 Old Mossback'), p('b', 'Test Hall \u00b7 Hall Warden'), p('c', 'Test Hall \u00b7 Cave Queen')], bossOrder)
    assert.deepEqual(groups[0].bosses.map((boss) => boss.boss), ['Hall Warden', 'Cave Queen', 'Old Mossback'])
  })
  it('puts a boss the order does not know after the known ones, in the order they first appear, and "any creature" last', () => {
    const groups = groupPriorities([p('a', 'Test Hall \u00b7 any creature'), p('b', 'Test Hall \u00b7 Zed'), p('c', 'Test Hall \u00b7 Hall Warden'), p('d', 'Test Hall \u00b7 Abe')], bossOrder)
    assert.deepEqual(groups[0].bosses.map((boss) => boss.boss), ['Hall Warden', 'Zed', 'Abe', 'any creature'])
  })
  it('matches names ignoring case and extra spaces', () => {
    const groups = groupPriorities([p('a', 'test  hall \u00b7 cave queen'), p('b', 'Test Hall \u00b7 HALL WARDEN')], bossOrder)
    assert.equal(groups.length, 1)
    assert.deepEqual(groups[0].bosses.map((boss) => boss.priorities[0].id), ['b', 'a'])
  })
  it('lists dungeons by name, with priorities that have no dungeon in a last group', () => {
    const groups = groupPriorities([p('a', 'Boss only'), p('b', 'Zed Keep \u00b7 X'), p('c', 'Alpha Caves \u00b7 Y')])
    assert.deepEqual(groups.map((group) => group.dungeon), ['Alpha Caves', 'Zed Keep', ''])
  })
  it('puts a priority with no encounter text in the group with no dungeon', () => {
    const groups = groupPriorities([p('a', '')])
    assert.deepEqual(shape(groups), [['', [['', ['a']]]]])
  })
  it('uses an empty order for a dungeon the lookup does not know', () => {
    const groups = groupPriorities([p('a', 'Unknown \u00b7 B'), p('b', 'Unknown \u00b7 A')], bossOrder)
    assert.deepEqual(groups[0].bosses.map((boss) => boss.boss), ['B', 'A'])
  })
  it('returns nothing for no priorities, and does not change its input', () => {
    assert.deepEqual(groupPriorities([], bossOrder), [])
    const input = [p('a', 'Test Hall \u00b7 Old Mossback'), p('b', 'Test Hall \u00b7 Hall Warden')]
    const before = JSON.stringify(input)
    groupPriorities(input, bossOrder)
    assert.equal(JSON.stringify(input), before)
  })
  it('counts every priority exactly once', () => {
    const input = [p('a', 'Test Hall \u00b7 Hall Warden'), p('b', 'Other \u00b7 Z'), p('c', 'x'), p('d', 'Test Hall \u00b7 any creature')]
    const groups = groupPriorities(input, bossOrder)
    const ids = groups.flatMap((group) => group.bosses.flatMap((boss) => boss.priorities.map((priority) => priority.id))).sort()
    assert.deepEqual(ids, ['a', 'b', 'c', 'd'])
    assert.equal(groups.reduce((total, group) => total + group.count, 0), 4)
  })
})

describe('encounterOptions', () => {
  const list = [p('a', 'Test Hall \u00b7 Old Mossback'), p('b', 'Test Hall \u00b7 Hall Warden'), p('c', 'Alpha Caves \u00b7 Digger'), p('d', 'Boss only'), p('e', 'Test Hall \u00b7 Hall Warden')]
  it('lists each dungeon, then its bosses below it, in the order the list is grouped', () => {
    assert.deepEqual(encounterOptions(list, bossOrder).map((option) => [option.level, option.label]), [
      [0, 'Alpha Caves'], [1, 'Digger'], [0, 'Test Hall'], [1, 'Hall Warden'], [1, 'Old Mossback'], [0, 'Other priorities'], [1, 'Boss only'],
    ])
  })
  it('lists each boss once, however many priorities it has', () => assert.equal(encounterOptions(list, bossOrder).filter((option) => option.label === 'Hall Warden').length, 1))
  it('offers nothing for no priorities', () => assert.deepEqual(encounterOptions([], bossOrder), []))
  it('gives every choice a value that selects exactly its own priorities', () => {
    for (const option of encounterOptions(list, bossOrder)) {
      const found = list.filter((priority) => matchesEncounterScope(priority.encounter, option.value))
      assert.ok(found.length > 0, option.label)
      if (option.level === 1) assert.ok(found.every((priority) => splitEncounter(priority.encounter).boss === option.label || option.label === 'No encounter noted'))
    }
  })
})

describe('matchesEncounterScope', () => {
  const options = encounterOptions([p('a', 'Alpha Caves \u00b7 Digger'), p('b', 'Test Hall \u00b7 Hall Warden'), p('c', 'Boss only')], bossOrder)
  const scope = (label: string) => (options.find((option) => option.label === label) as { value: string }).value
  const alpha = scope('Alpha Caves')
  const hall = scope('Test Hall')
  const hallBoss = scope('Hall Warden')
  const other = scope('Other priorities')
  it('matches everything for an empty scope', () => {
    assert.equal(matchesEncounterScope('Test Hall \u00b7 Hall Warden', ''), true)
    assert.equal(matchesEncounterScope('', ''), true)
  })
  it('matches a whole dungeon, ignoring case and extra spaces, and nothing outside it', () => {
    assert.equal(matchesEncounterScope('test  hall \u00b7 anyone', hall), true)
    assert.equal(matchesEncounterScope('Test Hall \u00b7 Hall Warden', alpha), false)
  })
  it('matches one boss only', () => {
    assert.equal(matchesEncounterScope('Test Hall \u00b7 hall   warden', hallBoss), true)
    assert.equal(matchesEncounterScope('Test Hall \u00b7 Old Mossback', hallBoss), false)
    assert.equal(matchesEncounterScope('Other Hall \u00b7 Hall Warden', hallBoss), false)
  })
  it('matches the priorities that have no dungeon through "Other priorities"', () => {
    assert.equal(matchesEncounterScope('Boss only', other), true)
    assert.equal(matchesEncounterScope('Test Hall \u00b7 Hall Warden', 'd:'), false)
  })
  it('matches nothing for a scope it does not understand', () => assert.equal(matchesEncounterScope('Test Hall \u00b7 Hall Warden', 'x:whatever'), false))
})
