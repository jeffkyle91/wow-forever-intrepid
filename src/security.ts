export type GuildRole = 'Guild Leader' | 'Raid Leader' | 'Member'

export const guildRoles: GuildRole[] = ['Guild Leader', 'Raid Leader', 'Member']

export function canManageRoster(role: GuildRole) {
  return role === 'Guild Leader'
}

export function canManageRaidData(role: GuildRole) {
  return role === 'Guild Leader' || role === 'Raid Leader'
}
