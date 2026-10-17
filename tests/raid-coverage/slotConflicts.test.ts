import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage, summaryText, validateEffects } from '../../src/features/raid-coverage/calculateCoverage.ts'
import { conflictExplanation, coverageTiles } from '../../src/features/raid-coverage/coverageDisplay.ts'
import { classifySlot, DEFAULT_NODE_LIMIT, MAX_GROUP_SIZE, type SlotOutcome, type SlotRequirement } from '../../src/features/raid-coverage/slotConflicts.ts'
import type { CoverageEffect, CoverageMember } from '../../src/features/raid-coverage/types.ts'

// Invented requirements and players: these test the algorithm, not the game.
const req = (key: string, demand: number, eligible: string[]): SlotRequirement => ({ key, demand, eligible })
const statuses = (map: Map<string, SlotOutcome>) => Object.fromEntries([...map].map(([key, outcome]) => [key, outcome.status]))
const witness = (map: Map<string, SlotOutcome>, key: string) => {
  const outcome = map.get(key)
  assert.equal(outcome?.status, 'contested')
  return outcome.status === 'contested' ? [...outcome.witness].sort() : []
}

// Reference using Hall's condition, independent of the matching code under test.
function reference(reqs: SlotRequirement[]) {
  const live = reqs.filter((r) => new Set(r.eligible).size >= r.demand)
  const feasible = (mask: number) => {
    const chosen = live.filter((_, i) => mask & (1 << i))
    for (let sub = 1; sub < 1 << chosen.length; sub++) {
      const part = chosen.filter((_, i) => sub & (1 << i))
      const need = part.reduce((sum, r) => sum + r.demand, 0)
      if (need > new Set(part.flatMap((r) => r.eligible)).size) return false
    }
    return true
  }
  const contested = new Set<string>()
  for (let mask = 1; mask < 1 << live.length; mask++) {
    if (feasible(mask)) continue
    let minimal = true
    for (let i = 0; i < live.length && minimal; i++) if (mask & (1 << i) && !feasible(mask & ~(1 << i))) minimal = false
    if (minimal) live.forEach((r, i) => mask & (1 << i) && contested.add(r.key))
  }
  return Object.fromEntries(reqs.map((r) => [r.key, new Set(r.eligible).size < r.demand ? 'missing' : contested.has(r.key) ? 'contested' : 'available']))
}

function seeded(seed: number) {
  let state = seed
  return (n: number) => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state % n
  }
}

describe('classifySlot examples', () => {
  it('serves requirements with enough distinct players', () => {
    assert.deepEqual(statuses(classifySlot([req('a', 1, ['p1']), req('b', 1, ['p2'])])), { a: 'available', b: 'available' })
  })

  it('contests two requirements that need the same single player, with a witness', () => {
    const out = classifySlot([req('a', 1, ['p1']), req('b', 1, ['p1'])])
    assert.deepEqual(statuses(out), { a: 'contested', b: 'contested' })
    assert.deepEqual(witness(out, 'a'), ['a', 'b'])
  })

  it('reports Missing when eligible players are fewer than the demand, even alone', () => {
    const out = classifySlot([req('a', 2, ['p1']), req('b', 1, ['p1'])])
    assert.deepEqual(statuses(out), { a: 'missing', b: 'available' })
  })

  it('does not let a Missing requirement cause a conflict', () => {
    assert.equal(statuses(classifySlot([req('a', 1, []), req('b', 1, ['p1'])])).b, 'available')
  })

  it('E8: a requirement outside the minimal conflict stays Available', () => {
    const out = classifySlot([req('r0', 2, ['p0', 'p1', 'p2']), req('r1', 1, ['p0']), req('r2', 2, ['p1', 'p2'])])
    assert.deepEqual(statuses(out), { r0: 'contested', r1: 'available', r2: 'contested' })
    assert.deepEqual(witness(out, 'r0'), ['r0', 'r2'])
  })

  it('contests every requirement when a shared pool is half served', () => {
    const out = classifySlot([req('r0', 2, ['p0', 'p1']), req('r1', 1, ['p0']), req('r2', 1, ['p0', 'p1'])])
    assert.deepEqual(statuses(out), { r0: 'contested', r1: 'contested', r2: 'contested' })
  })

  it('reports the shortfall of a witness', () => {
    const out = classifySlot([req('a', 2, ['p1', 'p2']), req('b', 2, ['p1', 'p2'])]).get('a')
    assert.deepEqual(out, { status: 'contested', witness: ['a', 'b'], demand: 4, maxCoverable: 2 })
  })

  it('keeps unrelated groups independent', () => {
    const out = classifySlot([req('a', 1, ['p1']), req('b', 1, ['p1']), req('c', 1, ['p9'])])
    assert.deepEqual(statuses(out), { a: 'contested', b: 'contested', c: 'available' })
  })

  it('counts duplicate eligible players once', () => {
    assert.equal(statuses(classifySlot([req('a', 2, ['p1', 'p1'])])).a, 'missing')
  })

  it('is empty for no requirements', () => {
    assert.equal(classifySlot([]).size, 0)
  })
})

describe('classifySlot against brute force', () => {
  it('matches the Hall-condition reference on 2000 seeded cases', () => {
    const next = seeded(12345)
    for (let c = 0; c < 2000; c++) {
      const players = Array.from({ length: 1 + next(6) }, (_, i) => `p${i}`)
      const reqs = Array.from({ length: 1 + next(6) }, (_, i) => req(`r${i}`, 1 + next(3), players.filter(() => next(2) === 0)))
      assert.deepEqual(statuses(classifySlot(reqs)), reference(reqs), JSON.stringify(reqs))
    }
  })

  it('every witness is infeasible, minimal, and contains its requirement', () => {
    const next = seeded(777)
    for (let c = 0; c < 500; c++) {
      const players = Array.from({ length: 2 + next(4) }, (_, i) => `p${i}`)
      const reqs = Array.from({ length: 2 + next(4) }, (_, i) => req(`r${i}`, 1 + next(2), players.filter(() => next(2) === 0)))
      const out = classifySlot(reqs)
      for (const [key, outcome] of out) {
        if (outcome.status !== 'contested') continue
        assert.ok(outcome.witness.includes(key))
        const parts = reqs.filter((r) => outcome.witness.includes(r.key))
        assert.equal(Object.values(reference(parts)).includes('contested'), true)
        for (const drop of parts) {
          const rest = parts.filter((r) => r !== drop)
          assert.equal(Object.values(reference(rest)).includes('contested'), false, 'witness is not minimal')
        }
      }
    }
  })

  it('does not depend on the order of requirements or players', () => {
    const next = seeded(99)
    for (let c = 0; c < 300; c++) {
      const players = Array.from({ length: 2 + next(5) }, (_, i) => `p${i}`)
      const reqs = Array.from({ length: 2 + next(5) }, (_, i) => req(`r${i}`, 1 + next(2), players.filter(() => next(2) === 0)))
      const shuffled = [...reqs].reverse().map((r) => ({ ...r, eligible: [...r.eligible].reverse() }))
      assert.deepEqual([...classifySlot(reqs)].sort(), [...classifySlot(shuffled)].sort())
    }
  })
})

describe('classifySlot limits', () => {
  // One demand-1 requirement against many demand-3 requirements over one pool forces a large search.
  const hard = () => [req('target', 1, ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11']),
    ...Array.from({ length: 4 }, (_, i) => req(`big${i}`, 3, ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11']))]

  it('returns Indeterminate instead of guessing when the limit is too low', () => {
    const out = classifySlot([req('a', 1, ['p1']), req('b', 1, ['p1']), req('c', 1, ['p1', 'p2'])], 0)
    assert.ok([...out.values()].some((o) => o.status === 'indeterminate'))
    for (const outcome of out.values()) assert.notEqual(outcome.status, 'available')
  })

  it('never reports Available or Contested wrongly at any limit', () => {
    const next = seeded(4242)
    for (let c = 0; c < 300; c++) {
      const players = Array.from({ length: 2 + next(4) }, (_, i) => `p${i}`)
      const reqs = Array.from({ length: 2 + next(4) }, (_, i) => req(`r${i}`, 1 + next(2), players.filter(() => next(2) === 0)))
      const truth = reference(reqs)
      const limit = next(6)
      for (const [key, outcome] of classifySlot(reqs, limit)) {
        if (outcome.status !== 'indeterminate') assert.equal(outcome.status, truth[key], `limit ${limit}: ${JSON.stringify(reqs)}`)
      }
    }
  })

  it('is deterministic', () => {
    assert.deepEqual([...classifySlot(hard(), 50)], [...classifySlot(hard(), 50)])
  })

  it('applies the limit per requirement, so easy requirements still resolve', () => {
    const out = classifySlot([...hard(), req('easy', 1, ['solo'])], 50)
    assert.equal(out.get('easy')?.status, 'available')
  })

  it('refuses groups above the size cap with an explicit reason', () => {
    const many = Array.from({ length: MAX_GROUP_SIZE + 1 }, (_, i) => req(`r${i}`, 1, ['p1', 'p2']))
    const out = classifySlot(many)
    for (const outcome of out.values()) assert.deepEqual(outcome, { status: 'indeterminate', cause: 'too-many-requirements', nodesUsed: 0 })
  })

  it('has the approved default limit', () => {
    assert.equal(DEFAULT_NODE_LIMIT, 20000)
  })
})

const effect = (over: Partial<CoverageEffect> & Pick<CoverageEffect, 'id' | 'kind'>): CoverageEffect => ({
  name: over.id,
  providers: [{ className: 'Alpha' }],
  confidence: 'confirmed',
  scopeStatus: 'confirmed',
  sources: ['test'],
  verifiedOn: '2026-01-01',
  ...over,
})
const member = (id: string, className = 'Alpha', specialization = ''): CoverageMember => ({ id, name: `Player ${id}`, className, specialization })
const byKey = (effects: CoverageEffect[], members: CoverageMember[], options?: { nodeLimit?: number }) =>
  Object.fromEntries(calculateCoverage(effects, members, options).requirements.map((r) => [r.key, r]))

describe('calculateCoverage with slots', () => {
  const aura = (id: string, over: Partial<CoverageEffect> = {}) => effect({ id, kind: 'raid-buff', slot: 'test-aura', ...over })

  it('marks two slotted effects Contested when one player must serve both', () => {
    const out = byKey([aura('a'), aura('b')], [member('1')])
    assert.equal(out.a.status, 'contested')
    assert.equal(out.b.status, 'contested')
    assert.deepEqual(out.a.conflict?.requirementKeys.sort(), ['a', 'b'])
    assert.equal(out.a.conflict?.shortfall, 1)
  })

  it('keeps both Available with enough different players', () => {
    const out = byKey([aura('a'), aura('b')], [member('1'), member('2')])
    assert.equal(out.a.status, 'available')
    assert.equal(out.b.status, 'available')
  })

  it('does not change effects without a slot', () => {
    const out = byKey([effect({ id: 'a', kind: 'raid-buff' }), effect({ id: 'b', kind: 'raid-buff' })], [member('1')])
    assert.equal(out.a.status, 'available')
    assert.equal(out.b.status, 'available')
  })

  it('does not conflict across different slots', () => {
    const out = byKey([aura('a'), aura('b', { slot: 'other-slot' })], [member('1')])
    assert.equal(out.a.status, 'available')
    assert.equal(out.b.status, 'available')
  })

  it('treats alternative providers in a stack group as one requirement', () => {
    const effects = [aura('a1', { stackGroup: 'g', providers: [{ className: 'Alpha' }] }), aura('a2', { stackGroup: 'g', providers: [{ className: 'Beta' }] }), aura('b')]
    const out = byKey(effects, [member('1', 'Alpha'), member('2', 'Beta')])
    assert.equal(out.g.status, 'available')
    assert.equal(out.b.status, 'available')
  })

  it('handles requirements needing several providers', () => {
    const out = byKey([aura('a', { requirement: 2 }), aura('b')], [member('1'), member('2')])
    assert.equal(out.a.status, 'contested')
    assert.equal(out.b.status, 'contested')
    assert.equal(byKey([aura('a', { requirement: 2 }), aura('b')], [member('1'), member('2'), member('3')]).a.status, 'available')
  })

  it('stays Missing when no provider exists, and never joins a conflict', () => {
    const out = byKey([aura('a', { providers: [{ className: 'Beta' }] }), aura('b')], [member('1')])
    assert.equal(out.a.status, 'missing')
    assert.equal(out.b.status, 'available')
  })

  it('keeps talent providers out of slot matching and stays Potential', () => {
    const out = byKey([aura('a', { providers: [{ className: 'Alpha', talent: 'T' }] }), aura('b')], [member('1')])
    assert.equal(out.a.status, 'potential')
    assert.equal(out.b.status, 'available')
  })

  it('keeps unverified effects out of slot matching', () => {
    const out = byKey([aura('a', { confidence: 'unverified', verifiedOn: undefined }), aura('b')], [member('1')])
    assert.equal(out.a.status, 'unverified')
    assert.equal(out.b.status, 'available')
  })

  it('keeps party and targeted effects out of slot matching', () => {
    const out = byKey([effect({ id: 'a', kind: 'party-buff' }), effect({ id: 'b', kind: 'targeted-buff' }), aura('c')], [member('1')])
    assert.equal(out.a.status, 'party-unknown')
    assert.equal(out.b.status, 'available')
    assert.equal(out.c.status, 'available')
  })

  it('treats a slot on a party or targeted buff as a catalog error, not a result', () => {
    for (const kind of ['party-buff', 'targeted-buff'] as const) {
      const report = calculateCoverage([aura('a', { kind }), aura('b')], [member('1')])
      assert.equal(report.catalogErrors.length, 1)
      assert.match(report.catalogErrors[0], /slot is not allowed/)
      assert.equal(report.requirements.length, 0)
      assert.equal(report.hasIndeterminate, false)
    }
  })

  it('lets a player who provides it through an unslotted effect avoid the slot', () => {
    const effects = [aura('a', { stackGroup: 'g', providers: [{ className: 'Beta' }] }), effect({ id: 'a-free', kind: 'raid-buff', stackGroup: 'g', providers: [{ className: 'Alpha' }] }), aura('b', { providers: [{ className: 'Beta' }] })]
    const out = byKey(effects, [member('1', 'Alpha'), member('2', 'Beta')])
    assert.equal(out.g.status, 'available')
    assert.equal(out.b.status, 'available')
  })

  it('works for debuffs', () => {
    const out = byKey([effect({ id: 'x', kind: 'debuff', slot: 'curse' }), effect({ id: 'y', kind: 'debuff', slot: 'curse' })], [member('1')])
    assert.equal(out.x.status, 'contested')
  })

  it('returns Indeterminate with a reason when the limit is exceeded, and flags the report', () => {
    const effects = [aura('a'), aura('b'), aura('c')]
    const report = calculateCoverage(effects, [member('1'), member('2')], { nodeLimit: 0 })
    assert.equal(report.hasIndeterminate, true)
    assert.ok(report.requirements.every((r) => r.status !== 'available'))
    assert.equal(report.requirements.find((r) => r.status === 'indeterminate')?.limitReason?.cause, 'node-limit')
    assert.match(summaryText(report), /not calculated/)
  })

  it('reports mixed slots in one group as a catalog error, never as Not calculated or Available', () => {
    const report = calculateCoverage([aura('a', { stackGroup: 'g' }), aura('b', { stackGroup: 'g', slot: 'other-slot' })], [member('1')])
    assert.equal(report.catalogErrors.length, 1)
    assert.match(report.catalogErrors[0], /g: stack group mixes slots \(other-slot, test-aura\)/)
    assert.equal(report.requirements.length, 0)
    assert.equal(report.summary.indeterminate, 0)
    assert.equal(report.hasIndeterminate, false)
    assert.equal(summaryText(report), 'Catalog error (1)')
  })

  it('reports a badly named slot as a catalog error', () => {
    assert.equal(calculateCoverage([aura('a', { slot: 'Bad Slot' })], [member('1')]).catalogErrors.length, 1)
  })

  it('has no catalog errors for a valid catalog, and reserves Not calculated for valid limits', () => {
    const report = calculateCoverage([aura('a'), aura('b'), aura('c')], [member('1'), member('2')], { nodeLimit: 0 })
    assert.deepEqual(report.catalogErrors, [])
    assert.equal(report.hasIndeterminate, true)
    assert.deepEqual(validateEffects([aura('a'), aura('b'), aura('c')]), [])
  })

  it('uses the approved 20,000 node limit when none is given', () => {
    const effects = [aura('a'), aura('b'), aura('c')]
    const members = [member('1'), member('2')]
    assert.deepEqual(calculateCoverage(effects, members), calculateCoverage(effects, members, { nodeLimit: DEFAULT_NODE_LIMIT }))
  })

  it('keeps Potential when talent providers are enough, even if a slot is crowded', () => {
    const effects = [aura('a', { providers: [{ className: 'Alpha', talent: 'T' }] }), aura('b'), aura('c')]
    const out = byKey(effects, [member('1')])
    assert.equal(out.a.status, 'potential')
    assert.equal(out.b.status, 'contested')
    assert.equal(out.c.status, 'contested')
  })

  it('does not let a talent provider rescue a Contested result or take a slot', () => {
    const talent = (id: string) => aura(id, { providers: [{ className: 'Alpha' }, { className: 'Beta', talent: 'T' }] })
    const out = byKey([talent('a'), talent('b')], [member('1', 'Alpha'), member('2', 'Beta')])
    assert.equal(out.a.status, 'contested')
    assert.equal(out.b.status, 'contested')
  })

  it('keeps Potential when a no-talent search elsewhere is Not calculated', () => {
    const effects = [aura('a'), aura('b'), aura('c'), aura('t', { providers: [{ className: 'Beta', talent: 'T' }] })]
    const out = byKey(effects, [member('1'), member('2'), member('3', 'Beta')], { nodeLimit: 0 })
    assert.equal(out.t.status, 'potential')
    assert.equal(out.a.status, 'indeterminate')
  })

  it('never turns Potential into Contested or Not calculated', () => {
    const out = byKey([aura('t', { providers: [{ className: 'Beta', talent: 'T' }] }), aura('b', { providers: [{ className: 'Beta' }] })], [member('1', 'Beta')], { nodeLimit: 0 })
    assert.equal(out.t.status, 'potential')
    assert.equal(out.b.status, 'available')
  })

  it('lets Party Unknown and Unverified win over slot results', () => {
    const effects = [aura('u', { confidence: 'unverified', verifiedOn: undefined }), effect({ id: 'p', kind: 'party-buff' }), aura('a'), aura('b')]
    const out = byKey(effects, [member('1')])
    assert.equal(out.u.status, 'unverified')
    assert.equal(out.p.status, 'party-unknown')
    assert.equal(out.a.status, 'contested')
  })

  it('ignores player order and duplicate player ids', () => {
    const effects = [aura('a'), aura('b'), aura('c')]
    const players = [member('1'), member('2'), member('3')]
    const forward = calculateCoverage(effects, players).requirements.map((r) => [r.key, r.status])
    const backward = calculateCoverage([...effects].reverse(), [...players, member('1')].reverse()).requirements.map((r) => [r.key, r.status]).sort()
    assert.deepEqual(forward.sort(), backward)
  })

  it('counts contested requirements in the summary text only when present', () => {
    const none = calculateCoverage([aura('a')], [member('1')])
    assert.equal(summaryText(none), '1 available, 0 missing, 0 potential')
    const some = calculateCoverage([aura('a'), aura('b')], [member('1')])
    assert.equal(summaryText(some), '0 available, 2 contested, 0 missing, 0 potential')
  })

  it('supports 10-, 20- and 40-player teams', () => {
    for (const size of [10, 20, 40]) {
      const players = Array.from({ length: size }, (_, i) => member(String(i)))
      const out = byKey([aura('a', { requirement: size / 2 }), aura('b', { requirement: size / 2 })], players)
      assert.equal(out.a.status, 'available')
      assert.equal(byKey([aura('a', { requirement: size / 2 }), aura('b', { requirement: size / 2 + 1 })], players).a.status, 'contested')
    }
  })

  it('shows no conflicts for an empty catalog or an empty team', () => {
    assert.equal(calculateCoverage([], [member('1')]).requirements.length, 0)
    assert.equal(byKey([aura('a'), aura('b')], []).a.status, 'missing')
  })
})

describe('validateEffects for slots', () => {
  it('accepts valid slots and rejects bad names, wrong kinds and mixed slots', () => {
    const ok = effect({ id: 'a', kind: 'raid-buff', slot: 'paladin-aura' })
    assert.deepEqual(validateEffects([ok]), [])
    assert.ok(validateEffects([{ ...ok, slot: 'Bad Slot' }]).some((p) => /slot must be/.test(p)))
    assert.ok(validateEffects([{ ...ok, kind: 'party-buff' }]).some((p) => /slot is not allowed/.test(p)))
    assert.ok(validateEffects([{ ...ok, stackGroup: 'g' }, { ...ok, id: 'b', stackGroup: 'g', slot: 'other' }]).some((p) => /mixes slots/.test(p)))
  })
})

describe('slot presentation', () => {
  it('shows Contested and Not calculated tiles with glyphs and explanations', () => {
    const effects = [effect({ id: 'a', kind: 'raid-buff', slot: 's' }), effect({ id: 'b', kind: 'raid-buff', slot: 's' })]
    const tiles = coverageTiles(effects, [member('1')])
    assert.equal(tiles[0].status, 'contested')
    assert.equal(tiles[0].glyph, '↔')
    assert.equal(tiles[0].label, 'a: Contested')
    const text = tiles[0].lines.join(' ')
    assert.match(text, /^Eligible providers exist, but competing effects cannot all be guaranteed simultaneously\./)
    assert.match(text, /Cannot all be served together with: b/)
    const report = calculateCoverage([...effects, effect({ id: 'c', kind: 'raid-buff', slot: 's' })], [member('1'), member('2')], { nodeLimit: 0 })
    const unknown = report.requirements.find((r) => r.status === 'indeterminate')!
    assert.match(conflictExplanation(unknown), /limit/)
    assert.equal(conflictExplanation({ ...unknown, status: 'available' }), '')
  })

  it('says Available means no modelled conflict, not active in game', () => {
    const tiles = coverageTiles([effect({ id: 'a', kind: 'raid-buff' })], [member('1')])
    assert.match(tiles[0].lines.join(' '), /not a guarantee it is active in game/)
  })
})
