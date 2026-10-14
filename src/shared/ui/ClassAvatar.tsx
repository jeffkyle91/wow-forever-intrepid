import { Axe, BowArrow, CircleUserRound, Crosshair, Flame, Heart, Leaf, Sparkles, Sun, Waves, type LucideIcon } from 'lucide-react'
import type { PlayerRecord as Player } from '../../guildApi'
import { getSpecializationIcon } from '../../specIcons'

const classIcons: Record<string, LucideIcon> = {
  warrior: Axe,
  paladin: Sun,
  hunter: BowArrow,
  rogue: Crosshair,
  priest: Heart,
  shaman: Waves,
  mage: Sparkles,
  warlock: Flame,
  druid: Leaf,
}

export function ClassAvatar({ player }: { player: Player }) {
  const Icon = classIcons[player.className.toLowerCase()] ?? CircleUserRound
  const specializationIcon = getSpecializationIcon(player.className, player.specialization)
  return <span className={`class-avatar ${player.className.toLowerCase()}${specializationIcon ? ' spec-icon-avatar' : ''}`} title={`${player.name} · ${player.specialization || player.className}`}>
    {specializationIcon ? <img src={specializationIcon} alt="" /> : <Icon size={14} strokeWidth={1.8} />}
  </span>
}
