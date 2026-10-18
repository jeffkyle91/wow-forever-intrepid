import { Timestamp } from 'firebase/firestore'

export type CharacterReadiness = { id: string; ready: boolean; updatedBy: string; updatedAt: Timestamp }

export function normalizeReadiness(id: string, data: Record<string, unknown>): CharacterReadiness | null {
  if (typeof data.ready !== 'boolean' || typeof data.updatedBy !== 'string' || !data.updatedBy || !(data.updatedAt instanceof Timestamp)) return null
  return { id, ready: data.ready, updatedBy: data.updatedBy, updatedAt: data.updatedAt }
}
