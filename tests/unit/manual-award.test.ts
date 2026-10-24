import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isRealDate, manualAward, MANUAL_ENCOUNTER_MAX, MANUAL_ITEM_MAX, MANUAL_NOTE_MAX, possibleDuplicate, type ManualAwardForm } from '../../src/features/loot/manualAward.ts'
import { awardCreateFields, describeCreate, manualAwardCreateFields } from '../../src/shared/game/lootAudit.ts'

// Invented names.
const roster = new Map([['p-1', { id: 'p-1', name: 'Aria' }], ['p-2', { id: 'p-2', name: 'Brock' }]])
const who = { player: (id: string) => roster.get(id) }
const form = (overrides: Partial<ManualAwardForm> = {}): ManualAwardForm => ({ item: 'Test Sword', encounter: 'Test Hall', recipientId: 'p-1', awardedAt: '2026-12-09', decision: 'roll', awardNote: '', ...overrides })

describe('the manual award a form describes', () => {
  it('is a complete award: the item, the roster character with the name the roster has, the raid date, how it was decided and the phase', () => {
    assert.deepEqual(manualAward(form(), who, 3), { award: { item: 'Test Sword', encounter: 'Test Hall', recipient: 'Aria', recipientId: 'p-1', awardedAt: '2026-12-09', awardNote: '', decision: 'roll', phaseNo: 3 } })
  })
  it('trims what was typed, and keeps an empty boss and an empty note as empty text (the rules want every field)', () => {
    const { award } = manualAward(form({ item: '  Test Sword ', encounter: '  ', awardNote: ' both rolled ' }), who, 0)
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
  it('refuses what the rules would: an item, boss or note over its length', () => {
    assert.ok(manualAward(form({ item: 'x'.repeat(MANUAL_ITEM_MAX + 1) }), who, 0).problem)
    assert.ok(manualAward(form({ encounter: 'x'.repeat(MANUAL_ENCOUNTER_MAX + 1) }), who, 0).problem)
    assert.ok(manualAward(form({ awardNote: 'x'.repeat(MANUAL_NOTE_MAX + 1) }), who, 0).problem)
    assert.ok(manualAward(form({ item: 'x'.repeat(MANUAL_ITEM_MAX) }), who, 0).award)
  })
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
