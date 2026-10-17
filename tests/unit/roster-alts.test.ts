import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterRoster, groupAlts } from '../../src/features/roster/filter.ts'
import { sortRoster } from '../../src/features/roster/sort.ts'

// Every name here is invented: this repository is public.
const player = (id: string, name: string, className: string, mainId?: string) => ({ id, name, className, specialization: 'Any', role: 'Melee', ...(mainId ? { mainId } : {}) })
const aldric = player('a', 'Aldric', 'Warrior')
const brienne = player('b', 'Brienne', 'Priest')
const corvin = player('c', 'Corvin', 'Rogue')
const elowen = player('e', 'Elowen', 'Druid', 'a')
const finn = player('f', 'Finn', 'Mage', 'a')
const garrick = player('g', 'Garrick', 'Hunter', 'b')
const roster = [aldric, brienne, corvin, elowen, finn, garrick]
const layout = (rows: ReturnType<typeof groupAlts>['rows']) => rows.map(({ player, isAlt }) => `${isAlt ? '  ' : ''}${player.name}`)

describe('groupAlts', () => {
  it('puts each alt under its main by default', () => {
    assert.deepEqual(layout(groupAlts(roster, roster, new Set()).rows), ['Aldric', '  Elowen', '  Finn', 'Brienne', '  Garrick', 'Corvin'])
  })

  it('counts every alt of a main, including alts that are not in the visible list', () => {
    const { rows } = groupAlts(roster, roster, new Set())
    assert.deepEqual(rows.filter((row) => !row.isAlt).map((row) => row.altCount), [2, 1, 0])
    for (const keepTogether of [true, false]) {
      const mainsOnly = groupAlts(filterRoster(roster, '', true), roster, new Set(), keepTogether).rows
      assert.deepEqual(mainsOnly.map((row) => row.altCount), [2, 1, 0])
    }
  })

  it('hides the alts of a collapsed main', () => {
    assert.deepEqual(layout(groupAlts(roster, roster, new Set(['a'])).rows), ['Aldric', 'Brienne', '  Garrick', 'Corvin'])
  })

  it('keeps an alt as a normal row when its main is not in the visible list', () => {
    const visible = [elowen, corvin]
    const { rows } = groupAlts(visible, roster, new Set())
    assert.deepEqual(layout(rows), ['Elowen', 'Corvin'])
    assert.equal(rows[0].isAlt, false)
  })

  it('does not nest anyone with keepTogether off: every character is a row, in the order given', () => {
    const order = [elowen, aldric, corvin, garrick, brienne, finn]
    const { rows, mainNames } = groupAlts(order, roster, new Set(), false)
    assert.deepEqual(layout(rows), ['Elowen', 'Aldric', 'Corvin', 'Garrick', 'Brienne', 'Finn'])
    assert.ok(rows.every((row) => !row.isAlt))
    assert.equal(mainNames.get('e'), 'Aldric')
  })

  it('still counts alts with keepTogether off, and ignores the collapsed set', () => {
    const { rows } = groupAlts(roster, roster, new Set(['a']), false)
    assert.equal(rows.length, roster.length)
    assert.equal(rows.find((row) => row.player.id === 'a')?.altCount, 2)
  })

  it('returns the same rows as before when keepTogether is left out', () => {
    assert.deepEqual(groupAlts(roster, roster, new Set()).rows, groupAlts(roster, roster, new Set(), true).rows)
  })

  it('shows a sorted list true to the sort with keepTogether off, and under the mains with it on', () => {
    const byClass = sortRoster(roster, 'class', 'asc', () => undefined, [])
    assert.deepEqual(layout(groupAlts(byClass, roster, new Set(), false).rows), ['Elowen', 'Garrick', 'Finn', 'Brienne', 'Corvin', 'Aldric'])
    assert.deepEqual(layout(groupAlts(byClass, roster, new Set(), true).rows), ['Brienne', '  Garrick', 'Corvin', 'Aldric', '  Elowen', '  Finn'])
  })

  it('ignores a link to a character that does not exist, to itself, or to another alt', () => {
    const odd = [aldric, player('x', 'Xena', 'Mage', 'missing'), player('y', 'Yara', 'Mage', 'y'), player('z', 'Zed', 'Mage', 'e'), elowen]
    assert.deepEqual(layout(groupAlts(odd, odd, new Set()).rows), ['Aldric', '  Elowen', 'Xena', 'Yara', 'Zed'])
  })
})

describe('filterRoster', () => {
  it('drops alts with Hide alts on', () => {
    assert.deepEqual(filterRoster(roster, '', true).map((entry) => entry.name), ['Aldric', 'Brienne', 'Corvin'])
  })

  it('finds a main and its alts when searching for the main by name', () => {
    assert.deepEqual(filterRoster(roster, 'aldric').map((entry) => entry.name), ['Aldric', 'Elowen', 'Finn'])
  })

  it('searches class, specialization and role case-insensitively', () => {
    assert.deepEqual(filterRoster(roster, 'DRUID').map((entry) => entry.name), ['Elowen'])
    assert.equal(filterRoster(roster, 'any').length, roster.length)
  })
})
