import { Axe, BowArrow, Heart, Shield } from 'lucide-react'
import type { Role } from '../game/classes'

export function RolePill({ role }: { role: Role }) {
  return <span className={`role-pill role-${role.toLowerCase()}`}><RoleIcon role={role} size={12} />{role}</span>
}

export function RoleIcon({ role, size }: { role: Role; size: number }) {
  const Icon = role === 'Tank' ? Shield : role === 'Healer' ? Heart : role === 'Melee' ? Axe : BowArrow
  return <Icon size={size} />
}
