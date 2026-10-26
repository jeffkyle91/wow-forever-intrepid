export type EffectKind = 'raid-buff' | 'party-buff' | 'targeted-buff' | 'debuff'

// How sure we are that the effect works this way in WoW Forever.
export type Confidence = 'confirmed' | 'provisional' | 'unverified'

// Whether who the effect reaches (whole raid, party, one target, enemy) is known.
export type ScopeStatus = 'confirmed' | 'provisional' | 'unknown'

export type EffectVisibility = 'standard' | 'encounter' | 'excluded' | 'inactive'

// How far a roster player's class and specialization establish that they can provide an effect.
// guaranteed: the player can provide it with no talent or rune choice (counts towards Available).
// possible: they might, but a talent, rune or build choice, or an unreadable specialization, is unknown (Potential only).
// assumed: a talent provider whose specialization is named in the catalog's explicit `assumed` list. A raid-planning assumption,
//   not a confirmed talent selection. It counts as Available only in the estimate, never in the verified result.
// ineligible: their class, or a recognised specialization that is not listed, cannot provide it.
export type Eligibility = 'guaranteed' | 'assumed' | 'possible' | 'ineligible'

// An explicit, per-provider planning assumption: players on these specializations are assumed to have the provider's talent.
// It is never inferred from `specs` and never applied to other talents of the same specialization.
export type SpecAssumption = {
  // Must be a subset of the provider's `specs`.
  specs: string[]
  // Internal research basis for the assumption; not displayed in the coverage interface.
  basis: string
}

export type EffectProvider = {
  className: string
  // Roster specialization names (as in classSpecializations) that can provide the effect; other recognised specializations are
  // ineligible. Omitted means any specialization of the class. Listing a spec does NOT make a `talent` provider guaranteed:
  // choosing a spec does not prove a talent or rune was taken. A spec listed on a provider with no `talent` is guaranteed
  // only where Forever evidence shows the ability is intrinsic to that spec.
  specs?: string[]
  // Talent or rune that must be taken. The roster does not record talents, so such providers are only ever possible (Potential).
  talent?: string
  // Optional planning assumption for specific specializations of a `talent` provider (see SpecAssumption).
  assumed?: SpecAssumption
  note?: string
}

export type CoverageEffect = {
  id: string
  name: string
  kind: EffectKind
  // Effects with the same stackGroup do not stack or replace each other: they are one requirement with alternative providers.
  stackGroup?: string
  // Optional UI grouping, for example "offensive" or "enemy debuff".
  category?: string
  // Only where reliably sourced.
  spellId?: number
  // Preferred icon and fallback tooltip spell for its requirement. Without one, the first effect that has an icon is used.
  representative?: boolean
  // 'standard' (the default) appears in the everyday raid checklist. 'encounter' keeps researched data for encounter-specific needs
  // (for example resistance fights) and 'excluded' keeps an effect the owner removed from the checklist; neither is shown or counted.
  // An 'encounter' effect cannot share a stackGroup with other visibilities. An 'excluded' effect may share one with standard
  // alternatives, which then remain the requirement. 'inactive' keeps research on an ability suspected to be Season of Discovery only (not
  // proven to exist in Forever); it behaves like 'excluded' and must not be made 'standard' without Forever-specific evidence.
  visibility?: EffectVisibility
  // Minimum different eligible players. Planning uses the largest value among the group's catalog effects; research passes filter by confidence.
  // Use a number above 1 only when a verified mechanic requires it.
  requirement?: number
  // Effects sharing a slot compete for the same player: one player can fill at most one requirement per slot.
  // Only for raid-buff and debuff effects, and only where a WoW Forever source supports it. Example: "paladin-aura".
  slot?: string
  providers: EffectProvider[]
  confidence: Confidence
  scopeStatus: ScopeStatus
  sources: string[]
  notes?: string
  // ISO date (YYYY-MM-DD) the entry was last checked against the game.
  verifiedOn?: string
}

// A consumable that can stand in, usually more weakly, for a class-provided requirement. It is never counted as class coverage:
// it only matters once an organizer marks it as planned. List one only with Forever-specific evidence in `sources`.
export type ConsumableAlternative = {
  id: string
  name: string
  // The requirement it stands in for: the `stackGroup` (or the `id` of an ungrouped effect) in coverageData.ts.
  requirementKey: string
  // What it does, in words copied from a Forever source. Shown to the organizer.
  effect: string
  // How it is weaker or different from the class buff (duration, strength, scope).
  limitation: string
  // Icon source: a catalog-style spell ID looked up in spellIcons.ts, or a Wowhead icon name for an item.
  spellId?: number
  iconName?: string
  // 'unverified' entries are kept as research but cannot be planned.
  confidence: Confidence
  sources: string[]
  verifiedOn?: string
  notes?: string
}

export type CoverageMember = { id: string; name: string; className: string; specialization: string }

// Contested: providers exist, but competing effects cannot all be guaranteed at once.
// Indeterminate: the competition check hit its limit, so the result is unknown rather than guessed.
export type CoverageStatus = 'available' | 'contested' | 'missing' | 'potential' | 'unverified' | 'party-unknown' | 'indeterminate'

// One minimal set of requirements that cannot all be served together, although any smaller part of it can.
export type SlotConflict = {
  slot: string
  requirementKeys: string[]
  requirementNames: string[]
  // Provider slots the requirements need in total, and the most of them that can be filled at once.
  demand: number
  maxCoverable: number
  shortfall: number
}

export type LimitReason = {
  slot: string
  cause: 'node-limit' | 'too-many-requirements'
  nodeLimit: number
  nodesUsed: number
}

export type ProviderMatch = {
  playerId: string
  playerName: string
  className: string
  specialization: string
  effectId: string
  talent?: string
  // Never 'ineligible': an ineligible player produces no match. Only 'guaranteed' matches can make the verified result Available;
  // 'assumed' matches can also make the estimate Available.
  eligibility: 'guaranteed' | 'assumed' | 'possible'
  // Basis of the planning assumption, present only when eligibility is 'assumed'.
  assumption?: string
  // Only matches from confirmed effects count towards verified coverage.
  confirmed: boolean
  // Confirmed or provisional (provider and scope supported): counts towards the estimate. Unverified effects never do.
  estimable: boolean
}

// verified: every effect that counts is confirmed. estimated: at least one counted effect is only provisional.
// unverified: no effect has a supported provider and scope, so there is nothing to estimate from.
export type CoverageBasis = 'verified' | 'estimated' | 'unverified'

// Roster coverage computed from confirmed and provisional effects together. Equals the verified result when basis is 'verified'.
export type EstimateResult = {
  status: CoverageStatus
  required: number
  availableCount: number
  potentialCount: number
  conflict?: SlotConflict
  limitReason?: LimitReason
}

export type RequirementResult = {
  key: string
  name: string
  kind: EffectKind
  // Verified status: counts only confirmed effects, so it is Unverified until an effect is confirmed in game.
  status: CoverageStatus
  // Internal research confidence; never used as a user-facing warning.
  basis: CoverageBasis
  estimate: EstimateResult
  // Accepted-catalog planning result, independent of research confidence.
  planning: EstimateResult
  // Minimum different players needed, from the confirmed effects.
  required: number
  // Different players from confirmed effects who need no talent (they can satisfy the requirement).
  availableCount: number
  // Different players from confirmed effects including those who need a talent.
  potentialCount: number
  effects: CoverageEffect[]
  matches: ProviderMatch[]
  slot?: string
  // One verified witness for a Contested result (not every conflict).
  conflict?: SlotConflict
  // Present only on Indeterminate results.
  limitReason?: LimitReason
}

export type CoverageSummary = Record<CoverageStatus, number>

export type CoverageReport = {
  memberCount: number
  requirements: RequirementResult[]
  // Verified counts (confirmed effects only).
  summary: CoverageSummary
  // Counts by estimated status, which include provisional effects.
  estimateSummary: CoverageSummary
  // User-facing totals from the accepted catalog.
  planningSummary: CoverageSummary
  // Number of requirements with at least one confirmed effect (everything except Unverified).
  confirmedCount: number
  // Number of requirements whose estimate relies on at least one provisional effect.
  estimatedCount: number
  hasIndeterminate: boolean
  // Catalog validation errors (invalid slot setup). When present, no requirements are reported.
  catalogErrors: string[]
}
