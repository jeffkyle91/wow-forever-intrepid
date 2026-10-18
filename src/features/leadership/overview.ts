import type { PlayerRecord } from '../../shared/game/players.ts'
import { raidStartDate } from '../../shared/lib/raidStart.ts'

type Member = { id: string; role: string; playerId?: string | null; displayName?: string }
type Readiness = { id: string; ready: boolean }
type Response = { id: string; characterId: string; status: string }
type ScheduledRaid = { id: string; date: string; time?: string; status?: string; startsAt?: { toMillis: () => number } }

export function upcomingLeadershipRaids<T extends ScheduledRaid>(raids: T[], now: number): T[] {
  const start = (raid: T) => raid.startsAt?.toMillis() ?? raidStartDate(raid.date, raid.time ?? '21:00').getTime()
  return raids.filter((raid) => raid.status !== 'cancelled' && start(raid) > now).sort((a, b) => start(a) - start(b) || a.id.localeCompare(b.id))
}

export function responseOverview<T extends Response>(members: Member[], roster: PlayerRecord[], readiness: Readiness[], responses: T[]) {
  const readyIds = new Set(readiness.filter((entry) => entry.ready).map((entry) => entry.id))
  const signups = new Map(responses.map((entry) => [entry.id, entry]))
  const active = members.filter((member) => ['Guild Leader', 'Raid Leader', 'Member'].includes(member.role))
  const accounts = active.map((member) => {
    const main = roster.find((character) => character.id === member.playerId && character.linkedUid === member.id && !character.mainId)
    const owned = main ? roster.filter((character) => character.id === main.id || (character.mainId === main.id && !character.linkedUid)) : []
    const ready = owned.filter((character) => readyIds.has(character.id))
    const response = signups.get(member.id)
    const selected = owned.find((character) => character.id === response?.characterId)
    const warning = response && ['accept', 'tentative', 'late'].includes(response.status) && (!selected || !readyIds.has(selected.id))
    return { member, main, ready, response, selected, warning: !!warning }
  })
  const eligible = accounts.filter((account) => account.main && account.ready.length > 0)
  return {
    eligible,
    missing: eligible.filter((account) => !account.response),
    warnings: accounts.filter((account) => account.warning),
    notReady: accounts.filter((account) => account.main && !account.ready.length),
    unlinked: accounts.filter((account) => !account.main),
    removed: members.length - active.length,
  }
}
