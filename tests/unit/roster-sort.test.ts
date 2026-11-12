import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sortRoster } from '../../src/features/roster/sort.ts'
import { groupAlts } from '../../src/features/roster/filter.ts'

// Every name here is invented: this repository is public.
const roster = [
  { id: 'p1', name: 'Rorik', className: 'Warrior', role: 'Tank' },
  { id: 'p2', name: 'Isolde', className: 'Paladin', role: 'Healer' },
  { id: 'p3', name: 'tamsin', className: 'Hunter', role: 'Ranged' },
  { id: 'p4', name: 'Corvin', className: 'Rogue', role: 'Melee' },
  { id: 'p5', name: 'Maelis', className: 'Priest', role: 'Healer' },
  { id: 'p6', name: 'Brannoc', className: 'Shaman', role: 'Ranged' },
]
const teams: Record<string, string> = { p1: 'yellow', p2: 'blue', p4: 'blue', p5: 'red' }
const teamOrder = ['blue', 'yellow', 'red', 'white']
const sort = (key: Parameters<typeof sortRoster>[1], direction: 'asc' | 'desc' = 'asc', players = roster) =>
  sortRoster(players, key, direction, (id) => teams[id], teamOrder).map((player) => player.name)

describe('sortRoster', () => {
  it('leaves the list as it is for the default order, and never changes its input', () => {
    const before = roster.map((player) => player.id)
    assert.equal(sortRoster(roster, 'default', 'desc', (id) => teams[id], teamOrder), roster)
    sort('name')
    assert.deepEqual(roster.map((player) => player.id), before)
  })

  it('sorts by name, ignoring case, in both directions', () => {
    assert.deepEqual(sort('name'), ['Brannoc', 'Corvin', 'Isolde', 'Maelis', 'Rorik', 'tamsin'])
    assert.deepEqual(sort('name', 'desc'), ['tamsin', 'Rorik', 'Maelis', 'Isolde', 'Corvin', 'Brannoc'])
  })

  it('sorts by class, breaking ties by name', () => {
    assert.deepEqual(sort('class'), ['tamsin', 'Isolde', 'Maelis', 'Corvin', 'Brannoc', 'Rorik'])
    const twins = [{ id: 'a', name: 'Zed', className: 'Mage', role: 'Ranged' }, { id: 'b', name: 'Abe', className: 'Mage', role: 'Ranged' }]
    assert.deepEqual(sort('class', 'desc', twins), ['Abe', 'Zed'])
  })

  it('sorts roles alphabetically in both directions', () => {
    assert.deepEqual(sort('role'), ['Isolde', 'Maelis', 'Corvin', 'Brannoc', 'tamsin', 'Rorik'])
    assert.deepEqual(sort('role', 'desc'), ['Rorik', 'Brannoc', 'tamsin', 'Corvin', 'Isolde', 'Maelis'])
  })

  it('sorts teams alphabetically with unassigned characters last in both directions', () => {
    assert.deepEqual(sort('team'), ['Corvin', 'Isolde', 'Maelis', 'Rorik', 'Brannoc', 'tamsin'])
    assert.deepEqual(sort('team', 'desc'), ['Rorik', 'Maelis', 'Corvin', 'Isolde', 'Brannoc', 'tamsin'])
  })

  it('sorts a team the roster does not know about with the unassigned, after every known team', () => {
    const order = sortRoster(roster, 'team', 'asc', (id) => (id === 'p1' ? 'purple' : teams[id]), teamOrder).map((player) => player.name)
    assert.deepEqual(order, ['Corvin', 'Isolde', 'Maelis', 'Brannoc', 'Rorik', 'tamsin'])
  })

  it('breaks a tie on name by surname, and a tie on both by id, whatever the input order', () => {
    const bySurname = [{ id: 'a', name: 'Ann', surname: 'Wood', className: 'Mage', role: 'Ranged' }, { id: 'b', name: 'Ann', surname: 'Ash', className: 'Mage', role: 'Ranged' }]
    assert.deepEqual(sortRoster(bySurname, 'name', 'asc', () => undefined, teamOrder).map((player) => player.id), ['b', 'a'])
    assert.deepEqual(sortRoster(bySurname, 'name', 'desc', () => undefined, teamOrder).map((player) => player.id), ['a', 'b'])
    const byId = [{ id: 'z', name: 'Ann', surname: 'Ash', className: 'Mage', role: 'Ranged' }, { id: 'y', name: 'Ann', surname: 'Ash', className: 'Mage', role: 'Ranged' }]
    assert.deepEqual(sortRoster(byId, 'name', 'asc', () => undefined, teamOrder).map((player) => player.id), ['y', 'z'])
  })

  it('sorts supplied displayed values, leaving missing values last in either direction', () => {
    const values: Record<string, string> = { p1: 'Raider', p2: 'Casual', p3: 'Raider' }
    const byValue = (direction: 'asc' | 'desc') => sortRoster(roster, 'raiderType', direction, () => undefined, [], (player) => values[player.id]).map((player) => player.name)
    assert.deepEqual(byValue('asc'), ['Isolde', 'Rorik', 'tamsin', 'Brannoc', 'Corvin', 'Maelis'])
    assert.deepEqual(byValue('desc'), ['Rorik', 'tamsin', 'Isolde', 'Brannoc', 'Corvin', 'Maelis'])
  })

  it('sorts specialization and access using the displayed values', () => {
    const players = [
      { ...roster[0], specialization: 'Protection', linkedUid: 'one' },
      { ...roster[1], specialization: 'Holy' },
      { ...roster[2], specialization: '' },
    ]
    assert.deepEqual(sortRoster(players, 'specialization', 'asc', () => undefined, []).map((p) => p.name), ['Isolde', 'Rorik', 'tamsin'])
    assert.deepEqual(sortRoster(players, 'access', 'desc', () => undefined, []).map((p) => p.name), ['Isolde', 'tamsin', 'Rorik'])
  })

  it('keeps alts directly under their main when sorting by a different class', () => {
    const players = [
      { id: 'm1', name: 'Aldric', className: 'Warrior', role: 'Tank' },
      { id: 'a1', name: 'Elowen', className: 'Mage', role: 'Ranged', mainId: 'm1' },
      { id: 'm2', name: 'Bryn', className: 'Priest', role: 'Healer' },
    ]
    for (const direction of ['asc', 'desc'] as const) {
      const sorted = sortRoster(players, 'class', direction, () => undefined, [])
      const rows = groupAlts(sorted, players, new Set()).rows
      const mainIndex = rows.findIndex((row) => row.player.id === 'm1')
      assert.equal(rows[mainIndex + 1].player.id, 'a1')
      assert.equal(rows[mainIndex + 1].isAlt, true)
    }
  })
})
