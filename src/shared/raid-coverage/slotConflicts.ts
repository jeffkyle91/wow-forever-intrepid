// Exact conflict classification for requirements that compete for one provider slot (one slot fills at most one requirement per player).
// A requirement is Contested when it belongs to a minimal infeasible set of requirements, Available when it belongs to none.
// The search is exact and deterministic. If it cannot finish within the node limit the answer is Indeterminate, never a guess.

export const DEFAULT_NODE_LIMIT = 20000
// Requirements are tracked in a 31-bit mask, so one group of competing requirements may hold at most this many.
export const MAX_GROUP_SIZE = 30

export type SlotRequirement = {
  key: string
  // Different players still needed from this slot.
  demand: number
  eligible: string[]
}

export type SlotOutcome =
  | { status: 'available' }
  | { status: 'missing' }
  | { status: 'contested'; witness: string[]; demand: number; maxCoverable: number }
  | { status: 'indeterminate'; cause: 'node-limit' | 'too-many-requirements'; nodesUsed: number }

const LIMIT = Symbol('node limit')
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function classifySlot(requirements: SlotRequirement[], nodeLimit: number = DEFAULT_NODE_LIMIT): Map<string, SlotOutcome> {
  const outcomes = new Map<string, SlotOutcome>()
  const live: SlotRequirement[] = []
  for (const requirement of [...requirements].sort((a, b) => compare(a.key, b.key))) {
    const eligible = [...new Set(requirement.eligible)].sort(compare)
    if (eligible.length < requirement.demand) outcomes.set(requirement.key, { status: 'missing' })
    else live.push({ ...requirement, eligible })
  }

  // Requirements that share no eligible player can never conflict, so each connected group is solved on its own.
  const parent = live.map((_, index) => index)
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])))
  const firstWith = new Map<string, number>()
  live.forEach((requirement, index) => {
    for (const player of requirement.eligible) {
      const seen = firstWith.get(player)
      if (seen === undefined) firstWith.set(player, index)
      else parent[find(index)] = find(seen)
    }
  })
  const groups = new Map<number, SlotRequirement[]>()
  live.forEach((requirement, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), requirement]))

  for (const group of groups.values()) solveGroup(group, nodeLimit, outcomes)
  return outcomes
}

function solveGroup(group: SlotRequirement[], nodeLimit: number, outcomes: Map<string, SlotOutcome>) {
  if (group.length > MAX_GROUP_SIZE) {
    for (const requirement of group) outcomes.set(requirement.key, { status: 'indeterminate', cause: 'too-many-requirements', nodesUsed: 0 })
    return
  }
  // Largest demand first, then key: a fixed order, so the result never depends on how the input was listed.
  const reqs = [...group].sort((a, b) => b.demand - a.demand || compare(a.key, b.key))
  const count = reqs.length
  const bit = (index: number) => 1 << index
  const cache = new Map<number, boolean>()

  // Most units of the chosen requirements that can be given distinct players.
  function fill(mask: number): { placed: number; total: number } {
    const units: number[] = []
    for (let i = 0; i < count; i++) if (mask & bit(i)) for (let n = 0; n < reqs[i].demand; n++) units.push(i)
    const owner = new Map<string, number>()
    const place = (unit: number, seen: Set<string>): boolean => {
      for (const player of reqs[units[unit]].eligible) {
        if (seen.has(player)) continue
        seen.add(player)
        const holder = owner.get(player)
        if (holder === undefined || place(holder, seen)) {
          owner.set(player, unit)
          return true
        }
      }
      return false
    }
    let placed = 0
    for (let unit = 0; unit < units.length; unit++) if (place(unit, new Set())) placed += 1
    return { placed, total: units.length }
  }

  function feasible(mask: number): boolean {
    if (mask === 0) return true
    const known = cache.get(mask)
    if (known !== undefined) return known
    const { placed, total } = fill(mask)
    cache.set(mask, placed === total)
    return placed === total
  }

  const everything = count === 32 ? -1 : (1 << count) - 1
  if (feasible(everything)) {
    for (const requirement of reqs) outcomes.set(requirement.key, { status: 'available' })
    return
  }

  const witnesses = new Map<number, number>()
  for (let target = 0; target < count; target++) {
    if (witnesses.has(target)) continue
    const targetBit = bit(target)
    const others: number[] = []
    for (let i = 0; i < count; i++) if (i !== target) others.push(i)
    // suffix[i] is every requirement from position i onward, for pruning.
    const suffix = new Array<number>(others.length + 1).fill(0)
    for (let i = others.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] | bit(others[i])

    let used = 0
    // Looks for a feasible set that becomes infeasible once the target is added.
    const search = (from: number, chosen: number): number | null => {
      used += 1
      if (used > nodeLimit) throw LIMIT
      if (!feasible(chosen | targetBit)) return chosen
      // Adding every remaining requirement still leaves room for the target, and feasibility only improves with fewer requirements.
      if (feasible(chosen | suffix[from] | targetBit)) return null
      for (let i = from; i < others.length; i++) {
        const next = chosen | bit(others[i])
        if (!feasible(next)) continue
        const found = search(i + 1, next)
        if (found !== null) return found
      }
      return null
    }

    try {
      const blocker = search(0, 0)
      if (blocker === null) {
        outcomes.set(reqs[target].key, { status: 'available' })
        continue
      }
      // Shrink to a minimal infeasible set that still contains the target.
      let conflict = blocker | targetBit
      for (let i = 0; i < count; i++) {
        if (i !== target && conflict & bit(i) && !feasible(conflict & ~bit(i))) conflict &= ~bit(i)
      }
      for (let i = 0; i < count; i++) if (conflict & bit(i) && !witnesses.has(i)) witnesses.set(i, conflict)
    } catch (error) {
      if (error !== LIMIT) throw error
      outcomes.set(reqs[target].key, { status: 'indeterminate', cause: 'node-limit', nodesUsed: used })
    }
  }

  for (const [index, conflict] of witnesses) {
    const members = reqs.filter((_, i) => conflict & bit(i))
    const { placed, total } = fill(conflict)
    outcomes.set(reqs[index].key, { status: 'contested', witness: members.map((member) => member.key), demand: total, maxCoverable: placed })
  }
}
