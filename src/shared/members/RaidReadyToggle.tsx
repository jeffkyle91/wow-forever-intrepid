import { setCharacterReadiness } from '../../guildApi'
import type { TabContext } from '../tabs/types'
import './RaidReadyToggle.css'

export function RaidReadyToggle({ characterId, name, ctx }: { characterId: string; name: string; ctx: TabContext }) {
  const { readiness, readinessLoaded, readinessError } = ctx.data
  const ready = readiness.some((entry) => entry.id === characterId && entry.ready)
  const main = ctx.data.roster.find((character) => character.linkedUid === ctx.identity.uid && !character.mainId)
  const character = ctx.data.roster.find((entry) => entry.id === characterId)
  if (!ctx.identity.canEditRoster && (!main || !character || (character.id !== main.id && (character.mainId !== main.id || character.linkedUid)))) return null
  async function change(next: boolean) {
    ctx.feedback.setBusy(true)
    try {
      await setCharacterReadiness(characterId, next)
      ctx.feedback.setMutationError('')
      ctx.feedback.setNotice(`${name} marked ${next ? 'raid ready' : 'not raid ready'}.`)
    } catch (error) {
      ctx.feedback.setMutationError(error instanceof Error ? error.message : 'Could not save raid readiness.')
    } finally {
      ctx.feedback.setBusy(false)
    }
  }
  return <label className="raid-ready-toggle"><input type="checkbox" checked={ready} disabled={ctx.feedback.busy || !readinessLoaded || !!readinessError} onChange={(event) => void change(event.target.checked)} aria-label={`Raid ready: ${name}`} /> Raid ready{!readinessLoaded && !readinessError ? ' (loading)' : ''}</label>
}
