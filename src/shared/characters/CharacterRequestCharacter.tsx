import { classAccent } from '../game/classes'
import { ClassAvatar } from '../ui/ClassAvatar'

export function CharacterRequestCharacter({ name, surname, className, specialization, role, label }: {
  name: string
  surname?: string
  className: string
  specialization: string
  role?: string
  label: string
}) {
  return <div className={`character-request-character ${classAccent(className)}`}>
    <ClassAvatar player={{ name, className, specialization }} />
    <div><span className="character-request-kicker">{label}</span><strong>{name}{surname ? ` ${surname}` : ''}</strong><small>{specialization} {className}</small></div>
    {role && <span className="character-request-role">{role}</span>}
  </div>
}
