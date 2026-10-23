import { useState, type FormEvent } from 'react'
import { saveGuildSettings, type CouncilStatus, type GuildSettings, type RaidGroup, type StatusTone, type TenManTeam } from '../../guildApi'
import { SETTINGS_LABEL_MAX, councilStatuses, defaultGuildSettings, statusTones } from '../../shared/game/settings'
import { group40, groups20, tenManTeams } from '../../shared/game/teams'
import type { TabContext } from '../../shared/tabs/types'
import { PhasesPanel } from './PhasesPanel'
import { ZoneImagesPanel } from './ZoneImagesPanel'
import { ZonesPanel } from './ZonesPanel'
import { RaidAbsenceSync } from './RaidAbsenceSync'
import '../../shared/ui/spacing.css'
import './SettingsTab.css'

const allGroups = [...groups20, group40]

const sameSettings = (a: GuildSettings, b: GuildSettings) => JSON.stringify(a) === JSON.stringify(b)

function trimmed(settings: GuildSettings): GuildSettings {
  return {
    ...settings,
    currentPhase: settings.currentPhase.trim(),
    nextPhase: settings.nextPhase.trim(),
    currentStatusLabel: settings.currentStatusLabel.trim(),
    nextStatusLabel: settings.nextStatusLabel.trim(),
    teamNames: Object.fromEntries(tenManTeams.map((team) => [team.key, settings.teamNames[team.key].trim()])) as Record<TenManTeam, string>,
    groupNames: Object.fromEntries(allGroups.map((group) => [group.key, settings.groupNames[group.key].trim()])) as Record<RaidGroup, string>,
  }
}

function hasBlank(settings: GuildSettings) {
  return [settings.currentPhase, settings.nextPhase, settings.currentStatusLabel, settings.nextStatusLabel, ...tenManTeams.map((team) => settings.teamNames[team.key]), ...allGroups.map((group) => settings.groupNames[group.key])].some((value) => !value)
}

export function SettingsTab({ ctx }: { ctx: TabContext }) {
  const saved = ctx.data.settings
  // Restart the draft from what is stored whenever the stored settings change (after a save, or an edit by another leader).
  return <><SettingsForm key={JSON.stringify(saved)} saved={saved} ctx={ctx} /><PhasesPanel ctx={ctx} /><ZonesPanel ctx={ctx} /><ZoneImagesPanel ctx={ctx} /><RaidAbsenceSync ctx={ctx} /></>
}

function SettingsForm({ saved, ctx }: { saved: GuildSettings; ctx: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = ctx.feedback
  const [draft, setDraft] = useState<GuildSettings>(saved)
  const cleaned = trimmed(draft)
  const blank = hasBlank(cleaned)
  const changed = !sameSettings(cleaned, saved)
  const set = <K extends keyof GuildSettings>(key: K, value: GuildSettings[K]) => setDraft((current) => ({ ...current, [key]: value }))

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (blank) return
    setBusy(true)
    try {
      await saveGuildSettings(cleaned)
      setMutationError('')
      setNotice('Settings saved.')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not save settings.')
    } finally {
      setBusy(false)
    }
  }

  const text = (label: string, key: 'currentPhase' | 'nextPhase' | 'currentStatusLabel' | 'nextStatusLabel') => (
    <label className="settings-field">{label}<input value={draft[key]} maxLength={SETTINGS_LABEL_MAX} onChange={(event) => set(key, event.target.value)} disabled={busy} /></label>
  )

  const tone = (label: string, key: 'currentStatusTone' | 'nextStatusTone') => (
    <label className="settings-field">{label}<select value={draft[key]} onChange={(event) => set(key, event.target.value as StatusTone)} disabled={busy}>{statusTones.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  )

  const teamField = (key: string, fallbackName: string, value: string, onChange: (value: string) => void) => (
    <label className="settings-field settings-team-field" key={key}><span className={`team-color-mark mark-${key}`} aria-hidden="true" /><input aria-label={`${fallbackName} team name`} value={value} maxLength={SETTINGS_LABEL_MAX} onChange={(event) => onChange(event.target.value)} disabled={busy} /></label>
  )

  return <form className="settings-form" onSubmit={save}>
    <section className="settings-section">
      <header><h3>Phase</h3><p>Shown in the bottom left of the sidebar for every member. Each phase has its own status indicator beside it.</p></header>
      <div className="settings-grid">{text('Current phase', 'currentPhase')}{text('Current phase status label', 'currentStatusLabel')}{tone('Current phase indicator color', 'currentStatusTone')}</div>
      <div className="settings-grid">{text('Next phase', 'nextPhase')}{text('Next phase status label', 'nextStatusLabel')}{tone('Next phase indicator color', 'nextStatusTone')}</div>
    </section>
    <section className="settings-section">
      <header><h3>Council status</h3><p>Tells members whether loot priorities are still being discussed or are set. It is informational and does not block awards.</p></header>
      <div className="settings-choice" role="radiogroup" aria-label="Council status">
        {councilStatuses.map((status) => <label key={status.value} className={`settings-choice-option${draft.councilStatus === status.value ? ' is-selected' : ''}`}><input type="radio" name="council-status" value={status.value} checked={draft.councilStatus === status.value} onChange={() => set('councilStatus', status.value as CouncilStatus)} disabled={busy} /><strong>{status.label}</strong><small>{status.hint}</small></label>)}
      </div>
    </section>
    <section className="settings-section">
      <header><h3>Raid team names</h3><p>Rename the independent standing teams. Each size has its own assignments; 20- and 40-player teams do not combine smaller teams.</p></header>
      <div className="settings-team-group">
        <h4>10-player teams</h4>
        <div className="settings-grid settings-grid-four">{tenManTeams.map((team) => teamField(team.key, defaultGuildSettings.teamNames[team.key], draft.teamNames[team.key], (value) => setDraft((current) => ({ ...current, teamNames: { ...current.teamNames, [team.key]: value } }))))}</div>
      </div>
      <div className="settings-team-group">
        <h4>20-player teams</h4>
        <div className="settings-grid settings-grid-two">{groups20.map((group) => teamField(group.key, defaultGuildSettings.groupNames[group.key], draft.groupNames[group.key], (value) => setDraft((current) => ({ ...current, groupNames: { ...current.groupNames, [group.key]: value } }))))}</div>
      </div>
      <div className="settings-team-group">
        <h4>40-player team</h4>
        <div className="settings-grid settings-grid-two">{teamField(group40.key, defaultGuildSettings.groupNames[group40.key], draft.groupNames[group40.key], (value) => setDraft((current) => ({ ...current, groupNames: { ...current.groupNames, [group40.key]: value } })))}</div>
      </div>
    </section>
    {blank && <p className="settings-error" role="alert">Every field needs a value.</p>}
    <div className="settings-actions">
      <button type="button" className="button button-secondary" onClick={() => setDraft(saved)} disabled={busy || !changed}>Reset</button>
      <button type="submit" className="button button-primary" disabled={busy || blank || !changed}>Save settings</button>
    </div>
  </form>
}
