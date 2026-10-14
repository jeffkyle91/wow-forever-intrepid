import { useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import type { PlayerRecord as Player } from '../../guildApi'
import { classSpecializations } from '../../shared/game/classes'
import { RolePill } from '../../shared/ui/RolePill'

export function PlayerForm({ player, busy, onSubmit, onCancel }: {
  player?: Player
  busy: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}) {
  const startingClass = player && classSpecializations[player.className] ? player.className : 'Warrior'
  const [className, setClassName] = useState(startingClass)
  const availableSpecs = classSpecializations[className]
  const [specialization, setSpecialization] = useState(() => availableSpecs.some((option) => option.name === player?.specialization)
    ? player?.specialization ?? availableSpecs[0].name
    : availableSpecs[0].name)
  const selectedSpec = availableSpecs.find((option) => option.name === specialization) ?? availableSpecs[0]

  return <form className="modal-form" onSubmit={onSubmit}>
    <div className="form-grid"><label>Character name<input name="name" defaultValue={player?.name} placeholder="e.g. Starweaver" required autoFocus /></label><label>Class<select name="className" value={className} onChange={(event) => { const nextClass = event.target.value; setClassName(nextClass); setSpecialization(classSpecializations[nextClass][0].name) }}>{Object.keys(classSpecializations).map((name) => <option key={name}>{name}</option>)}</select></label></div>
    <div className="form-grid"><label>Specialization<select name="specialization" value={specialization} onChange={(event) => setSpecialization(event.target.value)}>{availableSpecs.map((option) => <option key={option.name}>{option.name}</option>)}</select></label><div className="derived-role-field"><span className="derived-role-label">RAID ROLE</span><RolePill role={selectedSpec.role} /><input type="hidden" name="role" value={selectedSpec.role} /></div></div>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button><button className="button button-primary" disabled={busy}><Check size={15} /> Save member</button></div>
  </form>
}
