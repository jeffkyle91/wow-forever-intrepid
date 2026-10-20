import type { RaidGroup, StandingTeam } from '../../guildApi.ts'
import { group40, groups20, type RaidView, type TeamOption } from '../../shared/game/teams.ts'
import type { CoverageMember } from './types.ts'

export type CoverageTarget = { key: string; name: string; parts: StandingTeam[] }

// 10: Blue, Yellow, Red, White. 20: Green and Pink. 40: Brown.
export function coverageTargets(view: RaidView, teams: TeamOption[], groupNames: Record<RaidGroup, string>): CoverageTarget[] {
  if (view === 10) return teams.map((team) => ({ key: team.key, name: team.name, parts: [team.key] }))
  if (view === 20) return groups20.map((group) => ({ key: group.key, name: groupNames[group.key], parts: [group.key] }))
  return [{ key: group40.key, name: groupNames[group40.key], parts: [group40.key] }]
}

// Only players actually assigned to one of the target's teams.
export function assignedMembers(parts: StandingTeam[], players: CoverageMember[], assignments: Record<string, StandingTeam>): CoverageMember[] {
  const seen = new Set<string>()
  return players.filter((player) => {
    if (!parts.includes(assignments[player.id]) || seen.has(player.id)) return false
    seen.add(player.id)
    return true
  })
}
