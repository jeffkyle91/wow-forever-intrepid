const iconUrls = import.meta.glob<string>('../wowspecsemojis-master/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
})

const specFiles: Record<string, string> = {
  'demon hunter|havoc': 'dh_havoc.png',
  'demon hunter|vengeance': 'dh_vengeance.png',
  'death knight|blood': 'dk_blood.png',
  'death knight|frost': 'dk_frost.png',
  'death knight|unholy': 'dk_unholy.png',
  'druid|balance': 'druid_balance.png',
  'druid|feral': 'druid_feral.png',
  'druid|guardian': 'druid_guardian.png',
  'druid|restoration': 'druid_resto.png',
  'hunter|beast mastery': 'hunter_bm.png',
  'hunter|marksmanship': 'hunter_mm.png',
  'hunter|survival': 'hunter_survival.png',
  'mage|arcane': 'mage_arcane.png',
  'mage|fire': 'mage_fire.png',
  'mage|frost': 'mage_frost.png',
  'monk|brewmaster': 'monk_brewmaster.png',
  'monk|mistweaver': 'monk_mistweaver.png',
  'monk|windwalker': 'monk_ww.png',
  'paladin|holy': 'paladin_holy.png',
  'paladin|protection': 'paladin_protection.png',
  'paladin|retribution': 'paladin_ret.png',
  'priest|discipline': 'priest_disc.png',
  'priest|holy': 'priest_holy.png',
  'priest|shadow': 'priest_shadow.png',
  'rogue|assassination': 'rogue_assa.png',
  'rogue|combat': 'rogue_combat.png',
  'rogue|subtlety': 'rogue_sub.png',
  'shaman|elemental': 'shaman_elem.png',
  'shaman|enhancement': 'shaman_enhancement.png',
  'shaman|restoration': 'shaman_resto.png',
  'warlock|affliction': 'warlock_affli.png',
  'warlock|demonology': 'warlock_demono.png',
  'warlock|destruction': 'warlock_destru.png',
  'warrior|arms': 'warrior_arms.png',
  'warrior|fury': 'warrior_fury.png',
  'warrior|protection': 'warrior_prot.png',
}

export function getSpecializationIcon(className: string, specialization: string) {
  const file = specFiles[`${className.trim().toLowerCase()}|${specialization.trim().toLowerCase()}`]
  return file ? iconUrls[`../wowspecsemojis-master/${file}`] : undefined
}
