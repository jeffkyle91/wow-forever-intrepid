import { HttpsError } from 'firebase-functions/v2/https'

export function id(value) {
  if (typeof value !== 'string' || !value || value.includes('/') || value.length > 1500 || value === '.' || value === '..') {
    throw new HttpsError('invalid-argument', 'A valid document id is required.')
  }
  return value
}

export function input(request, keys) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to continue.')
  const data = request.data
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some((key) => !keys.includes(key))) {
    throw new HttpsError('invalid-argument', 'Unsupported request fields.')
  }
  id(data.guildId)
  return { ...data, uid: request.auth.uid }
}

export async function membership(tx, guild, uid) {
  const member = (await tx.get(guild.collection('members').doc(uid))).data()
  if (!member || !['Guild Leader', 'Raid Leader', 'Member'].includes(member.role)) {
    throw new HttpsError('permission-denied', 'Guild membership is required.')
  }
  return member
}
