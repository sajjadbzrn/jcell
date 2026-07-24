#!/usr/bin/env node

/**
 * Publishes the studio package to npm.
 *
 * This script:
 * 1. Backs up the original package.json (in-memory)
 * 2. Replaces `workspace:*` dependencies with actual versions from the workspace
 * 3. Runs the build
 * 4. Publishes to npm
 * 5. ALWAYS restores the original package.json (even on failure)
 *
 * The `workspace:*` protocol is required for local development with npm workspaces
 * but is not understood by npm's registry. Without this replacement, anyone
 * running `npx @sajjadbzn/jcell-studio` gets "Unsupported URL Type 'workspace:'"
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const studioPkgPath = join(__dirname, '..', 'package.json')
const corePkgPath = join(__dirname, '..', '..', 'core', 'package.json')

// ---------------------------------------------------------------------------
// Step 1 — Backup and replace workspace protocols
// ---------------------------------------------------------------------------

function preparePackage() {
  const studioPkg = JSON.parse(readFileSync(studioPkgPath, 'utf8'))
  const originalJson = JSON.stringify(studioPkg, null, 2) + '\n'
  const corePkg = JSON.parse(readFileSync(corePkgPath, 'utf8'))
  const coreVersion = corePkg.version

  let hasWorkspaceProtocols = false

  for (const [dep, version] of Object.entries(studioPkg.dependencies || {})) {
    if (version === 'workspace:*') {
      studioPkg.dependencies[dep] = `^${coreVersion}`
      console.log(`  \u2713 "${dep}": "workspace:*" \u2192 "^${coreVersion}"`)
      hasWorkspaceProtocols = true
    }
  }

  if (!hasWorkspaceProtocols) {
    console.log('  \u2139 No workspace:* dependencies found.')
    return null
  }

  // Write modified package.json
  writeFileSync(studioPkgPath, JSON.stringify(studioPkg, null, 2) + '\n')
  return originalJson
}

function restorePackage(originalJson) {
  if (originalJson === null) return
  writeFileSync(studioPkgPath, originalJson)
  console.log('  \u2705 package.json restored.')
}

// ---------------------------------------------------------------------------
// Step 2 — Build
// ---------------------------------------------------------------------------

function runBuild() {
  console.log('\n  \ud83d\udd28 Building...')
  const result = spawnSync('bun', ['run', 'build'], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) {
    throw new Error('Build failed')
  }
  console.log('  \u2705 Build complete.')
}

// ---------------------------------------------------------------------------
// Step 3 — Publish
// ---------------------------------------------------------------------------

function runPublish() {
  console.log('\n  \ud83d\udce6 Publishing to npm...')
  const result = spawnSync('npm', ['publish'], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) {
    throw new Error('npm publish failed')
  }
  console.log('  \u2705 Published successfully!')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n  \u26a1 Preparing studio package for publish...\n')

  let originalJson = null

  try {
    originalJson = preparePackage()
    runBuild()
    runPublish()
  } catch (err) {
    console.error(`\n  \u274c ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  } finally {
    restorePackage(originalJson)
  }
}

main()
