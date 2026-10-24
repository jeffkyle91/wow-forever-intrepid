// The one-time launch reset: erases the pre-launch phase's awards, loot priorities and Log entries, once, after the first real phase has started.
// Read docs/design/launch-reset.md first. This is run by the maintainer, never by the app, and never against a project that was not named.
//
//   Dry run (changes nothing):
//     node scripts/launch-reset.mjs --project <project id> --guild <guild id> --phase-name "Launch prep"
//
//   Erase (after reading the dry run; the three numbers are the ones it printed):
//     node scripts/launch-reset.mjs --project <project id> --guild <guild id> --phase-name "Launch prep" --apply \
//       --confirm-project <project id> --backup /absolute/path/outside/the/repo/launch-prep-backup.json \
//       --expect-awards N --expect-priorities N --expect-entries N
//
//   If a run stops part way, nothing is sealed. Finish it with the same command and the same backup file plus --resume (the dry run takes --resume and
//   --backup too, and shows what is left): the backup is not written again, and the seal and the record count the whole reset.
//
// The credentials are the maintainer's own (gcloud application-default login, or GOOGLE_APPLICATION_CREDENTIALS). With FIRESTORE_EMULATOR_HOST set it runs
// against the emulator instead, which is how it is rehearsed.
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { applyLaunchReset, describePlan, isInside, LaunchResetRefused, openDatabase, planWithBackup } from '../functions/launchReset.js'

const repository = path.resolve(import.meta.dirname, '..')

function stop(message, code = 1) {
  console.error(`\nStopped: ${message}`)
  process.exit(code)
}

let values
try {
  ({ values } = parseArgs({
    options: {
      project: { type: 'string' }, guild: { type: 'string' }, phase: { type: 'string', default: '0' }, 'phase-name': { type: 'string' },
      apply: { type: 'boolean' }, resume: { type: 'boolean' }, 'confirm-project': { type: 'string' }, backup: { type: 'string' },
      'expect-awards': { type: 'string' }, 'expect-priorities': { type: 'string' }, 'expect-entries': { type: 'string' }, help: { type: 'boolean' },
    },
    strict: true,
  }))
} catch (error) {
  stop(`${error.message}. Read the top of scripts/launch-reset.mjs.`)
}
if (values.help) {
  console.log('Usage: see the top of scripts/launch-reset.mjs and docs/design/launch-reset.md. Without --apply nothing is changed.')
  process.exit(0)
}

const whole = (text) => (/^\d+$/.test(text ?? '') ? Number(text) : undefined)
const phase = whole(values.phase)
if (!values.project) stop('--project is required (the Firebase project id).')
if (!values.guild) stop('--guild is required (the guild id).')
if (!values['phase-name']) stop('--phase-name is required: the name of the phase to erase, exactly as Settings shows it.')
if (phase === undefined) stop('--phase must be a whole number (0 is the first phase).')

const options = { guildId: values.guild, phase, phaseName: values['phase-name'], backupFile: values.backup ? path.resolve(values.backup) : undefined, resume: Boolean(values.resume) }
const { db, close } = openDatabase({ projectId: values.project })
console.log(`Project ${values.project}, guild ${values.guild}: ${process.env.FIRESTORE_EMULATOR_HOST ? `the EMULATOR at ${process.env.FIRESTORE_EMULATOR_HOST}` : 'the LIVE database'}.`)

try {
  const { plan } = await planWithBackup(db, options)
  console.log(`\n${describePlan(plan)}\n`)
  const counts = plan.counts
  if (!values.apply) {
    console.log('This was a dry run: nothing was changed. To erase it, run the same command with:')
    console.log(`  --apply${options.resume ? ' --resume' : ''} --confirm-project ${values.project} --backup ${options.resume ? options.backupFile : '<an absolute path outside the repository>'} --expect-awards ${counts.awards} --expect-priorities ${counts.priorities} --expect-entries ${counts.entries}`)
    process.exit(0)
  }

  if (values['confirm-project'] !== values.project) stop(`--confirm-project must repeat the project id exactly (${values.project}).`)
  if (!options.backupFile) stop('--backup is required: an absolute path for the file the erased data is saved to first.')
  if (isInside(options.backupFile, repository)) stop('The backup holds real names and must not be inside the repository. Choose a path outside it.')
  const expect = { awards: whole(values['expect-awards']), priorities: whole(values['expect-priorities']), entries: whole(values['expect-entries']) }
  if (Object.values(expect).some((count) => count === undefined)) stop('--expect-awards, --expect-priorities and --expect-entries are required: the three numbers the dry run printed.')
  if (!process.stdin.isTTY) stop('Run this from a terminal: the last confirmation is typed.')

  const phrase = `ERASE ${plan.phaseName}`
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  let typed = ''
  try {
    typed = await prompt.question(`Type "${phrase}" to erase ${counts.awards} awards, ${counts.priorities} priorities and ${counts.entries} Log entries for good (${options.resume ? 'the backup of the run that stopped is already written' : 'a backup is written first'}): `)
  } catch {
    // The terminal was closed before anything was typed: that is not a confirmation.
  } finally {
    prompt.close()
  }
  if (typed.trim() !== phrase) stop('Not confirmed. Nothing was changed.')

  const erased = await applyLaunchReset(db, options, expect)
  console.log(`\nDone. Erased ${erased.awards} awards, ${erased.priorities} priorities and ${erased.auditEntries} Log entries. The Log has the record, and the guild is sealed: this cannot be run again.`)
  console.log(`Keep the backup (${options.backupFile}) somewhere private. It holds real names: never commit it.`)
} catch (error) {
  if (error instanceof LaunchResetRefused) stop(error.message)
  throw error
} finally {
  await close()
}
