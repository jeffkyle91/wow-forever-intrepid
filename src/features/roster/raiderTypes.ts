import type { RaiderType } from '../../guildApi'
import type { PlayerRecord } from '../../shared/game/players'

export type RosterRaiderType = { id: string; type: RaiderType }

export function normalizeRosterRaiderType(id: string, data: Record<string, unknown>): RosterRaiderType | null {
  return data.userId === id && (data.type === 'casual' || data.type === 'hardcore') ? { id, type: data.type } : null
}

export function raiderTypeOwner(player: PlayerRecord, rosterById: ReadonlyMap<string, PlayerRecord>): string | undefined {
  if (!player.mainId) return player.linkedUid
  const main = rosterById.get(player.mainId)
  return main && main.id !== player.id && !main.mainId ? main.linkedUid : undefined
}

export function raiderTypeLabel(type: RaiderType | undefined): string {
  return type === 'casual' ? 'Casual' : type === 'hardcore' ? 'Raider' : 'Not set'
}
