import { useState, type FormEvent } from 'react'
import { saveGuildSettings, type CouncilStatus, type GuildSettings, type StatusTone, type TenManTeam } from '../../guildApi'
import { SETTINGS_LABEL_MAX, councilStatuses, defaultGuildSettings, statusTones } from '../../shared/game/settings'
import { tenManTeams } from '../../shared/game/teams'
import type { TabContext } from '../../shared/tabs/types'
import './SettingsTab.css'

const sameSettings = (a: GuildSettings, b: GuildSettings) => JSON.stringify(a) === JSON.stringify(b)

function trimmed(settings: GuildSettings): GuildSettings {
  return {
    ...settings,
    currentPhase: settings.currentPhase.trim(),
    nextPhase: settings.nextPhase.trim(),
    currentStatusLabel: settings.currentStatusLabel.trim(),
    nextStatusLabel: settings.nextStatusLabel.trim(),
    teamNames: Object.fromEntries(tenManTeams.map((team) => [team.key, settings.teamNames[team.key].trim()])) as Record<TenManTeam, string>,
  }
}

function hasBlank(settings: GuildSettings) {
  return [settings.currentPhase, settings.nextPhase, settings.currentStatusLabel, settings.nextStatusLabel, ...tenManTeams.map((team) => settings.teamNames[team.key])].some((value) => !value)
}

export function SettingsTab({ ctx }: { ctx: TabContext }) {
  const saved = ctx.data.settings
  // Restart the draft from what is stored whenever the stored settings change (after a save, or an edit by another leader).
  return <SettingsForm key={JSON.stringify(saved)} saved={saved} ctx={ctx} />
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
      <header><h3>Raid team names</h3><p>Renames the four 10-player teams. Their colors stay the same, and the 20 and 40 player teams keep their names.</p></header>
      <div className="settings-grid">{tenManTeams.map((team) => <label className="settings-field" key={team.key}><span className="settings-team-label"><span className={`team-color-mark mark-${team.key}`} aria-hidden="true" />{defaultGuildSettings.teamNames[team.key]} team</span><input value={draft.teamNames[team.key]} maxLength={SETTINGS_LABEL_MAX} onChange={(event) => setDraft((current) => ({ ...current, teamNames: { ...current.teamNames, [team.key]: event.target.value } }))} disabled={busy} /></label>)}</div>
    </section>
    {blank && <p className="settings-error" role="alert">Every field needs a value.</p>}
    <div className="settings-actions">
      <button type="button" className="button button-secondary" onClick={() => setDraft(saved)} disabled={busy || !changed}>Reset</button>
      <button type="submit" className="button button-primary" disabled={busy || blank || !changed}>Save settings</button>
    </div>
  </form>
}
