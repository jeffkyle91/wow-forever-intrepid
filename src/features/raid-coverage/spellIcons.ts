// Spell icon names by spell ID, read from the Wowhead WoW Forever tooltip data (nether.wowhead.com/forever/tooltip/spell/<id>) on 2026-10-16.
// Icons are display only: they never affect coverage. A spell with no entry here shows a text fallback tile.
const iconNames: Record<number, string> = {
  5242: 'ability_warrior_battleshout',
  19740: 'spell_holy_fistofjustice',
  425600: 'inv_misc_horn_03',
  1299346: 'ability_trueshot',
  17007: 'spell_nature_unyeildingstamina',
  24858: 'spell_nature_forceofnature',
  461475: 'ability_warrior_innerrage',
  8075: 'spell_nature_earthbindtotem',
  8835: 'spell_nature_invisibilitytotem',
  8512: 'spell_nature_windfury',
  410021: 'inv_chest_cloth_45', // The Wild Strikes rune engraving spell, so the icon is the engraving's.
  8227: 'spell_nature_guardianward',
  20217: 'spell_magic_magearmor',
  409580: 'ability_hunter_pet_cat',
  1243: 'spell_holy_wordfortitude',
  21562: 'spell_holy_prayeroffortitude',
  14752: 'spell_holy_divinespirit',
  27681: 'spell_holy_prayerofspirit',
  1326159: 'spell_warlock_demonsoul',
  1459: 'spell_holy_magicalsentry',
  23028: 'spell_holy_arcaneintellect',
  1126: 'spell_nature_regeneration',
  21849: 'spell_nature_regeneration',
  19742: 'spell_holy_sealofwisdom',
  5675: 'spell_nature_manaregentotem',
  16190: 'spell_frost_summonwaterelemental',
  402668: 'spell_holy_stoicism',
  19977: 'spell_holy_prayerofhealing02',
  1038: 'spell_holy_sealofsalvation',
  465: 'spell_holy_devotionaura',
  8071: 'spell_nature_stoneskintotem',
  15107: 'spell_nature_earthbind',
  8184: 'spell_fireresistancetotem_01',
  19891: 'spell_fire_sealoffire',
  8181: 'spell_frostresistancetotem_01',
  19888: 'spell_frost_wizardmark',
  10595: 'spell_nature_natureresistancetotem',
  20043: 'spell_nature_protectionformnature',
  19876: 'spell_shadow_sealofkings',
  27683: 'spell_holy_prayerofshadowprotection',
  976: 'spell_shadow_antishadow',
  7386: 'ability_warrior_sunder',
  8647: 'ability_warrior_riposte',
  770: 'spell_nature_faeriefire',
  704: 'spell_shadow_unholystrength',
  1160: 'ability_warrior_warcry',
  99: 'ability_druid_demoralizingroar',
  9035: 'spell_shadow_fingerofdeath',
  702: 'spell_shadow_curseofmannoroth',
  6343: 'spell_nature_thunderclap',
  402799: 'spell_shadow_twistedfaith',
  440892: 'warlock_curse_shadow',
  1130: 'ability_hunter_snipershot',
  1714: 'spell_shadow_curseoftounges',
  20166: 'spell_holy_righteousnessaura',
  20165: 'spell_holy_healingaura',
  8143: 'spell_nature_tremortotem',
  6346: 'spell_holy_excorcism',
}

export function iconName(spellId: number | undefined): string | undefined {
  return spellId === undefined ? undefined : iconNames[spellId]
}

// "medium" is the 36 px Wowhead icon size.
export function iconUrl(spellId: number | undefined): string | undefined {
  const name = iconName(spellId)
  return name ? `https://wow.zamimg.com/images/wow/icons/medium/${name}.jpg` : undefined
}
