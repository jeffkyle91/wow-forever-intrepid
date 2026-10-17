import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sortRoster } from '../../src/features/roster/sort.ts'

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

  it('sorts by role in raid order: Tank, Healer, Melee, Ranged', () => {
    assert.deepEqual(sort('role'), ['Rorik', 'Isolde', 'Maelis', 'Corvin', 'Brannoc', 'tamsin'])
    assert.deepEqual(sort('role', 'desc'), ['Brannoc', 'tamsin', 'Corvin', 'Isolde', 'Maelis', 'Rorik'])
  })

  it('sorts by team in team order with characters that have no team last, ties by name', () => {
    assert.deepEqual(sort('team'), ['Corvin', 'Isolde', 'Rorik', 'Maelis', 'Brannoc', 'tamsin'])
    assert.deepEqual(sort('team', 'desc'), ['Brannoc', 'tamsin', 'Maelis', 'Rorik', 'Corvin', 'Isolde'])
  })

  it('sorts a team the roster does not know about with the unassigned, after every known team', () => {
    const order = sortRoster(roster, 'team', 'asc', (id) => (id === 'p1' ? 'purple' : teams[id]), teamOrder).map((player) => player.name)
    assert.deepEqual(order, ['Corvin', 'Isolde', 'Maelis', 'Brannoc', 'Rorik', 'tamsin'])
  })

  it('breaks a tie on name by surname, and a tie on both by id, whatever the input order', () => {
    const bySurname = [{ id: 'a', name: 'Ann', surname: 'Wood', className: 'Mage', role: 'Ranged' }, { id: 'b', name: 'Ann', surname: 'Ash', className: 'Mage', role: 'Ranged' }]
    assert.deepEqual(sortRoster(bySurname, 'name', 'asc', () => undefined, teamOrder).map((player) => player.id), ['b', 'a'])
    const byId = [{ id: 'z', name: 'Ann', surname: 'Ash', className: 'Mage', role: 'Ranged' }, { id: 'y', name: 'Ann', surname: 'Ash', className: 'Mage', role: 'Ranged' }]
    assert.deepEqual(sortRoster(byId, 'name', 'asc', () => undefined, teamOrder).map((player) => player.id), ['y', 'z'])
  })
})
