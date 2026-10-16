import type { GuildSettings, PlayerRecord, RaidRecord, TenManTeam } from '../../guildApi'
import { group40, groups20, tenManTeams } from '../game/teams.ts'

export function signupCharacters(roster: PlayerRecord[], uid: string): PlayerRecord[] {
  const main = uid ? roster.find((player) => player.linkedUid === uid && !player.mainId) : undefined
  return main ? [main, ...roster.filter((player) => player.mainId === main.id && (!player.linkedUid || player.linkedUid === uid))] : []
}

export function raidPreviewGroups(raid: RaidRecord, settings: GuildSettings): { key: string; name: string; size: number; parts: TenManTeam[] }[] {
  const sizes = new Set(raid.zones?.length ? raid.zones.map((zone) => zone.size) : [raid.size])
  return [
    ...(sizes.has(10) ? tenManTeams.map((team) => ({ key: team.key, name: settings.teamNames[team.key], size: 10, parts: [team.key] })) : []),
    ...groups20.filter(() => sizes.has(20)).map((group) => ({ ...group, name: settings.groupNames[group.key] })),
    ...(sizes.has(40) ? [{ ...group40, name: settings.groupNames[group40.key] }] : []),
  ]
}
