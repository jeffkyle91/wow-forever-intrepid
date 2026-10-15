import { useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import type { PlayerRecord as Player } from '../../guildApi'
import { classSpecializations, raidRoles, type Role } from '../../shared/game/classes'

export function PlayerForm({ player, roster, busy, onSubmit, onCancel }: {
  player?: Player
  roster: Player[]
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
  // The spec only supplies the default role; a Guild Leader can set any role.
  const [role, setRole] = useState<Role>(() => raidRoles.includes(player?.role as Role) ? player!.role : selectedSpec.role)
  const hasAlts = !!player && roster.some((other) => other.mainId === player.id)
  const mains = roster.filter((other) => other.id !== player?.id && !other.mainId)
  const mainValue = mains.some((other) => other.id === player?.mainId) ? player?.mainId : ''

  return <form className="modal-form" onSubmit={onSubmit}>
    <div className="form-grid"><label>First name<input name="name" defaultValue={player?.name} placeholder="e.g. Starweaver" maxLength={30} required autoFocus /></label><label><span>Surname <span className="field-hint">Optional</span></span><input name="surname" defaultValue={player?.surname} placeholder="e.g. Brightwater" maxLength={30} /></label></div>
    <div className="form-grid"><label>Class<select name="className" value={className} onChange={(event) => { const nextClass = event.target.value; setClassName(nextClass); setSpecialization(classSpecializations[nextClass][0].name); setRole(classSpecializations[nextClass][0].role) }}>{Object.keys(classSpecializations).map((name) => <option key={name}>{name}</option>)}</select></label><label>Specialization<select name="specialization" value={specialization} onChange={(event) => { setSpecialization(event.target.value); setRole(availableSpecs.find((option) => option.name === event.target.value)?.role ?? role) }}>{availableSpecs.map((option) => <option key={option.name}>{option.name}</option>)}</select></label></div>
    <div className="form-grid"><label>Raid role<select name="role" value={role} onChange={(event) => setRole(event.target.value as Role)}>{raidRoles.map((name) => <option key={name}>{name}</option>)}</select><small className="field-hint">Defaults to {selectedSpec.role} for {selectedSpec.name}.</small></label><label>Main character<select name="mainId" defaultValue={mainValue} disabled={hasAlts}><option value="">None (this is a main)</option>{mains.map((other) => <option key={other.id} value={other.id}>{other.name}</option>)}</select><small className="field-hint">{hasAlts ? 'This character has alts linked to it, so it must stay a main.' : 'Choose a main to make this character its alt.'}</small></label></div>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button><button className="button button-primary" disabled={busy}><Check size={15} /> Save member</button></div>
  </form>
}
