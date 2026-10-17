import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateCoverage, providerEligibility, validateEffects } from '../../src/features/raid-coverage/calculateCoverage.ts'
import { coverageEffects } from '../../src/features/raid-coverage/coverageData.ts'
import { coverageTiles } from '../../src/features/raid-coverage/coverageDisplay.ts'
import { classSpecializations } from '../../src/shared/game/classes.ts'
import type { CoverageEffect, CoverageMember } from '../../src/features/raid-coverage/types.ts'

const member = (id: string, className: string, specialization = ''): CoverageMember => ({ id, name: `P${id}`, className, specialization })
const catalog = (id: string) => coverageEffects.find((entry) => entry.id === id)!
const run = (id: string, members: CoverageMember[]) => calculateCoverage([catalog(id)], members).requirements[0]
const synthetic = (over: Partial<CoverageEffect>): CoverageEffect => ({
  id: 's', name: 's', kind: 'raid-buff', providers: [{ className: 'Druid', specs: ['Feral'] }], confidence: 'confirmed', scopeStatus: 'confirmed', sources: ['test'], verifiedOn: '2026-01-01', ...over,
})

describe('provider eligibility rules', () => {
  const feralOnly = { className: 'Druid', specs: ['Feral'] }
  const feralTalent = { className: 'Druid', specs: ['Feral'], talent: 'T' }

  it('is guaranteed for a listed spec when no talent is needed, and ineligible for another recognised spec', () => {
    assert.equal(providerEligibility(feralOnly, member('1', 'Druid', 'Feral')), 'guaranteed')
    assert.equal(providerEligibility(feralOnly, member('1', 'Druid', 'Restoration')), 'ineligible')
    assert.equal(providerEligibility(feralOnly, member('1', 'Warrior', 'Feral')), 'ineligible')
  })

  it('never makes a talent provider guaranteed, even for the right spec', () => {
    assert.equal(providerEligibility(feralTalent, member('1', 'Druid', 'Feral')), 'possible')
    assert.equal(providerEligibility(feralTalent, member('1', 'Druid', 'Balance')), 'ineligible')
  })

  it('treats a blank or unrecognised specialization as possible, never guaranteed', () => {
    for (const spec of ['', '   ', 'Fury', 'Combat', 'Not set']) {
      assert.equal(providerEligibility(feralOnly, member('1', 'Druid', spec)), 'possible', `"${spec}"`)
      assert.equal(providerEligibility(feralTalent, member('1', 'Druid', spec)), 'possible', `"${spec}"`)
    }
  })

  it('ignores case and surrounding spaces', () => {
    assert.equal(providerEligibility(feralOnly, member('1', 'druid', ' FERAL ')), 'guaranteed')
  })

  it('leaves class-wide providers unchanged: every spec, even an unreadable one, is guaranteed without a talent', () => {
    assert.equal(providerEligibility({ className: 'Warrior' }, member('1', 'Warrior', '')), 'guaranteed')
    assert.equal(providerEligibility({ className: 'Warrior' }, member('1', 'Warrior', 'Arms')), 'guaranteed')
    assert.equal(providerEligibility({ className: 'Warrior', talent: 'T' }, member('1', 'Warrior', 'Arms')), 'possible')
  })

  it('does not match a spec-restricted provider on the spec name alone', () => {
    assert.equal(providerEligibility({ className: 'Paladin', specs: ['Protection'] }, member('1', 'Warrior', 'Protection')), 'ineligible')
  })
})

describe('engine statuses follow eligibility', () => {
  it('Available only from a guaranteed spec provider; Potential for an unreadable spec; Missing for another recognised spec', () => {
    const e = synthetic({})
    assert.equal(calculateCoverage([e], [member('1', 'Druid', 'Feral')]).requirements[0].status, 'available')
    assert.equal(calculateCoverage([e], [member('1', 'Druid', 'Restoration')]).requirements[0].status, 'missing')
    assert.equal(calculateCoverage([e], [member('1', 'Druid', '')]).requirements[0].status, 'potential')
  })

  it('does not count a possible player towards Available or towards requirement above one', () => {
    const e = synthetic({ requirement: 2 })
    const r = calculateCoverage([e], [member('1', 'Druid', 'Feral'), member('2', 'Druid', '')]).requirements[0]
    assert.equal(r.status, 'potential')
    assert.equal(r.availableCount, 1)
    assert.equal(r.potentialCount, 2)
  })

  it('keeps one match per player and prefers the guaranteed provider', () => {
    const e = synthetic({ providers: [{ className: 'Druid', specs: ['Feral'], talent: 'T' }, { className: 'Druid' }] })
    const r = calculateCoverage([e], [member('1', 'Druid', 'Feral')]).requirements[0]
    assert.equal(r.matches.length, 1)
    assert.equal(r.matches[0].eligibility, 'guaranteed')
    assert.equal(r.status, 'available')
  })

  it('keeps provisional data estimated even when the specialization is resolved', () => {
    const e = synthetic({ confidence: 'provisional', scopeStatus: 'provisional', verifiedOn: undefined })
    const r = calculateCoverage([e], [member('1', 'Druid', 'Feral')]).requirements[0]
    assert.equal(r.status, 'unverified')
    assert.equal(r.basis, 'estimated')
    assert.equal(r.estimate.status, 'available')
    assert.equal(calculateCoverage([e], [member('1', 'Druid', 'Balance')]).requirements[0].estimate.status, 'missing')
  })

  it('does not let a possible provider take part in the slot search', () => {
    const effects = [synthetic({ id: 'a', slot: 's' }), synthetic({ id: 'b', slot: 's' })]
    const report = calculateCoverage(effects, [member('1', 'Druid', '')])
    assert.deepEqual(report.requirements.map((r) => r.status), ['potential', 'potential'])
  })

  it('does not depend on member order', () => {
    const team = [member('1', 'Druid', 'Restoration'), member('2', 'Druid', 'Feral'), member('3', 'Druid', 'Balance')]
    const a = run('leader-of-the-pack', team)
    const b = run('leader-of-the-pack', [...team].reverse())
    assert.deepEqual([a.estimate.status, a.estimate.potentialCount], [b.estimate.status, b.estimate.potentialCount])
  })
})

describe('real catalog: Druid specializations', () => {
  const feral = member('f', 'Druid', 'Feral')
  const guardian = member('g', 'Druid', 'Guardian')
  const resto = member('r', 'Druid', 'Restoration')
  const balance = member('b', 'Druid', 'Balance')

  it('Leader of the Pack: Feral is assumed; Guardian is only possible; Restoration and Balance are not eligible', () => {
    assert.equal(run('leader-of-the-pack', [feral]).estimate.status, 'available')
    assert.equal(run('leader-of-the-pack', [guardian]).estimate.status, 'potential')
    assert.equal(run('leader-of-the-pack', [resto]).estimate.status, 'missing')
    assert.equal(run('leader-of-the-pack', [balance]).estimate.status, 'missing')
    assert.equal(run('leader-of-the-pack', [resto, balance]).estimate.status, 'missing')
  })

  it('Leader of the Pack is never verified Available, and a Guardian never counts as assumed', () => {
    const r = run('leader-of-the-pack', [feral, guardian])
    assert.equal(r.status, 'unverified')
    assert.equal(r.basis, 'estimated')
    assert.equal(r.estimate.availableCount, 1)
    assert.equal(r.estimate.potentialCount, 2)
    assert.equal(run('leader-of-the-pack', [guardian, { ...guardian, id: 'g2' }]).estimate.status, 'potential')
  })

  it('Leader of the Pack counts only the Feral Druid in a mixed Druid team', () => {
    const r = run('leader-of-the-pack', [feral, resto, balance])
    assert.deepEqual(r.matches.map((m) => m.playerId), ['f'])
    assert.equal(r.matches[0].eligibility, 'assumed')
    assert.equal(r.estimate.potentialCount, 1)
  })

  it('Moonkin Form: Balance is assumed; every other Druid spec is not eligible', () => {
    assert.equal(run('moonkin-form', [balance]).estimate.status, 'available')
    for (const other of [feral, guardian, resto]) assert.equal(run('moonkin-form', [other]).estimate.status, 'missing', other.specialization)
  })

  it('a Druid is not double counted across Moonkin and Leader of the Pack', () => {
    assert.equal(run('leader-of-the-pack', [balance]).estimate.status, 'missing')
    assert.equal(run('moonkin-form', [feral]).estimate.status, 'missing')
  })

  it('class-wide Druid buffs still count every Druid spec', () => {
    for (const druid of [feral, guardian, resto, balance]) {
      assert.equal(run('mark-of-the-wild', [druid]).estimate.status, 'available', druid.specialization)
      assert.equal(run('faerie-fire', [druid]).estimate.status, 'available', druid.specialization)
    }
  })

  it('an unreadable Druid spec is only Potential for the spec-gated effects', () => {
    for (const spec of ['', 'Fury', 'Combat', 'feral druid']) {
      assert.equal(run('leader-of-the-pack', [member('1', 'Druid', spec)]).estimate.status, 'potential', spec)
      assert.equal(run('moonkin-form', [member('1', 'Druid', spec)]).estimate.status, 'potential', spec)
    }
  })
})

describe('real catalog: Hunters, Shamans and other classes', () => {
  it('Trueshot Aura: Marksmanship is possible but not assumed, because the research only infers its tree', () => {
    assert.equal(run('trueshot-aura', [member('1', 'Hunter', 'Marksmanship')]).estimate.status, 'potential')
    assert.equal(run('trueshot-aura', [member('1', 'Hunter', 'Marksmanship')]).matches[0].eligibility, 'possible')
    for (const spec of ['Beast Mastery', 'Survival']) assert.equal(run('trueshot-aura', [member('1', 'Hunter', spec)]).estimate.status, 'missing', spec)
    assert.equal(run('trueshot-aura', [member('1', 'Hunter', 'Beast Mastery'), member('2', 'Hunter', 'Survival'), member('3', 'Hunter', 'Marksmanship')]).estimate.potentialCount, 1)
  })

  it('Trueshot Aura with an unreadable Hunter spec is Potential, never Available', () => {
    for (const spec of ['', 'Fury', 'Arms']) assert.equal(run('trueshot-aura', [member('1', 'Hunter', spec)]).estimate.status, 'potential', spec)
  })

  it('Hunter class-wide effects ignore specialization', () => {
    for (const spec of ['Beast Mastery', 'Marksmanship', 'Survival', '']) assert.equal(run('hunters-mark', [member('1', 'Hunter', spec)]).estimate.status, 'available', spec)
  })

  it('Mana Tide Totem is spec-gated but unverified, so it is never counted', () => {
    const r = run('mana-tide-totem', [member('1', 'Shaman', 'Restoration')])
    assert.equal(r.basis, 'unverified')
    assert.equal(r.estimate.status, 'unverified')
  })

  it('Mana Spring Totem stays class-wide for Shamans, who are eligible but party-wide so Party Unknown', () => {
    for (const spec of ['Elemental', 'Enhancement', 'Restoration']) {
      const r = run('mana-spring-totem', [member('1', 'Shaman', spec)])
      assert.equal(r.matches[0].eligibility, 'guaranteed', spec)
      assert.equal(r.estimate.status, 'party-unknown', spec)
    }
  })

  it('a different class with a matching spec name is never eligible', () => {
    assert.equal(run('trueshot-aura', [member('1', 'Warrior', 'Marksmanship')]).estimate.status, 'missing')
    assert.equal(run('moonkin-form', [member('1', 'Shaman', 'Balance')]).estimate.status, 'missing')
  })
})

describe('catalog audit', () => {
  const rule = (provider: CoverageEffect['providers'][number]) => `${provider.className}:${provider.specs?.join('/') ?? '*'}${provider.talent ? ':talent' : ''}`

  it('passes validation, and every provider class and spec is a real roster value', () => {
    assert.deepEqual(validateEffects(coverageEffects), [])
    for (const entry of coverageEffects) {
      for (const provider of entry.providers) {
        assert.ok(classSpecializations[provider.className], `${entry.id}: unknown class ${provider.className}`)
        for (const spec of provider.specs ?? []) assert.ok(classSpecializations[provider.className].some((option) => option.name === spec), `${entry.id}: ${spec}`)
      }
    }
  })

  it('restricts specializations only for the four talent-tree effects, so any change needs review', () => {
    const restricted = Object.fromEntries(coverageEffects.filter((entry) => entry.providers.some((provider) => provider.specs)).map((entry) => [entry.id, entry.providers.map(rule)]))
    assert.deepEqual(restricted, {
      'trueshot-aura': ['Hunter:Marksmanship:talent'],
      'leader-of-the-pack': ['Druid:Feral/Guardian:talent'],
      'moonkin-form': ['Druid:Balance:talent'],
      'mana-tide-totem': ['Shaman:Restoration:talent'],
    })
  })

  it('has no spec-guaranteed provider: nothing is guaranteed by specialization without Forever evidence', () => {
    for (const entry of coverageEffects) {
      for (const provider of entry.providers) assert.ok(!(provider.specs && !provider.talent), `${entry.id} lists specs without a talent`)
    }
  })

  it('lists the effects that need talent or rune tracking to ever become Available', () => {
    const needing = coverageEffects.filter((entry) => entry.providers.some((provider) => provider.talent)).map((entry) => entry.id).sort()
    assert.deepEqual(needing, ['dark-inspiration', 'homunculi', 'leader-of-the-pack', 'mana-tide-totem', 'moonkin-form', 'trueshot-aura', 'wild-strikes'])
  })

  it('treats every baseline provider as guaranteed for every spec of its class', () => {
    for (const entry of coverageEffects) {
      for (const provider of entry.providers.filter((item) => !item.specs && !item.talent)) {
        for (const option of classSpecializations[provider.className]) assert.equal(providerEligibility(provider, member('1', provider.className, option.name)), 'guaranteed', `${entry.id} ${option.name}`)
      }
    }
  })

  it('never reports a talent-only effect verified Available, and only assumes the catalog\'s named specs for the estimate', () => {
    for (const entry of coverageEffects.filter((item) => item.providers.every((provider) => provider.talent))) {
      const assumedSpecs = entry.providers.flatMap((provider) => (provider.assumed ? provider.assumed.specs.map((spec) => `${provider.className}:${spec}`) : []))
      for (const [className, options] of Object.entries(classSpecializations)) {
        for (const option of [...options.map((o) => o.name), '', 'Unknown']) {
          const r = calculateCoverage([entry], [member('1', className, option)]).requirements[0]
          assert.notEqual(r.status, 'available', entry.id)
          const expected = entry.confidence !== 'unverified' && assumedSpecs.includes(`${className}:${option}`)
          assert.equal(r.estimate.status === 'available', expected, `${entry.id} ${option} ${className}`)
        }
      }
    }
  })

  it('enables assumptions only for the two researched mappings, so any change needs review', () => {
    const assumed = Object.fromEntries(coverageEffects.flatMap((entry) => entry.providers.filter((provider) => provider.assumed).map((provider) => [entry.id, provider.assumed!.specs])))
    assert.deepEqual(assumed, { 'leader-of-the-pack': ['Feral'], 'moonkin-form': ['Balance'] })
    for (const entry of coverageEffects) for (const provider of entry.providers) if (provider.assumed) assert.ok(provider.assumed.basis.length > 20, entry.id)
  })

  it('rejects a spec that is not a roster specialization, or an empty spec list', () => {
    assert.ok(validateEffects([synthetic({ providers: [{ className: 'Druid', specs: ['Fury'] }] })]).some((p) => p.includes('not a roster specialization for Druid')))
    assert.ok(validateEffects([synthetic({ providers: [{ className: 'Druid', specs: [] }] })]).some((p) => p.includes('must not be empty')))
    assert.deepEqual(validateEffects([synthetic({ providers: [{ className: 'Druid', specs: ['Feral', 'Guardian'] }] })]), [])
  })
})

describe('tooltip provider text', () => {
  const team = [member('1', 'Druid', 'Feral'), member('2', 'Druid', 'Restoration'), member('3', 'Druid', 'Restoration'), member('4', 'Druid', 'Balance'), member('5', 'Warrior', 'Arms')]
  const tile = (id: string, members = team) => coverageTiles([catalog(id)], members)[0]

  it('names the eligible specializations, the talent requirement and the assumed spec', () => {
    assert.ok(tile('leader-of-the-pack').lines.includes('Eligible providers: Druid (Feral, Guardian; needs talent or rune; assumed for Feral)'))
  })

  it('separates assumed, possible and ineligible Druids and never shows a plain class count', () => {
    const lines = tile('leader-of-the-pack').lines
    assert.ok(lines.includes('Assumed from roster specialization (talent not tracked): Feral Druid'))
    assert.ok(lines.includes('Not eligible in this team: Balance Druid, Restoration Druid ×2'))
    assert.ok(!lines.some((line) => /Druid ×4|Druid ×3/.test(line)))
    assert.ok(!lines.some((line) => line.startsWith('Guaranteed in this team')))
    assert.ok(!lines.some((line) => line.startsWith('Possible in this team')))
  })

  it('shows an assumed Feral Druid as Estimated Available with the assumption explained', () => {
    const t = tile('leader-of-the-pack')
    assert.equal(t.statusLabel, 'Estimated Available')
    assert.equal(t.glyph, '✓')
    assert.ok(t.estimated)
    assert.ok(t.lines.some((line) => line.startsWith('Planning assumption, not a confirmed talent selection or verified Forever mechanic:') && line.includes('Feral Combat tree')))
  })

  it('keeps a Guardian Druid Possible, with no assumption wording', () => {
    const t = tile('leader-of-the-pack', [member('1', 'Druid', 'Guardian')])
    assert.equal(t.statusLabel, 'Estimated Potential')
    assert.ok(t.lines.includes('Possible in this team (talent, rune or specialization not confirmed): Guardian Druid'))
    assert.ok(!t.lines.some((line) => line.includes('Planning assumption') || line.startsWith('Assumed')))
  })

  it('does not list unrelated classes as ineligible', () => {
    assert.ok(!tile('leader-of-the-pack').lines.some((line) => line.includes('Warrior')))
  })

  it('lists guaranteed class-wide providers with their specs', () => {
    const lines = tile('mark-of-the-wild').lines
    assert.ok(lines.includes('Guaranteed in this team: Balance Druid, Feral Druid, Restoration Druid ×2'))
    assert.ok(!lines.some((line) => line.startsWith('Not eligible')))
  })

  it('says "none" and names ineligible specs when only the wrong specs are present', () => {
    const lines = tile('moonkin-form', [member('1', 'Druid', 'Restoration')]).lines
    assert.ok(lines.includes('In this team: none'))
    assert.ok(lines.includes('Not eligible in this team: Restoration Druid'))
  })

  it('flags a Druid whose specialization is not set as possible, not eligible', () => {
    const lines = tile('moonkin-form', [member('1', 'Druid', '')]).lines
    assert.ok(lines.includes('Possible in this team (talent, rune or specialization not confirmed): Druid (spec not set)'))
  })
})

describe('spec-assumed eligibility', () => {
  const assumedProvider = { className: 'Druid', specs: ['Feral', 'Guardian'], talent: 'T', assumed: { specs: ['Feral'], basis: 'Test basis for the assumption.' } }
  const provisional = (over: Partial<CoverageEffect> = {}) => synthetic({ providers: [assumedProvider], confidence: 'provisional', scopeStatus: 'provisional', verifiedOn: undefined, ...over })

  it('is a separate tier: only the named spec is assumed; other listed specs stay possible', () => {
    assert.equal(providerEligibility(assumedProvider, member('1', 'Druid', 'Feral')), 'assumed')
    assert.equal(providerEligibility(assumedProvider, member('1', 'Druid', 'Guardian')), 'possible')
    assert.equal(providerEligibility(assumedProvider, member('1', 'Druid', 'Restoration')), 'ineligible')
    for (const spec of ['', 'Fury', 'Unknown']) assert.equal(providerEligibility(assumedProvider, member('1', 'Druid', spec)), 'possible', spec)
    assert.equal(providerEligibility(assumedProvider, member('1', 'Hunter', 'Feral')), 'ineligible')
  })

  it('shows Estimated Available but never verified Available, even for a confirmed effect', () => {
    const provisionalReport = calculateCoverage([provisional()], [member('1', 'Druid', 'Feral')]).requirements[0]
    assert.equal(provisionalReport.status, 'unverified')
    assert.equal(provisionalReport.estimate.status, 'available')
    assert.equal(provisionalReport.basis, 'estimated')
    const confirmed = calculateCoverage([provisional({ confidence: 'confirmed', scopeStatus: 'confirmed', verifiedOn: '2026-01-01' })], [member('1', 'Druid', 'Feral')]).requirements[0]
    assert.equal(confirmed.status, 'potential')
    assert.equal(confirmed.estimate.status, 'available')
    assert.equal(confirmed.basis, 'estimated')
    assert.equal(confirmed.matches[0].eligibility, 'assumed')
  })

  it('keeps a fully confirmed guaranteed provider verified', () => {
    const r = calculateCoverage([synthetic({ providers: [{ className: 'Druid' }] })], [member('1', 'Druid', 'Feral')]).requirements[0]
    assert.deepEqual([r.status, r.estimate.status, r.basis], ['available', 'available', 'verified'])
  })

  it('does not count an assumed player as a second provider when two are required, unless both are assumed', () => {
    const two = provisional({ requirement: 2 })
    assert.equal(calculateCoverage([two], [member('1', 'Druid', 'Feral'), member('2', 'Druid', 'Guardian')]).requirements[0].estimate.status, 'potential')
    assert.equal(calculateCoverage([two], [member('1', 'Druid', 'Feral'), member('2', 'Druid', 'Feral')]).requirements[0].estimate.status, 'available')
  })

  it('lets an assumed provider take part in slot conflicts in the estimate, and be found Contested', () => {
    const a = provisional({ id: 'a', slot: 'shared' })
    const b = provisional({ id: 'b', slot: 'shared' })
    const solo = calculateCoverage([a, b], [member('1', 'Druid', 'Feral')])
    assert.deepEqual(solo.requirements.map((r) => r.estimate.status), ['contested', 'contested'])
    assert.deepEqual(solo.requirements.map((r) => r.status), ['unverified', 'unverified'])
    const pair = calculateCoverage([a, b], [member('1', 'Druid', 'Feral'), member('2', 'Druid', 'Feral')])
    assert.deepEqual(pair.requirements.map((r) => r.estimate.status), ['available', 'available'])
  })

  it('does not let a merely possible player (Guardian) rescue a slot conflict', () => {
    const a = provisional({ id: 'a', slot: 'shared' })
    const b = provisional({ id: 'b', slot: 'shared' })
    const report = calculateCoverage([a, b], [member('1', 'Druid', 'Feral'), member('2', 'Druid', 'Guardian')])
    assert.deepEqual(report.requirements.map((r) => r.estimate.status), ['contested', 'contested'])
  })

  it('does not depend on member order', () => {
    const team = [member('1', 'Druid', 'Guardian'), member('2', 'Druid', 'Feral'), member('3', 'Druid', 'Balance')]
    const result = (members: CoverageMember[]) => { const r = calculateCoverage([provisional()], members).requirements[0]; return [r.estimate.status, r.estimate.availableCount, r.estimate.potentialCount] }
    assert.deepEqual(result(team), result([...team].reverse()))
  })

  it('validates assumptions: they need a talent, specs listed in the provider, and a basis', () => {
    const problems = (provider: object) => validateEffects([synthetic({ providers: [{ className: 'Druid', specs: ['Feral'], talent: 'T', ...provider } as CoverageEffect['providers'][number]] })])
    assert.deepEqual(problems({ assumed: { specs: ['Feral'], basis: 'ok' } }), [])
    assert.ok(problems({ assumed: { specs: ['Balance'], basis: 'ok' } }).some((p) => p.includes('must also be listed')))
    assert.ok(problems({ assumed: { specs: [], basis: 'ok' } }).some((p) => p.includes('must not be empty')))
    assert.ok(problems({ assumed: { specs: ['Feral'], basis: ' ' } }).some((p) => p.includes('needs a basis')))
    assert.ok(problems({ talent: undefined, assumed: { specs: ['Feral'], basis: 'ok' } }).some((p) => p.includes('only apply to a provider with a talent')))
    assert.ok(validateEffects([synthetic({ providers: [{ className: 'Druid', talent: 'T', assumed: { specs: ['Feral'], basis: 'ok' } }] })]).some((p) => p.includes('needs specs')))
  })

  it('applies to Feral, Restoration, Balance and Guardian Druids and Hunter specs in the real catalog', () => {
    const status = (id: string, className: string, spec: string) => run(id, [member('1', className, spec)]).estimate.status
    assert.deepEqual(['Feral', 'Guardian', 'Restoration', 'Balance'].map((spec) => status('leader-of-the-pack', 'Druid', spec)), ['available', 'potential', 'missing', 'missing'])
    assert.deepEqual(['Feral', 'Guardian', 'Restoration', 'Balance'].map((spec) => status('moonkin-form', 'Druid', spec)), ['missing', 'missing', 'missing', 'available'])
    assert.deepEqual(['Marksmanship', 'Beast Mastery', 'Survival'].map((spec) => status('trueshot-aura', 'Hunter', spec)), ['potential', 'missing', 'missing'])
  })
})
