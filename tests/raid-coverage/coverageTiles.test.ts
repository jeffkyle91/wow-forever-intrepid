import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage } from '../../src/shared/raid-coverage/calculateCoverage.ts'
import { coverageTiles, statusGlyphs, statusLabels } from '../../src/shared/raid-coverage/coverageDisplay.ts'
import { assignedMembers } from '../../src/shared/raid-coverage/teamSelection.ts'
import type { StandingTeam } from '../../src/guildApi.ts'
import { group40, groups20 } from '../../src/shared/game/teams.ts'
import type { CoverageEffect, CoverageMember, CoverageStatus } from '../../src/shared/raid-coverage/types.ts'

// Invented effects and players: these test the tile mapping, not the game.
const effect = (over: Partial<CoverageEffect> & Pick<CoverageEffect, 'id' | 'kind'>): CoverageEffect => ({
  name: over.id,
  providers: [{ className: 'Alpha' }],
  confidence: 'confirmed',
  scopeStatus: 'confirmed',
  sources: ['test'],
  verifiedOn: '2026-01-01',
  ...over,
})
const member = (id: string, className: string): CoverageMember => ({ id, name: `Player ${id}`, className, specialization: '' })

describe('coverage tiles', () => {
  it('renders nothing for an empty catalog', () => {
    assert.deepEqual(coverageTiles([], [member('1', 'Alpha')]), [])
  })

  it('maps each status to its label and glyph', () => {
    const effects = [
      effect({ id: 'a', kind: 'raid-buff' }),
      effect({ id: 'm', kind: 'debuff', providers: [{ className: 'Beta' }] }),
      effect({ id: 'p', kind: 'raid-buff', providers: [{ className: 'Alpha', talent: 'T' }] }),
      effect({ id: 'u', kind: 'raid-buff', confidence: 'unverified' }),
      effect({ id: 'q', kind: 'party-buff' }),
    ]
    const tiles = coverageTiles(effects, [member('1', 'Alpha')])
    const expected: Record<string, [CoverageStatus, string]> = { a: ['available', '✓'], m: ['missing', '✕'], p: ['potential', '?'], u: ['available', statusGlyphs.available], q: ['party-unknown', '?'] }
    assert.equal(tiles.length, 5)
    for (const tile of tiles) {
      const [status, glyph] = expected[tile.key]
      assert.equal(tile.status, status)
      assert.equal(tile.glyph, glyph)
      assert.equal(tile.glyph, statusGlyphs[status])
      assert.equal(tile.label, `${tile.spellName}: ${statusLabels[status]}`)
    }
  })

  it('uses the same statuses as the detailed engine, one tile per requirement', () => {
    const effects = [
      effect({ id: 'a', kind: 'raid-buff', stackGroup: 'g' }),
      effect({ id: 'b', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Beta' }] }),
      effect({ id: 'c', kind: 'targeted-buff', providers: [{ className: 'Beta' }] }),
    ]
    const members = [member('1', 'Beta')]
    const report = calculateCoverage(effects, members)
    const tiles = coverageTiles(effects, members)
    assert.equal(tiles.length, 2)
    assert.deepEqual(tiles.map((tile) => tile.status), report.requirements.map((requirement) => requirement.status))
    assert.equal(tiles[0].name, 'a / b')
  })

  it('shows distinct glyph and label for unverified versus party unknown', () => {
    assert.notEqual(statusLabels.unverified, statusLabels['party-unknown'])
  })
})

describe('tiles follow each card\'s team composition', () => {
  const effects = [effect({ id: 'e', kind: 'raid-buff', providers: [{ className: 'Alpha' }] })]
  const players = [member('a', 'Alpha'), member('b', 'Beta'), member('c', 'Beta'), member('d', 'Alpha'), member('e', 'Alpha')]
  const statusFor = (parts: StandingTeam[], assignments: Record<string, StandingTeam>) => coverageTiles(effects, assignedMembers(parts, players, assignments))[0].status

  it('differs between independently assigned 10-, 20- and 40-player teams', () => {
    const assignments: Record<string, StandingTeam> = { a: 'blue', b: 'yellow', c: 'red', d: 'white' }
    assert.equal(statusFor(['blue'], assignments), 'available')
    assert.equal(statusFor(['yellow'], assignments), 'missing')
    assert.equal(statusFor([groups20[0].key], assignments), 'missing')
    assert.equal(statusFor([groups20[1].key], { d: 'pink' }), 'available')
    assert.equal(statusFor(['red'], assignments), 'missing')
    assert.equal(statusFor([group40.key], { a: 'brown' }), 'available')
  })

  it('ignores unassigned players', () => {
    assert.equal(statusFor([group40.key], { b: 'blue', c: 'red' }), 'missing')
  })

  it('updates when a player is moved', () => {
    assert.equal(statusFor(['blue'], { a: 'blue' }), 'available')
    assert.equal(statusFor(['blue'], { a: 'red' }), 'missing')
    assert.equal(statusFor(['red'], { a: 'red' }), 'available')
  })
})
