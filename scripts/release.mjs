// Deploys main to the live Firebase project: checks, build, lint and rules tests, then the Firestore rules, then hosting.
//
//   npm run release              prints the plan and runs the read-only checks; deploys nothing
//   npm run release -- --deploy  does all of it
//
// Run it with --deploy only when a deploy was asked for. Any other argument is an error, so a typo or --help
// cannot deploy by accident.
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { loadEnv } from 'vite'

const PROJECT = 'intrepid-wow-forever'
// Keep in step with the firebase-tools version in the test:rules and dev:emulator scripts in package.json, so what is
// tested is what deploys.
const FIREBASE_TOOLS = 'firebase-tools@15.31.0'
const TAG = 'last-deploy'

function run(command, { quiet = false } = {}) {
  const result = spawnSync(command, { shell: true, encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] })
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() }
}

function fail(message) {
  console.error(`\nStopped: ${message}`)
  process.exit(1)
}

let deploy = false
try {
  const { values } = parseArgs({ options: { deploy: { type: 'boolean' }, help: { type: 'boolean' } }, strict: true })
  if (values.help) {
    console.log('Usage: npm run release [-- --deploy]\n\nWithout --deploy it prints the plan and runs the read-only checks. Nothing is deployed.')
    process.exit(0)
  }
  deploy = Boolean(values.deploy)
} catch (error) {
  fail(`${error.message}. The only options are --deploy and --help.`)
}

// What the live site and its rules would be built from.
if (run('git branch --show-current', { quiet: true }).out !== 'main') fail('switch to main first (git checkout main).')
if (run('git status --porcelain', { quiet: true }).out) fail('the working tree has uncommitted changes.')
if (!run('git fetch origin', { quiet: true }).ok) fail('could not fetch origin.')
if (run('git rev-parse HEAD', { quiet: true }).out !== run('git rev-parse origin/main', { quiet: true }).out) fail('local main is not the same as origin/main. Run: git pull --ff-only')

// The build reads its Firebase settings from .env files that git ignores, so the clean-tree check above cannot see
// them. A .env.local that points at a test project would put a bundle for the wrong backend on the live site.
const env = loadEnv('production', process.cwd(), 'VITE_')
if (env.VITE_FIREBASE_PROJECT_ID !== PROJECT) fail(`the build would use project "${env.VITE_FIREBASE_PROJECT_ID ?? '(none)'}", not "${PROJECT}". Check .env.local (and .env.production).`)
if (!env.VITE_GUILD_ID) fail('VITE_GUILD_ID is not set for the build. Check .env.local (and .env.production).')

const head = run('git rev-parse --short HEAD', { quiet: true }).out
console.log(`Release of ${head} to ${PROJECT} (guild ${env.VITE_GUILD_ID}). Steps: build, lint, rules tests, deploy the Firestore rules (the CLI skips them if they have not changed), deploy hosting.`)
if (!deploy) {
  console.log('Checks passed. Nothing was built or deployed. Run again with --deploy to release.')
  process.exit(0)
}

let rulesDeployed = false
function step(command) {
  console.log(`\n> ${command}`)
  if (run(command).ok) return
  console.error(`\nStopped: "${command}" failed. Nothing after it was run.`)
  if (rulesDeployed) console.error('The Firestore rules ARE LIVE and hosting is NOT. Run it again with --deploy (it is safe to repeat). Until then, an old tab may be refused by the new rules.')
  process.exit(1)
}

step('npm run build')
step('npm run lint')
step('npm run test:rules')
step(`npx --yes --ignore-scripts ${FIREBASE_TOOLS} deploy --only firestore:rules --project ${PROJECT} --non-interactive`)
rulesDeployed = true
step(`npx --yes --ignore-scripts ${FIREBASE_TOOLS} deploy --only hosting --project ${PROJECT} --non-interactive`)

// A marker for the last release. It is only a note: nothing reads it, so a failure here is not a failed deploy.
if (!run(`git tag -f ${TAG}`).ok || !run(`git push origin -f refs/tags/${TAG}`).ok) console.warn(`\nNote: could not move the ${TAG} tag. The deploy itself succeeded.`)
console.log(`\nDone. ${head} is live at https://${PROJECT}.web.app`)
