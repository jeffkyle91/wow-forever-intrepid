import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PlayerRecord } from '../../src/shared/game/players.ts'
import { assignTeamMember, removeTeamMember } from '../../src/features/teams/assignment.ts'
import { conflictingAssignedCharacter, conflictingTeamGroups, samePlayer } from '../../src/shared/game/teams.ts'

const player = (id: string, name: string, mainId?: string): PlayerRecord => ({
  id, name, mainId, className: 'Mage', specialization: 'Frost', role: 'Ranged',
})
const teamOptions = [{ key: 'blue', name: 'Blue' }, { key: 'red', name: 'Red' }] as const

describe('raid team character relationships', () => {
  it('recognizes a main and direct alt in either direction', () => {
    const roster = [player('morrow', 'Morrow'), player('vex', 'Vex', 'morrow')]
    assert.equal(samePlayer('morrow', 'vex', roster), true)
    assert.equal(samePlayer('vex', 'morrow', roster), true)
  })

  it('recognizes sibling alts but permits alts of different mains', () => {
    const roster = [player('morrow', 'Morrow'), player('vex', 'Vex', 'morrow'), player('lark', 'Lark', 'morrow'), player('tallow', 'Tallow'), player('reed', 'Reed', 'tallow')]
    assert.equal(samePlayer('vex', 'lark', roster), true)
    assert.equal(samePlayer('vex', 'reed', roster), false)
  })

  it('uses stable ids through character renames', () => {
    const roster = [player('morrow', 'Morrow the Returned'), player('vex', 'Vex the Swift', 'morrow')]
    assert.equal(samePlayer('morrow', 'vex', roster), true)
    assert.deepEqual(conflictingTeamGroups('blue', roster, { morrow: 'blue', vex: 'blue' }).map((group) => group.map((entry) => entry.name)), [['Morrow the Returned', 'Vex the Swift']])
  })

  it('follows changed links after a main promotion without changing assignment ids', () => {
    const assignments = { morrow: 'blue', vex: 'blue', lark: 'red' } as const
    const promoted = [player('morrow', 'Morrow', 'vex'), player('vex', 'Vex the Main'), player('lark', 'Lark', 'vex')]
    assert.deepEqual(Object.keys(assignments), ['morrow', 'vex', 'lark'])
    assert.equal(samePlayer('morrow', 'vex', promoted), true)
    assert.equal(samePlayer('vex', 'lark', promoted), true)
    assert.deepEqual(conflictingTeamGroups('blue', promoted, assignments).map((group) => group.map((entry) => entry.name)), [['Morrow', 'Vex the Main']])
  })

  it('treats missing, dangling, self, and nested links as independent characters', () => {
    const roster = [player('missing', 'Missing'), player('dangling', 'Dangling', 'ghost'), player('self', 'Self', 'self'), player('root', 'Root'), player('direct', 'Direct', 'root'), player('nested', 'Nested', 'direct')]
    assert.equal(samePlayer('dangling', 'missing', roster), false)
    assert.equal(samePlayer('self', 'root', roster), false)
    assert.equal(samePlayer('direct', 'nested', roster), false)
    assert.deepEqual(conflictingTeamGroups('blue', roster, { dangling: 'blue', missing: 'blue', direct: 'blue', nested: 'blue' }), [])
  })

  it('reports each existing same-player group once and removes the warning when one assignment is removed', () => {
    const roster = [player('morrow', 'Morrow'), player('vex', 'Vex', 'morrow'), player('tallow', 'Tallow'), player('reed', 'Reed', 'tallow')]
    const assignments = { morrow: 'blue', vex: 'blue', tallow: 'blue', reed: 'red' } as const
    assert.deepEqual(conflictingTeamGroups('blue', roster, assignments).map((group) => group.map((entry) => entry.id)), [['morrow', 'vex']])
    const resolved = { ...assignments, vex: 'red' } as const
    assert.deepEqual(conflictingTeamGroups('blue', roster, resolved), [])
    assert.deepEqual(conflictingTeamGroups('red', roster, resolved), [])
  })

  it('finds a conflicting character without treating the candidate as a conflict with itself', () => {
    const roster = [player('morrow', 'Morrow'), player('vex', 'Vex', 'morrow')]
    assert.equal(conflictingAssignedCharacter('morrow', 'blue', roster, { morrow: 'blue' }), undefined)
    assert.equal(conflictingAssignedCharacter('vex', 'blue', roster, { morrow: 'blue' })?.id, 'morrow')
  })
})

describe('raid team assignment workflow', () => {
  it('rejects an assignment before persistence and leaves assignments unchanged', async () => {
    const roster = [player('morrow', 'Morrow'), player('vex', 'Vex', 'morrow')]
    const assignments = { morrow: 'blue' }
    const writes: [string, string][] = []
    const errors: string[] = []
    const conflicts: { characterName: string; conflictingCharacterName: string; teamName: string }[] = []
    await assignTeamMember({ playerId: 'vex', team: 'blue', roster, assignments, teams: teamOptions, persist: async (id, team) => { writes.push([id, team]) }, onConflict: (conflict) => conflicts.push(conflict), setMutationError: (message) => errors.push(message) })
    assert.deepEqual(writes, [])
    assert.deepEqual(assignments, { morrow: 'blue' })
    assert.deepEqual(conflicts, [{ characterName: 'Vex', conflictingCharacterName: 'Morrow', teamName: 'Blue' }])
    assert.deepEqual(errors, [])
  })

  it('rejects a move without changing its original assignment', async () => {
    const roster = [player('morrow', 'Morrow'), player('vex', 'Vex', 'morrow')]
    const assignments = { morrow: 'blue', vex: 'red' }
    const writes: [string, string][] = []
    await assignTeamMember({ playerId: 'vex', team: 'blue', roster, assignments, teams: teamOptions, persist: async (id, team) => { writes.push([id, team]) }, onConflict: () => {}, setMutationError: () => {} })
    assert.deepEqual(writes, [])
    assert.equal(assignments.vex, 'red')
  })

  it('allows a valid assignment to a team that already has a conflict', async () => {
    const roster = [player('morrow', 'Morrow'), player('vex', 'Vex', 'morrow'), player('tallow', 'Tallow')]
    const assignments = { morrow: 'blue', vex: 'blue' }
    const writes: [string, string][] = []
    const errors: string[] = []
    await assignTeamMember({ playerId: 'tallow', team: 'blue', roster, assignments, teams: teamOptions, persist: async (id, team) => { writes.push([id, team]) }, onConflict: () => {}, setMutationError: (message) => errors.push(message) })
    assert.deepEqual(writes, [['tallow', 'blue']])
    assert.deepEqual(errors, [''])
  })

  it('does not persist or modify an assignment already on the requested team', async () => {
    const roster = [player('morrow', 'Morrow')]
    const assignments = { morrow: 'blue' }
    let writeCount = 0
    await assignTeamMember({ playerId: 'morrow', team: 'blue', roster, assignments, teams: teamOptions, persist: async () => { writeCount += 1 }, onConflict: () => {}, setMutationError: () => {} })
    assert.equal(writeCount, 0)
    assert.deepEqual(assignments, { morrow: 'blue' })
  })

  it('moves an unrelated character into a conflict-containing team and preserves the conflict', async () => {
    const roster = [player('morrow', 'Morrow'), player('vex', 'Vex', 'morrow'), player('tallow', 'Tallow')]
    const assignments = { morrow: 'blue', vex: 'blue', tallow: 'red' }
    const writes: [string, string][] = []
    await assignTeamMember({ playerId: 'tallow', team: 'blue', roster, assignments, teams: teamOptions, persist: async (id, team) => { writes.push([id, team]) }, onConflict: () => {}, setMutationError: () => {} })
    assert.deepEqual(writes, [['tallow', 'blue']])
    assert.deepEqual(assignments, { morrow: 'blue', vex: 'blue', tallow: 'red' })
    const afterMove = { ...assignments, tallow: 'blue' as const }
    assert.deepEqual(conflictingTeamGroups('blue', roster, afterMove).map((group) => group.map((entry) => entry.id)), [['morrow', 'vex']])
  })

  it('preserves the team capacity validation', async () => {
    const roster = Array.from({ length: 11 }, (_, index) => player(`player-${index}`, `Player ${index}`))
    const assignments = Object.fromEntries(roster.slice(0, 10).map((entry) => [entry.id, 'blue']))
    let writeCount = 0
    const errors: string[] = []
    await assignTeamMember({ playerId: 'player-10', team: 'blue', roster, assignments, teams: teamOptions, persist: async () => { writeCount += 1 }, onConflict: () => {}, setMutationError: (message) => errors.push(message) })
    assert.equal(writeCount, 0)
    assert.match(errors.at(-1) ?? '', /Blue is full/)
  })

  it('does not persist a character that is missing from the roster', async () => {
    let writeCount = 0
    const errors: string[] = []
    await assignTeamMember({ playerId: 'removed-character', team: 'blue', roster: [], assignments: {}, teams: teamOptions, persist: async () => { writeCount += 1 }, onConflict: () => {}, setMutationError: (message) => errors.push(message) })
    assert.equal(writeCount, 0)
    assert.match(errors.at(-1) ?? '', /no longer in the guild roster/)
  })

  it('persists removal and clears the existing conflict when that assignment is removed', async () => {
    const roster = [player('morrow', 'Morrow'), player('vex', 'Vex', 'morrow')]
    const assignments = { morrow: 'blue', vex: 'blue' }
    const writes: [string, string | null][] = []
    const errors: string[] = []
    await removeTeamMember('vex', async (id, team) => { writes.push([id, team]) }, (message) => errors.push(message))
    const afterRemoval = { ...assignments }
    delete afterRemoval.vex
    assert.deepEqual(writes, [['vex', null]])
    assert.deepEqual(errors, [''])
    assert.deepEqual(conflictingTeamGroups('blue', roster, afterRemoval), [])
  })
})