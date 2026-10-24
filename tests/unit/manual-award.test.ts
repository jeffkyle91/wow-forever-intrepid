import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { encounterLabel } from '../../src/shared/game/encounter.ts'
import { matchesEncounterScope, splitEncounter } from '../../src/features/loot/groupPriorities.ts'
import { bossChoices, dungeonChoices, encounterOf, isRealDate, manualAward, MANUAL_ENCOUNTER_MAX, MANUAL_ITEM_MAX, MANUAL_NOTE_MAX, possibleDuplicate, type ManualAwardForm } from '../../src/features/loot/manualAward.ts'
import { awardCreateFields, describeCreate, manualAwardCreateFields } from '../../src/shared/game/lootAudit.ts'

// Invented names.
const roster = new Map([['p-1', { id: 'p-1', name: 'Aria' }], ['p-2', { id: 'p-2', name: 'Brock' }]])
const who = { player: (id: string) => roster.get(id) }
const form = (overrides: Partial<ManualAwardForm> = {}): ManualAwardForm => ({ item: 'Test Sword', dungeon: 'Test Hall', boss: 'Hall Warden', recipientId: 'p-1', awardedAt: '2026-12-09', decision: 'roll', awardNote: '', ...overrides })

describe('the manual award a form describes', () => {
  it('is a complete award: the item, the roster character with the name the roster has, the raid date, how it was decided and the phase', () => {
    assert.deepEqual(manualAward(form(), who, 3), { award: { item: 'Test Sword', encounter: 'Test Hall \u00b7 Hall Warden', recipient: 'Aria', recipientId: 'p-1', awardedAt: '2026-12-09', awardNote: '', decision: 'roll', phaseNo: 3 } })
  })
  it('trims what was typed, and keeps an empty place and an empty note as empty text (the rules want every field)', () => {
    const { award } = manualAward(form({ item: '  Test Sword ', dungeon: '  ', boss: '  ', awardNote: ' both rolled ' }), who, 0)
    assert.equal(award?.item, 'Test Sword')
    assert.equal(award?.encounter, '')
    assert.equal(award?.awardNote, 'both rolled')
  })
  it('is never given a priority, a snapshot or a status: nothing pretends a candidate order existed', () => {
    const { award } = manualAward(form(), who, 0)
    assert.deepEqual(Object.keys(award ?? {}).sort(), [...manualAwardCreateFields].sort())
    assert.deepEqual(['priorityId', 'prioritySnapshot', 'councilNoteSnapshot', 'status'].filter((key) => key in (award ?? {})), [])
  })
  it('takes the name from the roster, never from the form', () => {
    assert.equal(manualAward(form({ recipientId: 'p-2' }), who, 0).award?.recipient, 'Brock')
  })
})

describe('what is not a manual award yet', () => {
  it('says nothing, but offers no award, while a required field has just not been filled in', () => {
    for (const empty of [{ item: '' }, { item: '   ' }, { recipientId: '' }, { decision: '' }, { awardedAt: '' }]) {
      const result = manualAward(form(empty), who, 0)
      assert.equal(result.award, undefined)
      assert.equal(result.missing, true, JSON.stringify(empty))
    }
  })
  it('says what is wrong with what was typed', () => {
    assert.match(manualAward(form({ recipientId: 'p-9' }), who, 0).problem ?? '', /roster/)
    assert.equal(manualAward(form({ recipientId: 'p-9' }), who, 0).missing, undefined)
    assert.match(manualAward(form({ awardedAt: '2026-02-30' }), who, 0).problem ?? '', /raid date/)
    assert.equal(manualAward(form({ awardedAt: '2026-02-30' }), who, 0).missing, undefined)
    assert.match(manualAward(form({ decision: 'dice' }), who, 0).problem ?? '', /decided/)
  })
  it('refuses what the rules would: an item, place or note over its length', () => {
    assert.ok(manualAward(form({ item: 'x'.repeat(MANUAL_ITEM_MAX + 1) }), who, 0).problem)
    assert.ok(manualAward(form({ dungeon: '', boss: 'x'.repeat(MANUAL_ENCOUNTER_MAX + 1) }), who, 0).problem)
    assert.ok(manualAward(form({ dungeon: 'x'.repeat(MANUAL_ENCOUNTER_MAX), boss: 'y' }), who, 0).problem, 'the dungeon, the separator and the boss count together')
    assert.ok(manualAward(form({ dungeon: 'x'.repeat(MANUAL_ENCOUNTER_MAX - 2), boss: '' }), who, 0).award, 'a dungeon and its separator fit exactly')
    assert.ok(manualAward(form({ awardNote: 'x'.repeat(MANUAL_NOTE_MAX + 1) }), who, 0).problem)
    assert.ok(manualAward(form({ item: 'x'.repeat(MANUAL_ITEM_MAX) }), who, 0).award)
  })
})

describe('where a drop is kept', () => {
  it('is the dungeon, a middle dot and the boss, the form a priority is written in', () => {
    assert.equal(encounterOf('Test Hall', 'Hall Warden'), 'Test Hall \u00b7 Hall Warden')
    assert.equal(encounterOf('  Test Hall ', ' Hall Warden  '), 'Test Hall \u00b7 Hall Warden')
  })
  it('keeps a dungeon with no boss as a dungeon, and a boss with no dungeon as typed', () => {
    assert.equal(encounterOf('Test Hall', ''), 'Test Hall \u00b7')
    assert.equal(encounterOf('', 'Hall Warden'), 'Hall Warden')
    assert.equal(encounterOf('', 'Test Hall \u00b7 Hall Warden'), 'Test Hall \u00b7 Hall Warden')
    assert.equal(encounterOf(' ', ' '), '')
  })
  it('is read by the Log as the dungeon and the boss it was picked with: the filters find it', () => {
    assert.deepEqual(splitEncounter(encounterOf('Test Hall', 'Hall Warden')), { dungeon: 'Test Hall', boss: 'Hall Warden' })
    assert.deepEqual(splitEncounter(encounterOf('Test Hall', '')), { dungeon: 'Test Hall', boss: '' })
    assert.ok(matchesEncounterScope(encounterOf('Test Hall', ''), 'd:test hall'), 'a dungeon with no boss is in its dungeon')
    assert.ok(matchesEncounterScope(encounterOf('Test Hall', 'Hall Warden'), 'd:test hall'))
    assert.ok(matchesEncounterScope(encounterOf('Test Hall', 'Hall Warden'), 'b:test hall|hall warden'))
    assert.ok(!matchesEncounterScope(encounterOf('Other Keep', ''), 'd:test hall'))
  })
  it('is read back as the dungeon the person picked, by the text the Log and the dashboard show', () => {
    assert.equal(encounterLabel(encounterOf('Test Hall', '')), 'Test Hall')
    assert.equal(encounterLabel(encounterOf('Test Hall', 'Hall Warden')), 'Test Hall \u00b7 Hall Warden')
    assert.equal(encounterLabel(encounterOf('', 'Hall Warden')), 'Hall Warden')
  })
  it('is why a bare dungeon name is not enough: text with no dot reads as a boss with no dungeon', () => {
    assert.ok(!matchesEncounterScope('Test Hall', 'd:test hall'))
  })
  it('refuses a dungeon whose name has the separator in it, which would split it in two', () => {
    assert.match(manualAward(form({ dungeon: 'Test \u00b7 Hall' }), who, 0).problem ?? '', /cannot contain/)
    assert.ok(manualAward(form({ dungeon: '', boss: 'Test Hall \u00b7 Hall Warden' }), who, 0).award, 'a whole encounter typed as the boss still works')
  })
})

describe('the dungeons and bosses the form offers', () => {
  const zones = [{ name: 'Hall of Tests', kind: 'raid' }, { name: 'Test Hall', kind: 'dungeon' }, { name: 'Archive Keep', kind: 'dungeon' }, { name: 'test  hall', kind: 'dungeon' }]
  it('lists raids, then dungeons, then dungeons only a priority names, each name once and by name', () => {
    assert.deepEqual(dungeonChoices(zones, ['Archive Keep \u00b7 Keeper', 'Lost Cellar \u00b7 Rat King', 'Hall Warden']), { raids: ['Hall of Tests'], dungeons: ['Archive Keep', 'Test Hall'], others: ['Lost Cellar'] })
  })
  it('offers nothing it does not have', () => assert.deepEqual(dungeonChoices([], []), { raids: [], dungeons: [], others: [] }))
  it('puts a name that is both a raid and a dungeon with the raids', () => {
    assert.deepEqual(dungeonChoices([{ name: 'Test Hall', kind: 'dungeon' }, { name: 'Test Hall', kind: 'raid' }], []), { raids: ['Test Hall'], dungeons: [], others: [] })
  })
  it('tidies the spaces of a name, and leaves out one with the separator in it, which could not be stored whole', () => {
    assert.deepEqual(dungeonChoices([{ name: ' Hyjal   Summit ', kind: 'raid' }, { name: 'Spire \u00b7 Lower', kind: 'dungeon' }, { name: 'Test Hall', kind: 'dungeon' }], ['Spire \u00b7 Lower \u00b7 Boss']), { raids: ['Hyjal Summit'], dungeons: ['Test Hall'], others: ['Spire'] }, 'a priority is read as the Log reads it: its dungeon is what comes before the first separator')
  })
  it('keeps a dungeon already picked offered when the lists no longer have it, and does not list it twice when they do', () => {
    assert.deepEqual(dungeonChoices([{ name: 'Test Hall', kind: 'dungeon' }], [], 'Old Name').others, ['Old Name'])
    assert.deepEqual(dungeonChoices([{ name: 'Test Hall', kind: 'dungeon' }], [], 'test hall'), { raids: [], dungeons: ['Test Hall'], others: [] })
    assert.deepEqual(dungeonChoices([], []).others, [])
  })
  it('suggests a dungeon\'s creatures in encounter order, then the bosses a priority names there, and never "any creature"', () => {
    assert.deepEqual(bossChoices('Test Hall', ['Hall Warden', 'any creature', 'Second Boss'], ['test hall \u00b7 Second Boss', 'Test Hall \u00b7 Typed Boss', 'Archive Keep \u00b7 Keeper', 'Test Hall \u00b7 any creature']), ['Hall Warden', 'Second Boss', 'Typed Boss'])
  })
  it('suggests no boss before a dungeon is chosen', () => assert.deepEqual(bossChoices('  ', ['Hall Warden'], ['Test Hall \u00b7 Hall Warden']), []))
})

describe('the date check', () => {
  it('accepts a real day and refuses the rest', () => {
    assert.ok(isRealDate('2026-12-09') && isRealDate('2028-02-29'))
    assert.equal(isRealDate('2026-02-29'), false)
    assert.equal(isRealDate('2026-13-01'), false)
    assert.equal(isRealDate('12/09/2026'), false)
    assert.equal(isRealDate(''), false)
  })
})

describe('what the entry of a manual award lists', () => {
  const award = manualAward(form(), who, 0).award!
  it('lists every field the award has, how it was decided included: the rules want exactly those', () => {
    const entry = describeCreate(award, manualAwardCreateFields)
    assert.deepEqual([...entry.changed].sort(), ['awardNote', 'awardedAt', 'decision', 'encounter', 'item', 'phaseNo', 'recipient', 'recipientId'])
    assert.equal(entry.after.decision, 'roll')
  })
  it('is not what an award from a priority lists, which has no decision', () => {
    assert.equal(describeCreate(award, awardCreateFields).changed.includes('decision'), false)
  })
})

describe('an award that may already be recorded', () => {
  const mine = manualAward(form(), who, 0).award!
  const existing = (overrides: Record<string, unknown> = {}) => ({ id: 'a1', item: 'Test Sword', recipient: 'Aria', recipientId: 'p-1', awardedAt: '2026-12-09', ...overrides })
  it('is found when the same character got the same item on the same day', () => {
    assert.equal(possibleDuplicate(mine, [existing()])?.id, 'a1')
  })
  it('is found for the day before or after (the loot master\'s local date can differ from the raid\'s), and not two days away', () => {
    assert.ok(possibleDuplicate(mine, [existing({ awardedAt: '2026-12-08' })]))
    assert.ok(possibleDuplicate(mine, [existing({ awardedAt: '2026-12-10' })]))
    assert.equal(possibleDuplicate(mine, [existing({ awardedAt: '2026-12-11' })]), undefined)
  })
  it('reads the item without regard to case or spaces, as the priority lists do', () => {
    assert.ok(possibleDuplicate(mine, [existing({ item: '  test SWORD ' })]))
  })
  it('is not found for another character, another item, or an award that was removed', () => {
    assert.equal(possibleDuplicate(mine, [existing({ recipient: 'Brock', recipientId: 'p-2' })]), undefined)
    assert.equal(possibleDuplicate(mine, [existing({ item: 'Test Shield' })]), undefined)
    assert.equal(possibleDuplicate(mine, [existing({ status: 'removed' })]), undefined)
  })
  it('matches an older award that has only a name, by the name, and one with an id by the id (a rename is the same person)', () => {
    assert.ok(possibleDuplicate(mine, [existing({ recipientId: undefined, recipient: ' aria ' })]))
    assert.ok(possibleDuplicate(mine, [existing({ recipient: 'Old Name' })]))
    assert.equal(possibleDuplicate(mine, [existing({ recipientId: 'p-2' })]), undefined)
  })
  it('finds the first match among many, and nothing among none', () => {
    assert.equal(possibleDuplicate(mine, []), undefined)
    assert.equal(possibleDuplicate(mine, [existing({ id: 'x', item: 'Other' }), existing({ id: 'y' })])?.id, 'y')
  })
})
