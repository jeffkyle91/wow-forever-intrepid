import { isDeepStrictEqual } from 'node:util'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import classes from './characterClasses.json' with { type: 'json' }
import { id, input, membership } from './access.js'

const kinds = ['create-alt', 'link-alt', 'rename', 'change-spec', 'promote-main']
const fail = (message) => { throw new HttpsError('failed-precondition', message) }
const snapshot = (character) => ({
  name: character.name, surname: character.surname ?? '', className: character.className,
  specialization: character.specialization, role: character.role,
  mainId: character.mainId ?? null, linkedUid: character.linkedUid ?? null,
})

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new HttpsError('invalid-argument', `Enter ${required ? 'non-empty ' : ''}text of at most ${max} characters.`)
  }
  return value.trim()
}

function proposal(kind, value) {
  const keys = kind === 'create-alt' ? ['name', 'surname', 'className', 'specialization']
    : kind === 'rename' ? ['name', 'surname'] : kind === 'change-spec' ? ['className', 'specialization'] : []
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new HttpsError('invalid-argument', 'Unsupported character-change fields.')
  }
  const result = {}
  if (keys.includes('name')) {
    result.name = text(value.name, 30, true)
    result.surname = text(value.surname, 30)
  }
  if (keys.includes('className')) {
    const spec = typeof value.className === 'string' && Object.hasOwn(classes, value.className)
      ? classes[value.className].find((entry) => entry.name === value.specialization) : undefined
    if (!spec) throw new HttpsError('invalid-argument', 'Choose a valid class and specialization.')
    Object.assign(result, { className: value.className, specialization: spec.name, role: spec.role })
  }
  return result
}

async function linkedMain(tx, guild, member, uid) {
  if (typeof member.playerId !== 'string' || !member.playerId) fail('A Guild Leader must link your account to a main character first.')
  const ref = guild.collection('roster').doc(id(member.playerId))
  const main = (await tx.get(ref)).data()
  if (!main || main.mainId || main.linkedUid !== uid) fail('Your main character link has changed. Ask a Guild Leader to check it.')
  return ref
}

async function eligibleTarget(tx, guild, kind, characterId, mainRef, uid) {
  const ref = guild.collection('roster').doc(characterId)
  const character = (await tx.get(ref)).data()
  if (kind === 'create-alt') {
    if (character) fail('The new character id is already in use.')
    return { ref, character: null }
  }
  if (!character || !['name', 'className', 'specialization', 'role'].every((key) => typeof character[key] === 'string')) {
    fail('The character is missing or cannot be read. Ask a Guild Leader to check the roster.')
  }
  if (kind === 'link-alt') {
    const alts = await tx.get(guild.collection('roster').where('mainId', '==', characterId))
    // Also check membership pointers, so a malformed one-sided link cannot be claimed.
    const accounts = await tx.get(guild.collection('members').where('playerId', '==', characterId))
    if (characterId === mainRef.id || character.mainId || character.linkedUid || !alts.empty || !accounts.empty) {
      fail('Choose an unlinked character with no main, account link or alts of its own.')
    }
  } else if (characterId !== mainRef.id && (character.mainId !== mainRef.id || character.linkedUid)) {
    throw new HttpsError('permission-denied', 'Choose one of your currently owned direct alts.')
  } else if (characterId === mainRef.id && character.linkedUid !== uid) {
    throw new HttpsError('permission-denied', 'Your character link has changed.')
  }
  if (kind === 'promote-main' && characterId === mainRef.id) fail('Choose an alt to promote, not your current main.')
  return { ref, character }
}

export async function submitCharacterRequest(db, request) {
  const data = input(request, ['guildId', 'requestId', 'kind', 'characterId', 'proposed', 'note'])
  id(data.requestId)
  if (!kinds.includes(data.kind)) throw new HttpsError('invalid-argument', 'Choose a supported character change.')
  const proposed = proposal(data.kind, data.proposed)
  const note = text(data.note, 500)
  if (data.kind === 'create-alt' ? data.characterId !== null : typeof data.characterId !== 'string') {
    throw new HttpsError('invalid-argument', 'Choose a character, or leave the id empty for a new alt.')
  }
  const guild = db.collection('guilds').doc(data.guildId)
  const ref = guild.collection('characterRequests').doc(data.requestId)
  const characterId = data.kind === 'create-alt' ? guild.collection('roster').doc().id : id(data.characterId)
  await db.runTransaction(async (tx) => {
    const member = await membership(tx, guild, data.uid)
    const mainRef = await linkedMain(tx, guild, member, data.uid)
    const existing = await tx.get(ref)
    if (existing.exists) throw new HttpsError('already-exists', 'This request was already submitted. Check your request history.')
    const { character } = await eligibleTarget(tx, guild, data.kind, characterId, mainRef, data.uid)
    const changedFields = data.kind === 'rename' ? ['name', 'surname'] : ['className', 'specialization']
    if (character && ['rename', 'change-spec'].includes(data.kind)
      && changedFields.every((key) => (character[key] ?? '') === proposed[key])) {
      fail('The proposed character details are unchanged.')
    }
    tx.create(ref, {
      userId: data.uid, displayName: typeof member.displayName === 'string' ? member.displayName : '',
      kind: data.kind, characterId, mainId: mainRef.id, before: character ? snapshot(character) : null,
      proposed, note, status: 'pending', requestedAt: FieldValue.serverTimestamp(),
    })
  })
  return { id: ref.id }
}

export async function resolveCharacterRequest(db, request) {
  const data = input(request, ['guildId', 'requestId', 'action', 'note'])
  id(data.requestId)
  if (!['approve', 'reject', 'withdraw'].includes(data.action)) throw new HttpsError('invalid-argument', 'Choose approve, reject or withdraw.')
  const note = text(data.note, 500)
  const guild = db.collection('guilds').doc(data.guildId)
  const ref = guild.collection('characterRequests').doc(data.requestId)
  await db.runTransaction(async (tx) => {
    const reviewer = await membership(tx, guild, data.uid)
    const change = (await tx.get(ref)).data()
    if (!change) throw new HttpsError('not-found', 'This request no longer exists.')
    if (data.action === 'withdraw' ? change.userId !== data.uid : reviewer.role !== 'Guild Leader') {
      throw new HttpsError('permission-denied', 'Only the owner may withdraw, and only Guild Leaders may review character requests.')
    }
    if (change.status !== 'pending') fail('This request has already been resolved.')
    if (data.action === 'approve') {
      const owner = await membership(tx, guild, change.userId)
      const mainRef = await linkedMain(tx, guild, owner, change.userId)
      if (mainRef.id !== change.mainId) fail('The main character changed after submission. Reject or withdraw this request and submit a new one.')
      const { ref: characterRef, character } = await eligibleTarget(tx, guild, change.kind, change.characterId, mainRef, change.userId)
      if (!isDeepStrictEqual(character ? snapshot(character) : null, change.before)) {
        fail('Character details changed after submission. Reject or withdraw this request and submit a new one.')
      }
      if (change.kind === 'promote-main') {
        const alts = await tx.get(guild.collection('roster').where('mainId', '==', mainRef.id))
        if (alts.docs.some((alt) => alt.data().linkedUid)) fail('An alt has an account link. Ask a Guild Leader to correct the roster first.')
        tx.update(characterRef, { mainId: FieldValue.delete(), linkedUid: change.userId })
        tx.update(mainRef, { mainId: characterRef.id, linkedUid: FieldValue.delete() })
        for (const alt of alts.docs) {
          if (alt.id !== characterRef.id) tx.update(alt.ref, { mainId: characterRef.id })
        }
        tx.update(guild.collection('members').doc(change.userId), { playerId: characterRef.id })
      } else if (change.kind === 'create-alt') {
        tx.create(characterRef, { ...change.proposed, mainId: mainRef.id })
      } else if (change.kind === 'link-alt') {
        tx.update(characterRef, { mainId: mainRef.id })
      } else {
        tx.update(characterRef, change.proposed)
      }
    }
    tx.update(ref, {
      status: { approve: 'approved', reject: 'rejected', withdraw: 'withdrawn' }[data.action],
      resolvedBy: data.uid, resolvedByName: typeof reviewer.displayName === 'string' ? reviewer.displayName : '',
      resolvedAt: FieldValue.serverTimestamp(), resolutionNote: note,
    })
  })
  return { resolved: true }
}
