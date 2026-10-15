import type { CouncilStatus, GuildSettings, StatusTone } from '../../guildApi'

export const SETTINGS_LABEL_MAX = 40

export const statusTones: { value: StatusTone; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'paused', label: 'Paused' },
]

export const councilStatuses: { value: CouncilStatus; label: string; hint: string }[] = [
  { value: 'deliberating', label: 'Deliberating', hint: 'Priorities are still being discussed.' },
  { value: 'live', label: 'Live', hint: 'Priorities are set and being acted on.' },
]

// What the app shows until a Guild Leader saves settings, and for any field that cannot be read.
export const defaultGuildSettings: GuildSettings = {
  currentPhase: 'Launch prep',
  nextPhase: 'To be announced',
  statusLabel: 'Preparing',
  statusTone: 'preparing',
  councilStatus: 'deliberating',
  teamNames: { blue: 'Blue', yellow: 'Yellow', red: 'Red', white: 'White' },
}

const label = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.slice(0, SETTINGS_LABEL_MAX) : fallback)

/** Reads a settings document tolerantly: every missing or invalid field falls back to its default. Never throws. */
export function resolveGuildSettings(data: Record<string, unknown> | null | undefined): GuildSettings {
  const defaults = defaultGuildSettings
  const source = data ?? {}
  const names = source.teamNames && typeof source.teamNames === 'object' ? (source.teamNames as Record<string, unknown>) : {}
  return {
    currentPhase: label(source.currentPhase, defaults.currentPhase),
    nextPhase: label(source.nextPhase, defaults.nextPhase),
    statusLabel: label(source.statusLabel, defaults.statusLabel),
    statusTone: statusTones.some((tone) => tone.value === source.statusTone) ? (source.statusTone as StatusTone) : defaults.statusTone,
    councilStatus: councilStatuses.some((status) => status.value === source.councilStatus) ? (source.councilStatus as CouncilStatus) : defaults.councilStatus,
    teamNames: {
      blue: label(names.blue, defaults.teamNames.blue),
      yellow: label(names.yellow, defaults.teamNames.yellow),
      red: label(names.red, defaults.teamNames.red),
      white: label(names.white, defaults.teamNames.white),
    },
  }
}
