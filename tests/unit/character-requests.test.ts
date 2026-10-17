import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { Timestamp } from 'firebase/firestore'
import { eligibleRequestCharacters, isCharacterRequestKind, normalizeCharacterRequest, requestCharacterName, requestMainName } from '../../src/shared/characters/requests.ts'
import { classSpecializations } from '../../src/shared/game/classes.ts'
import type { PlayerRecord } from '../../src/shared/game/players.ts'

const character = (id: string, fields: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id, name: id, className: 'Warrior', specialization: 'Arms', role: 'Melee', ...fields,
})
const roster = [
  character('main', { linkedUid: 'account' }), character('alt', { mainId: 'main' }),
  character('free'), character('other-main', { linkedUid: 'someone' }),
  character('other-alt', { mainId: 'other-main' }), character('parent'), character('child', { mainId: 'parent' }),
  character('linked-alt', { mainId: 'main', linkedUid: 'someone' }),
]
const raw = {
  userId: 'account', displayName: 'Invented Member', kind: 'rename', characterId: 'main', mainId: 'main',
  before: { name: 'Oldname', surname: '', className: 'Warrior', specialization: 'Arms', role: 'Melee', mainId: null, linkedUid: 'account' },
  proposed: { name: 'Newname', surname: '' }, note: '', status: 'pending', requestedAt: Timestamp.fromMillis(100),
}

describe('character request reading and choices', () => {
  test('eligible owned characters exclude other accounts and linked alts', () => {
    assert.deepEqual(eligibleRequestCharacters(roster, 'account', 'rename').map((entry) => entry.id), ['main', 'alt'])
    assert.deepEqual(eligibleRequestCharacters(roster, 'account', 'promote-main').map((entry) => entry.id), ['alt'])
    assert.deepEqual(eligibleRequestCharacters(roster, 'account', 'link-alt').map((entry) => entry.id), ['free'])
    assert.deepEqual(eligibleRequestCharacters(roster, 'unlinked', 'rename'), [])
  })
  test('unknown and inherited request kind names are not accepted', () => {
    for (const kind of ['__proto__', 'toString', 'role', '']) assert.equal(isCharacterRequestKind(kind), false)
    assert.equal(isCharacterRequestKind('rename'), true)
  })
  test('pending and resolved requests require readable snapshots and provenance', () => {
    assert.deepEqual(normalizeCharacterRequest('request', raw), { ...raw, id: 'request' })
    const approved = { ...raw, status: 'approved', resolvedBy: 'leader', resolvedByName: 'Invented Leader', resolutionNote: '', resolvedAt: Timestamp.fromMillis(200) }
    assert.ok(normalizeCharacterRequest('request', approved))
    for (const fields of [
      { kind: 'unknown' }, { status: 'unknown' }, { requestedAt: 'yesterday' }, { before: null },
      { proposed: { name: 'Newname' } }, { proposed: { name: 'Newname', surname: '', role: 'Tank' } },
      { userId: null }, { status: 'approved' }, { before: { ...raw.before, role: 7 } },
    ]) assert.equal(normalizeCharacterRequest('request', { ...raw, ...fields }), null)
  })
  test('new alt, spec and main-swap shapes are read explicitly', () => {
    for (const fields of [
      { kind: 'create-alt', before: null, proposed: { name: 'Moonfern', surname: '', className: 'Druid', specialization: 'Guardian', role: 'Tank' } },
      { kind: 'change-spec', proposed: { className: 'Druid', specialization: 'Guardian', role: 'Tank' } },
      { kind: 'promote-main', proposed: {} }, { kind: 'link-alt', proposed: {} },
    ]) assert.ok(normalizeCharacterRequest('request', { ...raw, ...fields }))
  })
  test('history uses the submission name rather than current roster name', () => {
    const request = normalizeCharacterRequest('request', raw)!
    assert.equal(requestCharacterName(request), 'Oldname')
    assert.equal(requestCharacterName({ ...request, before: null }), 'Newname')
  })
  test('every request kind is headed by the account main, not the affected alt', () => {
    const request = normalizeCharacterRequest('request', raw)!
    for (const kind of ['create-alt', 'link-alt', 'rename', 'change-spec', 'promote-main'] as const) {
      const change = { ...request, kind, characterId: 'alt', proposed: { name: 'Moonfern' } }
      assert.equal(requestMainName(change, roster), 'main')
      assert.equal(requestCharacterName({ ...change, before: null }), 'Moonfern')
    }
  })
  test('request headings follow renamed or newly promoted mains without rewriting history', () => {
    const request = normalizeCharacterRequest('request', raw)!
    assert.equal(requestMainName(request, [character('main', { linkedUid: 'account', name: 'Sunbloom' })]), 'Sunbloom')
    assert.equal(requestMainName(request, [
      character('main', { mainId: 'alt' }), character('alt', { linkedUid: 'account', name: 'Moonfern' }),
    ]), 'Moonfern')
    assert.equal(request.before?.name, 'Oldname')
  })
  test('unlinked accounts retain a main reference, never falling back to an alt name', () => {
    const request = normalizeCharacterRequest('request', raw)!
    assert.equal(requestMainName(request, [character('main', { name: 'Sunbloom' })]), 'Sunbloom')
    assert.equal(requestMainName(request, []), 'Oldname')
    assert.equal(requestMainName({ ...request, characterId: 'alt' }, []), 'Main character unavailable')
    assert.equal(requestMainName({ ...request, kind: 'create-alt', characterId: 'new-alt', before: null }, []), 'Main character unavailable')
  })
  test('client uses the same Combat, Guardian and Survival defaults as approvals', () => {
    assert.deepEqual(classSpecializations.Rogue.find((spec) => spec.name === 'Combat'), { name: 'Combat', role: 'Melee' })
    assert.deepEqual(classSpecializations.Druid.find((spec) => spec.name === 'Guardian'), { name: 'Guardian', role: 'Tank' })
    assert.deepEqual(classSpecializations.Hunter.find((spec) => spec.name === 'Survival'), { name: 'Survival', role: 'Ranged' })
  })
})
