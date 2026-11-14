import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ClipboardCopy } from 'lucide-react'
import { formatRaidTime, raidTimeOf, type RaidRecord } from '../../guildApi'
import { currentPhaseNo, type PhaseOption } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { copyForAddon, newNightId } from './copyForAddon'
import { NIGHT_BY, nightCounts, nightRaidChoices, pickedRaid } from './nightChoices'
import { useDropTables } from './useDropTables'
import './CopyForAddon.css'

// A raid in the picker: "Sat, Nov 14 · 9:00 PM ET · Test Night (20)". The date is a plain day, so it is read at noon and never shifts with time zones.
function raidLabel(raid: RaidRecord, today: string) {
  const day = new Date(`${raid.date}T12:00:00`)
  const date = Number.isNaN(day.getTime()) ? raid.date : day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return [date, formatRaidTime(raidTimeOf(raid)), `${raid.name || 'Raid'} (${raid.size})`, ...(raid.date === today ? ['today'] : [])].join(' · ')
}

const seconds = () => Math.floor(Date.now() / 1000)

// Copy for addon (ADDON-002, issue #193): the night string of docs/spec/exchange-v0.md section 5 for the loot master's addon, built by copyForAddon.ts
// from what the app already holds. Nothing is read from Firestore and nothing is written: the string goes to the clipboard only. `phase` is the phase
// the Loot priorities tab was showing when the dialog was opened (the button shows only on the current one), and `today` the viewer's date then.
// The builder's warnings are shown before copying and never block it: the addon skips a bad row and says so. Each Copy makes a new string id.
export function CopyForAddonModal({ phase, today, close, live }: { phase: PhaseOption; today: string; close: () => void; live: TabContext }) {
  const { roster, allPriorities, hiddenPriorities, awards, raids, lootTables, settings } = live.data
  const tables = useDropTables(lootTables, phase.no)
  const choices = useMemo(() => nightRaidChoices(raids, today), [raids, today])
  const [picked, setPicked] = useState<string | null>(null)
  const raid = pickedRaid(choices, picked)
  const [copied, setCopied] = useState<{ text: string; failed: boolean } | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Everything but the string's id and time, which are new at each Copy. The preview's are fixed when the dialog opens; its length is the copy's.
  const input = useMemo(() => ({ by: NIGHT_BY, phase: phase.no, roster, priorities: [...allPriorities, ...hiddenPriorities], awards, raid, tables }), [phase.no, roster, allPriorities, hiddenPriorities, awards, raid, tables])
  const [previewId] = useState(() => newNightId())
  const [previewAt] = useState(seconds)
  const preview = useMemo(() => copyForAddon({ ...input, id: previewId, at: previewAt }), [input, previewId, previewAt])
  // The button shows on the current phase only (section 5.1: the addon may be sent no other). If a leader starts or reopens a phase meanwhile, stop.
  const moved = currentPhaseNo(settings) !== phase.no
  const ready = preview.ok && !moved && live.identity.canEditRaidData

  // When the browser refuses the clipboard, the string is shown selected, for Ctrl+C.
  useEffect(() => {
    if (copied?.failed) { box.current?.focus(); box.current?.select() }
  }, [copied])

  async function copy() {
    if (!ready) return
    const result = copyForAddon({ ...input, id: newNightId(), at: seconds() })
    if (!result.ok) return
    try {
      if (!navigator.clipboard) throw new Error('No clipboard')
      await navigator.clipboard.writeText(result.text)
      setCopied({ text: result.text, failed: false })
    } catch {
      setCopied({ text: result.text, failed: true })
    }
  }

  return <Modal title="Copy for addon" onClose={close}>
    <form className="modal-form addon-copy" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void copy() }}>
      <p className="addon-copy-intro">The priority lists of <strong>{phase.name}</strong> for the loot master's addon, with who has already received, the roster and the bosses of their zones. Nothing is saved.</p>
      <label>Raid night<select value={raid?.id ?? ''} onChange={(event) => { setPicked(event.target.value); setCopied(null) }}>
        <option value="">No raid</option>
        {choices.raids.map((choice) => <option key={choice.id} value={choice.id}>{raidLabel(choice, today)}</option>)}
      </select></label>
      <p className="addon-copy-facts"><span>Phase: <strong>{phase.name}</strong></span>{preview.ok && <span className="addon-copy-counts">{nightCounts(preview.model, preview.text.length)}</span>}</p>
      {moved && <p className="addon-copy-problem" role="alert">The loot phase changed while this was open. Close it and copy again.</p>}
      {!preview.ok && <p className="addon-copy-problem" role="alert">{preview.error}</p>}
      {preview.warnings.length > 0 && <div className="addon-copy-warnings">
        <p><strong>{preview.warnings.length === 1 ? '1 warning' : `${preview.warnings.length.toLocaleString('en-US')} warnings`}.</strong> They do not stop the copy: the addon skips what it cannot read and says so.</p>
        <ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </div>}
      {copied && !copied.failed && <p className="addon-copy-done" role="status"><strong>Copied.</strong> In the game, paste it into the addon with <code>/im import</code> (or the Import night button of the loot master's window).</p>}
      {copied?.failed && <>
        <p className="addon-copy-problem" role="alert">The browser did not let the page copy. The string is selected below: copy it with Ctrl+C (Cmd+C on a Mac), then paste it into the addon with <code>/im import</code> (or the Import night button of the loot master's window).</p>
        <label>Night string<textarea ref={box} className="addon-copy-text" value={copied.text} readOnly rows={4} spellCheck={false} onFocus={(event) => event.currentTarget.select()} /></label>
      </>}
      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={close}>Close</button>
        <button className="button button-primary" disabled={!ready}><ClipboardCopy size={15} /> {copied ? 'Copy again' : 'Copy'}</button>
      </div>
    </form>
  </Modal>
}
