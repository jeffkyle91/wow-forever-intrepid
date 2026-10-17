export type PlayerRecord = {
  id: string
  name: string
  className: string
  specialization: string
  role: 'Tank' | 'Healer' | 'Melee' | 'Ranged'
  linkedUid?: string
  mainId?: string
  surname?: string
}
