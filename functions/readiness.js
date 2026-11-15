const checks = ['level60', 'raidRequirements', 'gear', 'enchants', 'professions', 'talentsAndAbilities', 'rotation', 'consumables', 'raidKnowledge']

export function isRaidReady(record) {
  const checklist = record?.checklist
  return record?.schemaVersion === 1 && record.ready === true
    && checklist !== null && typeof checklist === 'object' && !Array.isArray(checklist)
    && Object.keys(checklist).length === checks.length && checks.every((key) => checklist[key] === true)
}
