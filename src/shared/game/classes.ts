import characterClasses from '../../../functions/characterClasses.json' with { type: 'json' }

export type Role = 'Tank' | 'Healer' | 'Melee' | 'Ranged'

export type SpecializationOption = { name: string; role: Role }

export function classColorKey(className: string) {
  return className.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// The classes that give a block (not a table row) the class stripe, fade and colored name. See .class-accent in App.css.
export function classAccent(className: string) {
  return `class-accent class-color-${classColorKey(className)}`
}

// The same look for a table row (<tr>): class-accent-row in App.css.
export function classAccentRow(className?: string) {
  return className ? `class-accent-row class-color-${classColorKey(className)}` : undefined
}

// A class-colored name only (see .class-text in App.css).
export function classText(className?: string) {
  return className ? `class-text class-color-${classColorKey(className)}` : undefined
}

export const classSpecializations: Record<string, SpecializationOption[]> = Object.fromEntries(
  Object.entries(characterClasses).map(([name, specs]) => [name, specs.map((spec): SpecializationOption => {
    const role = spec.role
    if (role !== 'Tank' && role !== 'Healer' && role !== 'Melee' && role !== 'Ranged') throw new Error(`Invalid default raid role for ${name} ${spec.name}.`)
    return { name: spec.name, role }
  })]),
)

export const raidRoles: Role[] = ['Tank', 'Healer', 'Melee', 'Ranged']
