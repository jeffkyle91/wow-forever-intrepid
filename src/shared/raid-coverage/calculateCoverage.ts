import type {
  CoverageEffect,
  CoverageMember,
  CoverageReport,
  CoverageStatus,
  CoverageSummary,
  EffectProvider,
  Eligibility,
  ProviderMatch,
  RequirementResult,
} from './types.ts'
import { classSpecializations } from '../../shared/game/classes.ts'
import { classifySlot, DEFAULT_NODE_LIMIT, type SlotRequirement } from './slotConflicts.ts'

const norm = (value: string) => value.trim().toLowerCase()

// Label only: the most cautious scope among a requirement's effects. Evaluation judges each provider's own scope.
const cautionOrder: CoverageEffect['kind'][] = ['raid-buff', 'debuff', 'party-buff', 'targeted-buff']
export const groupKind = (group: CoverageEffect[]): CoverageEffect['kind'] => group.map((effect) => effect.kind).reduce((a, b) => (cautionOrder.indexOf(b) > cautionOrder.indexOf(a) ? b : a))

// Only raid-wide buffs and enemy debuffs take part in slot matching in v1; a slot on any other kind is ignored.
export const slotKinds: CoverageEffect['kind'][] = ['raid-buff', 'debuff']
const slotOf = (effect: CoverageEffect) => (slotKinds.includes(effect.kind) ? effect.slot : undefined)

// Invalid slot setups are catalog errors, not calculation limits. Shared by validateEffects and calculateCoverage.
export function slotProblems(effects: CoverageEffect[]): string[] {
  const problems: string[] = []
  const groupSlots = new Map<string, Set<string>>()
  for (const effect of effects) {
    if (effect.slot === undefined) continue
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(effect.slot)) problems.push(`${effect.id}: slot must be lowercase words joined by hyphens`)
    if (!slotKinds.includes(effect.kind)) {
      problems.push(`${effect.id}: slot is not allowed on ${effect.kind} entries; only raid-buff and debuff entries take part in slot matching`)
      continue
    }
    const key = effect.stackGroup ?? effect.id
    groupSlots.set(key, new Set([...(groupSlots.get(key) ?? []), effect.slot]))
  }
  for (const [key, slots] of groupSlots) if (slots.size > 1) problems.push(`${key}: stack group mixes slots (${[...slots].sort().join(', ')})`)
  return problems
}

// Whether a roster specialization is a real, readable value for the class. Classes outside the roster table cannot be checked,
// so any non-blank value counts as readable there. A blank or unrecognised value is never trusted to rule a player in or out.
function specKnown(className: string, specialization: string) {
  if (!norm(specialization)) return false
  const known = Object.entries(classSpecializations).find(([name]) => norm(name) === norm(className))?.[1]
  return !known || known.some((option) => norm(option.name) === norm(specialization))
}

// Roster class and specialization against one provider rule. 'assumed' needs an explicit catalog assumption for that exact spec.
export function providerEligibility(provider: EffectProvider, member: CoverageMember): Eligibility {
  if (norm(provider.className) !== norm(member.className)) return 'ineligible'
  const needsChoice: Eligibility = provider.talent ? 'possible' : 'guaranteed'
  if (!provider.specs) return needsChoice
  if (provider.specs.some((spec) => norm(spec) === norm(member.specialization))) {
    const assumed = provider.talent && provider.assumed?.specs.some((spec) => norm(spec) === norm(member.specialization))
    return assumed ? 'assumed' : needsChoice
  }
  // A recognised spec that is not listed cannot provide it. An unreadable spec stays possible, never guaranteed or assumed.
  return specKnown(member.className, member.specialization) ? 'ineligible' : 'possible'
}

export const providerMatches = (provider: EffectProvider, member: CoverageMember) => providerEligibility(provider, member) !== 'ineligible'

const isConfirmed = (effect: CoverageEffect) => effect.confidence === 'confirmed' && effect.scopeStatus === 'confirmed'
// Supported enough to estimate from: confirmed or provisional, with a known scope. An unverified effect, or one with unknown scope, never counts.
const isEstimable = (effect: CoverageEffect) => effect.confidence !== 'unverified' && effect.scopeStatus !== 'unknown'

type Mode = 'verified' | 'estimated' | 'planning'
const counted = (effect: CoverageEffect, mode: Mode) => (mode === 'planning' || (mode === 'verified' ? isConfirmed(effect) : isEstimable(effect)))
const matchCounted = (match: ProviderMatch, mode: Mode) => (mode === 'planning' || (mode === 'verified' ? match.confirmed : match.estimable))
// An explicit specialization assumption supplies planning and estimated coverage, never verified coverage.
const providesNow = (match: ProviderMatch, mode: Mode) => match.eligibility === 'guaranteed' || (match.eligibility === 'assumed' && mode !== 'verified')
const rank: Record<'guaranteed' | 'assumed' | 'possible', number> = { guaranteed: 0, assumed: 1, possible: 2 }

function matchesFor(effect: CoverageEffect, members: CoverageMember[]): ProviderMatch[] {
  const matches: ProviderMatch[] = []
  for (const member of members) {
    // One match per player and effect, preferring guaranteed over assumed over possible.
    const options = effect.providers
      .map((provider) => ({ provider, eligibility: providerEligibility(provider, member) }))
      .filter((option): option is { provider: EffectProvider; eligibility: 'guaranteed' | 'assumed' | 'possible' } => option.eligibility !== 'ineligible')
      .sort((a, b) => rank[a.eligibility] - rank[b.eligibility])
    const best = options[0]
    if (!best) continue
    matches.push({
      playerId: member.id,
      playerName: member.name,
      className: member.className,
      specialization: member.specialization,
      effectId: effect.id,
      talent: best.provider.talent,
      eligibility: best.eligibility,
      assumption: best.eligibility === 'assumed' ? best.provider.assumed?.basis : undefined,
      confirmed: isConfirmed(effect),
      estimable: isEstimable(effect),
    })
  }
  return matches
}

const uniqueMembers = (members: CoverageMember[]) => [...new Map(members.map((member) => [member.id, member])).values()]

// Different players only: a player counts once however many effects or providers they match.
function countPlayers(matches: ProviderMatch[], mode: Mode) {
  const potential = new Set<string>()
  const available = new Set<string>()
  for (const match of matches) {
    if (!matchCounted(match, mode)) continue
    potential.add(match.playerId)
    if (providesNow(match, mode)) available.add(match.playerId)
  }
  return { available: available.size, potential: potential.size }
}

// party counts players of party-wide effects only. They never satisfy a requirement, but they keep it from reading as Missing.
function statusFor(effects: CoverageEffect[], required: number, counts: { available: number; potential: number }, party: { available: number; potential: number }, mode: Mode): CoverageStatus {
  const usable = effects.filter((effect) => counted(effect, mode))
  if (!usable.length) return 'unverified'
  // Party membership is not tracked, so a party buff can never be shown as covered.
  if (usable.every((effect) => effect.kind === 'party-buff')) return 'party-unknown'
  if (counts.available >= required) return 'available'
  if (party.available > 0) return 'party-unknown'
  if (counts.potential >= required || party.potential > 0) return 'potential'
  return 'missing'
}

type Evaluated = Omit<RequirementResult, 'basis' | 'estimate' | 'planning'>

// One pass over every requirement, counting only the effects `mode` allows. Planning accepts the entire supplied catalog. Raid-wide buffs and enemy debuffs that share a slot
// are then checked for conflicts (see slotConflicts.ts).
function evaluate(groups: Map<string, CoverageEffect[]>, members: CoverageMember[], nodeLimit: number, mode: Mode): Evaluated[] {
  const slotBuckets = new Map<string, SlotRequirement[]>()
  const requirements: Evaluated[] = [...groups].map(([key, group]) => {
    const matches = group.flatMap((effect) => matchesFor(effect, members))
    const required = Math.max(1, ...group.filter((effect) => counted(effect, mode)).map((effect) => effect.requirement ?? 1))
    // Scope is judged per provider: a party-wide alternative never makes a raid-wide one party-limited, nor the reverse.
    const partyIds = new Set(group.filter((effect) => effect.kind === 'party-buff').map((effect) => effect.id))
    const allParty = group.filter((effect) => counted(effect, mode)).every((effect) => effect.kind === 'party-buff')
    const wide = matches.filter((match) => !partyIds.has(match.effectId))
    const counts = countPlayers(allParty ? matches : wide, mode)
    const party = allParty ? { available: 0, potential: 0 } : countPlayers(matches.filter((match) => partyIds.has(match.effectId)), mode)
    const result: Evaluated = {
      key,
      name: group.map((effect) => effect.name).join(' / '),
      kind: groupKind(group),
      status: statusFor(group, required, counts, party, mode),
      required,
      availableCount: counts.available,
      potentialCount: counts.potential,
      effects: group,
      matches,
    }

    const slots = [...new Set(group.filter((effect) => counted(effect, mode)).map(slotOf).filter((slot): slot is string => slot !== undefined))].sort()
    if (slots.length) result.slot = slots[0]
    // Only a requirement that is Available on its own can turn out Contested or Indeterminate.
    // Potential, Missing, Party Unknown and Unverified are final here, so providers that only might have a talent never enter the
    // search. In the estimate, assumed providers do enter it, so their slot conflicts are found like any other.
    if (result.status !== 'available' || !slots.length) return result

    const byEffect = new Map(group.map((effect) => [effect.id, effect]))
    const playersFor = (wantSlotted: boolean) => new Set(wide
      .filter((match) => matchCounted(match, mode) && providesNow(match, mode) && (slotOf(byEffect.get(match.effectId)!) !== undefined) === wantSlotted)
      .map((match) => match.playerId))
    // Players who provide it through an effect with no slot need no slot, so they never compete.
    const free = playersFor(false)
    const demand = Math.max(0, required - free.size)
    if (demand > 0) {
      const eligible = [...playersFor(true)].filter((id) => !free.has(id))
      slotBuckets.set(slots[0], [...(slotBuckets.get(slots[0]) ?? []), { key, demand, eligible }])
    }
    return result
  })

  const byKey = new Map(requirements.map((requirement) => [requirement.key, requirement]))
  for (const [slot, bucket] of slotBuckets) {
    for (const [key, outcome] of classifySlot(bucket, nodeLimit)) {
      const result = byKey.get(key)!
      if (outcome.status === 'missing') result.status = 'missing'
      else if (outcome.status === 'contested') {
        result.status = 'contested'
        result.conflict = {
          slot,
          requirementKeys: outcome.witness,
          requirementNames: outcome.witness.map((member) => byKey.get(member)?.name ?? member),
          demand: outcome.demand,
          maxCoverable: outcome.maxCoverable,
          shortfall: outcome.demand - outcome.maxCoverable,
        }
      } else if (outcome.status === 'indeterminate') {
        result.status = 'indeterminate'
        result.limitReason = { slot, cause: outcome.cause, nodeLimit, nodesUsed: outcome.nodesUsed }
      }
    }
  }
  return requirements
}

const emptySummary = (): CoverageSummary => ({ available: 0, contested: 0, missing: 0, potential: 0, unverified: 0, 'party-unknown': 0, indeterminate: 0 })

// Effects that share a stackGroup are one requirement, so alternative providers never double-count.
// Research results are retained: `status` counts confirmed effects and `estimate` also counts provisional ones.
// The user-facing `planning` result accepts every catalog effect, preserving eligibility, scope, demand and slot rules.
export function calculateCoverage(effects: CoverageEffect[], players: CoverageMember[], options: { nodeLimit?: number } = {}): CoverageReport {
  const nodeLimit = options.nodeLimit ?? DEFAULT_NODE_LIMIT
  const members = uniqueMembers(players)
  // A broken catalog claims nothing: no requirement is reported, so none can be wrongly Available.
  const catalogErrors = slotProblems(effects)
  if (catalogErrors.length) {
    return {
      memberCount: members.length,
      requirements: [],
      summary: emptySummary(),
      estimateSummary: emptySummary(),
      planningSummary: emptySummary(),
      confirmedCount: 0,
      estimatedCount: 0,
      hasIndeterminate: false,
      catalogErrors,
    }
  }
  const groups = new Map<string, CoverageEffect[]>()
  for (const effect of effects) {
    const key = effect.stackGroup ?? effect.id
    groups.set(key, [...(groups.get(key) ?? []), effect])
  }

  const verified = evaluate(groups, members, nodeLimit, 'verified')
  const estimated = new Map(evaluate(groups, members, nodeLimit, 'estimated').map((requirement) => [requirement.key, requirement]))
  const planning = new Map(evaluate(groups, members, nodeLimit, 'planning').map((requirement) => [requirement.key, requirement]))
  const requirements: RequirementResult[] = verified.map((requirement) => {
    const estimate = estimated.get(requirement.key)!
    const usable = requirement.effects.filter(isEstimable)
    const basis = !usable.length ? 'unverified' : usable.every(isConfirmed) && estimate.status === requirement.status ? 'verified' : 'estimated'
    return {
      ...requirement,
      basis,
      planning: planning.get(requirement.key)!,
      estimate: {
        status: estimate.status,
        required: estimate.required,
        availableCount: estimate.availableCount,
        potentialCount: estimate.potentialCount,
        conflict: estimate.conflict,
        limitReason: estimate.limitReason,
      },
    }
  })

  const summary = emptySummary()
  const estimateSummary = emptySummary()
  const planningSummary = emptySummary()
  for (const requirement of requirements) {
    summary[requirement.status] += 1
    estimateSummary[requirement.estimate.status] += 1
    planningSummary[requirement.planning.status] += 1
  }
  return {
    memberCount: members.length,
    requirements,
    summary,
    estimateSummary,
    planningSummary,
    confirmedCount: requirements.length - summary.unverified,
    estimatedCount: requirements.filter((requirement) => requirement.basis === 'estimated').length,
    hasIndeterminate: estimateSummary.indeterminate > 0,
    catalogErrors: [],
  }
}

// Header text for the collapsed panel, using accepted-catalog planning counts.
export function summaryText(report: CoverageReport): string {
  if (report.catalogErrors.length) return `Catalog error (${report.catalogErrors.length})`
  if (!report.requirements.length) return 'No coverage data yet'
  const summary = report.planningSummary
  const parts = [`${summary.available} available`]
  if (summary.contested) parts.push(`${summary.contested} contested`)
  parts.push(`${summary.missing} missing`, `${summary.potential} potential`)
  if (summary.indeterminate) parts.push(`${summary.indeterminate} not calculated`)
  if (summary['party-unknown']) parts.push(`${summary['party-unknown']} party unknown`)
  return parts.join(', ')
}


// Problems with the data file itself, for the tests and for anyone editing it.
export function validateEffects(effects: CoverageEffect[]): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const groupKinds = new Map<string, string>()
  const groupVisibility = new Map<string, Set<string>>()
  for (const effect of effects) {
    if (ids.has(effect.id)) problems.push(`Duplicate id: ${effect.id}`)
    ids.add(effect.id)
    if (!effect.sources.length) problems.push(`${effect.id}: no source`)
    if (!effect.providers.length) problems.push(`${effect.id}: no providers`)
    for (const provider of effect.providers) {
      if (!provider.specs) continue
      if (!provider.specs.length) problems.push(`${effect.id}: ${provider.className} specs must not be empty (omit it for any spec)`)
      const known = Object.entries(classSpecializations).find(([name]) => norm(name) === norm(provider.className))?.[1]
      for (const spec of provider.specs) {
        if (known && !known.some((option) => norm(option.name) === norm(spec))) problems.push(`${effect.id}: "${spec}" is not a roster specialization for ${provider.className}`)
      }
      if (provider.assumed) {
        const { assumed } = provider
        if (!provider.talent) problems.push(`${effect.id}: ${provider.className} assumed specs only apply to a provider with a talent`)
        if (!assumed.specs.length) problems.push(`${effect.id}: ${provider.className} assumed specs must not be empty`)
        if (!assumed.basis.trim()) problems.push(`${effect.id}: ${provider.className} assumption needs a basis`)
        for (const spec of assumed.specs) {
          if (!provider.specs.some((listed) => norm(listed) === norm(spec))) problems.push(`${effect.id}: assumed spec "${spec}" must also be listed in ${provider.className} specs`)
        }
      }
    }
    if (effect.providers.some((provider) => provider.assumed && !provider.specs)) problems.push(`${effect.id}: an assumption needs specs`)
    if (effect.verifiedOn && !/^\d{4}-\d{2}-\d{2}$/.test(effect.verifiedOn)) problems.push(`${effect.id}: verifiedOn must be YYYY-MM-DD`)
    if (effect.confidence === 'confirmed' && !effect.verifiedOn) problems.push(`${effect.id}: confirmed entries need verifiedOn`)
    if (effect.requirement !== undefined && (!Number.isInteger(effect.requirement) || effect.requirement < 1)) problems.push(`${effect.id}: requirement must be a whole number of at least 1`)
    if (effect.spellId !== undefined && (!Number.isInteger(effect.spellId) || effect.spellId < 1)) problems.push(`${effect.id}: spellId must be a positive whole number`)
    if (effect.requirement && effect.requirement > 1 && effect.kind === 'party-buff') problems.push(`${effect.id}: a party buff cannot have a provider requirement because party groups are not tracked`)
    // Buff scopes may differ inside a group (so one effect can change scope alone); a debuff and a buff cannot be alternatives.
    const key = effect.stackGroup ?? effect.id
    const side = effect.kind === 'debuff' ? 'debuff' : 'buff'
    const seen = groupKinds.get(key)
    if (seen && seen !== side) problems.push(`${key}: stack group mixes kinds (buffs and debuffs cannot share a group)`)
    groupKinds.set(key, side)
    if (effect.visibility !== undefined && !['standard', 'encounter', 'excluded', 'inactive'].includes(effect.visibility)) problems.push(`${effect.id}: visibility must be 'standard', 'encounter', 'excluded' or 'inactive'`)
    const visibilities = groupVisibility.get(key) ?? new Set<string>()
    visibilities.add(effect.visibility ?? 'standard')
    groupVisibility.set(key, visibilities)
  }
  for (const [key, visibilities] of groupVisibility) {
    if (visibilities.has('encounter') && visibilities.size > 1) problems.push(`${key}: stack group mixes encounter-specific effects with other visibilities`)
  }
  problems.push(...slotProblems(effects))
  return problems
}
