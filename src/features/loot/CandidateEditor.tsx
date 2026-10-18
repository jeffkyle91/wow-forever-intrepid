import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import type { PlayerRecord } from '../../guildApi'
import { addCharacters, moveLine, removeLine, setNote, type Line, type Who } from '../../shared/game/candidates'
import { classText } from '../../shared/game/classes'
import { CharacterPicker } from '../../shared/ui/CharacterPicker'
import { ClassAvatar } from '../../shared/ui/ClassAvatar'
import './CandidateEditor.css'

// The candidates of a priority as lines the leader builds from the roster: characters, picked several at a time, and notes for what is not a person ("Any
// warlock who didn't get the staff last phase"). Every line can move up or down and be taken off; a note can be reworded and marked finished (crossed off).
// A character who is not on the roster any more is shown as such and stays until it is taken off.
export function CandidateEditor({ lines, onChange, roster, who }: { lines: Line[]; onChange: (lines: Line[]) => void; roster: PlayerRecord[]; who: Who<PlayerRecord> }) {
  const [draft, setDraft] = useState('')
  const listed = new Map<string, number>()
  for (const line of lines) if (line.kind === 'character' && line.id !== undefined) listed.set(line.id, (listed.get(line.id) ?? 0) + 1)
  const addNote = () => {
    if (draft.trim() === '') return
    onChange([...lines, { kind: 'note', text: draft.trim(), done: false }])
    setDraft('')
  }
  return <div className="candidate-editor">
    <ol className="candidate-lines" aria-label="Candidates, highest priority first">
      {lines.map((line, index) => {
        const player = line.kind === 'character' && line.id !== undefined ? who.player(line.id) : undefined
        const name = who.nameOf(line)
        const label = line.kind === 'note' ? 'note' : name
        return <li key={index} className={line.kind === 'note' ? 'candidate-line is-note' : 'candidate-line'}>
          <span className="rank-number">{String(index + 1).padStart(2, '0')}</span>
          {line.kind === 'character'
            ? <>
              {player ? <ClassAvatar player={player} /> : null}
              <span className={`candidate-name ${classText(who.classOf(line)) ?? ''}`}>{name}</span>
              {!who.known(line) && <small className="candidate-flag">{line.id !== undefined ? 'not on the roster' : 'not on the roster: kept as typed'}</small>}
            </>
            : <>
              <input className="candidate-note-text" value={line.text} onChange={(event) => onChange(setNote(lines, index, { text: event.target.value }))} aria-label={`Note, line ${index + 1}`} />
              <label className="candidate-finished"><input type="checkbox" checked={line.done} onChange={(event) => onChange(setNote(lines, index, { done: event.target.checked }))} /> Finished</label>
            </>}
          <span className="candidate-controls">
            <button type="button" onClick={() => onChange(moveLine(lines, index, -1))} disabled={index === 0} title="Move up" aria-label={`Move ${label} up`}><ArrowUp size={13} /></button>
            <button type="button" onClick={() => onChange(moveLine(lines, index, 1))} disabled={index === lines.length - 1} title="Move down" aria-label={`Move ${label} down`}><ArrowDown size={13} /></button>
            <button type="button" onClick={() => onChange(removeLine(lines, index))} title="Take off the list" aria-label={`Take ${label} off the list`}><X size={13} /></button>
          </span>
        </li>
      })}
      {lines.length === 0 && <li className="candidate-empty">Nobody yet. Pick characters below, or add a note.</li>}
    </ol>
    <CharacterPicker roster={roster} listed={listed} onAdd={(players) => onChange(addCharacters(lines, players))} addLabel="Add to the list" />
    <div className="candidate-note-add">
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addNote() } }} placeholder="Add a note line: Any warlock who didn't get the staff last phase" aria-label="Add a note line" maxLength={60} />
      <button type="button" className="button button-secondary" onClick={addNote} disabled={draft.trim() === ''}><Plus size={14} /> Add note</button>
    </div>
  </div>
}
