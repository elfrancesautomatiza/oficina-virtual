#!/usr/bin/env node
// Lance une routine sans ouvrir la fenêtre : node scripts/run-routine.mjs mi-oficina/sofia:mi-rutina
// Pensé pour launchd (voir scripts/install-launchd.sh) quand l'app n'est pas ouverte.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (!target || !target.includes(':')) { console.error('uso: run-routine.mjs <office>/<slug>:<routineId>'); process.exit(2) }
const electron = path.join(root, 'node_modules', '.bin', 'electron')
const child = spawn(electron, ['.', `--routine=${target}`], { cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } })
child.on('exit', (code) => process.exit(code ?? 1))
