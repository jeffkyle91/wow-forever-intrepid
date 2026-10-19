import { useId, useState } from 'react'
import { Plus } from 'lucide-react'
import type { PlayerRecord } from '../../guildApi'
import { sortPlayers } from '../game/candidates'
import { classText } from '../game/classes'
import { ClassAvatar } from './ClassAvatar'
import './CharacterPicker.css'

type PickerPlayer = Pick<PlayerRecord, 'id' | 'name' | 'className' | 'specialization' | 'mainId'>

// Picks roster characters for a list: a search box, a choice of order (class, which groups the class colors, or name) and a list with a tick box for each
// character, in the character's class color. A tick works at once: ticking a character adds them to the list this is for (onAdd), and unticking takes them off
// again (onRemove), so there is no separate button to press. `listed` says how many times each character is already on the list, and a tick box shows whether
// that is at least once. A player may be listed twice for an item, so a character who is on the list has a small plus to add another listing. Used where a list
// of players is built from the roster instead of typed. Enter in the search box does not submit the form around it.
export function CharacterPicker({ roster, listed, onAdd, onRemove }: { roster: PickerPlayer[]; listed: ReadonlyMap<string, number>; onAdd: (player: PickerPlayer) => void; onRemove: (player: PickerPlayer) => void }) {
  const [query, setQuery] = useState('')
  const [by, setBy] = useState<'class' | 'name'>('class')
  const uid = useId()
  const names = new Map(roster.map((player) => [player.id, player.name]))
  const needle = query.trim().toLowerCase()
  const shown = sortPlayers(roster, by).filter((player) => !needle || `${player.name} ${player.className} ${player.specialization}`.toLowerCase().includes(needle))
  return <div className="character-picker">
    <div className="picker-bar">
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} placeholder="Search the roster" aria-label="Search the roster" />
      <div className="segmented-control" role="group" aria-label="Order of the roster">
        <button type="button" className={by === 'class' ? 'segment selected' : 'segment'} onClick={() => setBy('class')} aria-pressed={by === 'class'}>By class</button>
        <button type="button" className={by === 'name' ? 'segment selected' : 'segment'} onClick={() => setBy('name')} aria-pressed={by === 'name'}>By name</button>
      </div>
    </div>
    <ul className="picker-list" aria-label="Roster: tick a character to add them to the candidates, untick to take them off">
      {shown.map((player) => {
        const times = listed.get(player.id) ?? 0
        return <li key={player.id}>
          <label>
            <input type="checkbox" checked={times > 0} onChange={(event) => (event.target.checked ? onAdd(player) : onRemove(player))} aria-labelledby={`${uid}-${player.id}-name ${uid}-${player.id}-detail`} />
            <ClassAvatar player={player} />
            <span id={`${uid}-${player.id}-name`} className={`picker-name ${classText(player.className) ?? ''}`}>{player.name}</span>
            <small id={`${uid}-${player.id}-detail`}>{player.specialization || player.className}{player.mainId && names.get(player.mainId) ? ` \u00b7 alt of ${names.get(player.mainId)}` : ''}{times > 1 ? ` \u00b7 listed x${times}` : ''}</small>
          </label>
          {times > 0 && <button type="button" className="picker-again" onClick={() => onAdd(player)} title="List this character again, further down" aria-label={`List ${player.name} again`}><Plus size={12} /></button>}
        </li>
      })}
      {shown.length === 0 && <li className="picker-empty">{roster.length ? 'No character matches.' : 'The roster is empty.'}</li>}
    </ul>
  </div>
}
