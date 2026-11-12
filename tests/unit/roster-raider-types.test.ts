import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeRosterRaiderType, raiderTypeLabel, raiderTypeOwner } from '../../src/features/roster/raiderTypes.ts'
import type { PlayerRecord } from '../../src/shared/game/players.ts'

const main: PlayerRecord = { id: 'main', name: 'Aldric', className: 'Warrior', specialization: 'Arms', role: 'Melee', linkedUid: 'member-a' }
const alt: PlayerRecord = { id: 'alt', name: 'Elowen', className: 'Mage', specialization: 'Frost', role: 'Ranged', mainId: 'main' }
const roster = new Map([main, alt].map((player) => [player.id, player]))

describe('roster raider types', () => {
  it('accepts only a valid selection for the matching document owner', () => {
    assert.deepEqual(normalizeRosterRaiderType('member-a', { userId: 'member-a', type: 'casual' }), { id: 'member-a', type: 'casual' })
    assert.deepEqual(normalizeRosterRaiderType('member-a', { userId: 'member-a', type: 'hardcore' }), { id: 'member-a', type: 'hardcore' })
    assert.equal(normalizeRosterRaiderType('member-a', { userId: 'member-b', type: 'casual' }), null)
    assert.equal(normalizeRosterRaiderType('member-a', { userId: 'member-a', type: 'unknown' }), null)
  })

  it('uses the linked main account for alts even if the main is not in the visible rows', () => {
    assert.equal(raiderTypeOwner(main, roster), 'member-a')
    assert.equal(raiderTypeOwner(alt, roster), 'member-a')
    assert.equal(raiderTypeOwner({ ...main, linkedUid: undefined }, roster), undefined)
    assert.equal(raiderTypeOwner(alt, new Map()), undefined)
    assert.equal(raiderTypeOwner({ ...alt, mainId: 'alt' }, roster), undefined)
    assert.equal(raiderTypeOwner({ ...alt, mainId: 'alt' }, new Map([['alt', alt]])), undefined)
    assert.equal(raiderTypeOwner({ ...main, mainId: 'alt' }, roster), undefined)
  })

  it('shows the member-facing names without treating an unset choice as Casual', () => {
    assert.equal(raiderTypeLabel('casual'), 'Casual')
    assert.equal(raiderTypeLabel('hardcore'), 'Raider')
    assert.equal(raiderTypeLabel(undefined), 'Not set')
  })
})
