import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { PlayerRecord } from '../../guildApi'
import { sortPlayers } from '../game/candidates'
import { classText } from '../game/classes'
import { ClassAvatar } from './ClassAvatar'
import './CharacterPicker.css'

type PickerPlayer = Pick<PlayerRecord, 'id' | 'name' | 'className' | 'specialization' | 'mainId'>

// Picks roster characters, several at a time: a search box, a choice of order (class, which groups the class colors, or name) and a list with a tick
// box for each character, in the character's class color. `listed` says how many times each character is already on the list this is for, so a
// character who is there shows it (and can still be added again: a player may be listed twice for an item). Used where a list of players is built
// from the roster instead of typed.
export function CharacterPicker({ roster, listed, onAdd, addLabel = 'Add selected' }: { roster: PickerPlayer[]; listed: ReadonlyMap<string, number>; onAdd: (players: PickerPlayer[]) => void; addLabel?: string }) {
  const [query, setQuery] = useState('')
  const [by, setBy] = useState<'class' | 'name'>('class')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const names = new Map(roster.map((player) => [player.id, player.name]))
  const needle = query.trim().toLowerCase()
  const shown = sortPlayers(roster, by).filter((player) => !needle || `${player.name} ${player.className} ${player.specialization}`.toLowerCase().includes(needle))
  const toggle = (id: string) => setPicked((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next })
  const add = () => {
    onAdd(sortPlayers(roster.filter((player) => picked.has(player.id)), by))
    setPicked(new Set())
  }
  return <div className="character-picker">
    <div className="picker-bar">
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the roster" aria-label="Search the roster" />
      <div className="segmented-control" role="group" aria-label="Order of the roster">
        <button type="button" className={by === 'class' ? 'segment selected' : 'segment'} onClick={() => setBy('class')} aria-pressed={by === 'class'}>By class</button>
        <button type="button" className={by === 'name' ? 'segment selected' : 'segment'} onClick={() => setBy('name')} aria-pressed={by === 'name'}>By name</button>
      </div>
    </div>
    <ul className="picker-list">
      {shown.map((player) => {
        const times = listed.get(player.id) ?? 0
        return <li key={player.id}><label>
          <input type="checkbox" checked={picked.has(player.id)} onChange={() => toggle(player.id)} />
          <ClassAvatar player={player} />
          <span className={`picker-name ${classText(player.className) ?? ''}`}>{player.name}</span>
          <small>{player.specialization || player.className}{player.mainId && names.get(player.mainId) ? ` \u00b7 alt of ${names.get(player.mainId)}` : ''}{times ? ` \u00b7 on the list${times > 1 ? ` x${times}` : ''}` : ''}</small>
        </label></li>
      })}
      {shown.length === 0 && <li className="picker-empty">{roster.length ? 'No character matches.' : 'The roster is empty.'}</li>}
    </ul>
    <button type="button" className="button button-secondary" onClick={add} disabled={picked.size === 0}><Plus size={14} /> {addLabel}{picked.size ? ` (${picked.size})` : ''}</button>
  </div>
}
