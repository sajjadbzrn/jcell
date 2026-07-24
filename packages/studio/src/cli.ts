#!/usr/bin/env node

/**
 * jcell Studio — CLI entry point.
 *
 * Usage:
 *   jcell-studio --adapter file --path ./data
 *   jcell-studio --adapter sqlite --path ./database.db
 *   jcell-studio --help
 */

import { startServer, type StudioConfig } from './server'

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════╗
║            jcell Studio v1.3.0               ║
╚══════════════════════════════════════════════╝

Usage: jcell-studio [options]

Options:
  -a, --adapter <type>    Adapter type: "file" (default) or "sqlite"
  -p, --path <path>       Path to the database directory (file adapter)
                          or database file (sqlite adapter).
                          Default: "./data" for file, "./data.db" for sqlite.
  --port <number>         Port to run the server on. Default: 5555.
  --host <string>         Host to bind to. Default: "127.0.0.1".
  --no-open               Do not open the browser automatically.
  -h, --help              Show this help message.

Examples:
  jcell-studio
  jcell-studio --adapter file --path ./my-data
  jcell-studio --adapter sqlite --path ./app.db --port 3000
`)
}

function parseArgs(args: string[]): StudioConfig {
  const config: StudioConfig = {
    adapter: 'file',
    path: './data',
    port: 5555,
    host: '127.0.0.1',
    open: true,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '-h':
      case '--help':
        printHelp()
        process.exit(0)
        break

      case '-a':
      case '--adapter': {
        const val = args[++i]
        if (val !== 'file' && val !== 'sqlite') {
          console.error(`Error: Invalid adapter "${val}". Must be "file" or "sqlite".`)
          process.exit(1)
        }
        config.adapter = val
        break
      }

      case '-p':
      case '--path': {
        config.path = args[++i]
        break
      }

      case '--port': {
        const port = parseInt(args[++i], 10)
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error(`Error: Invalid port "${args[i]}". Must be 1-65535.`)
          process.exit(1)
        }
        config.port = port
        break
      }

      case '--host': {
        config.host = args[++i]
        break
      }

      case '--no-open': {
        config.open = false
        break
      }

      default:
        if (arg.startsWith('-')) {
          console.error(`Error: Unknown option "${arg}". Use --help for usage.`)
          process.exit(1)
        }
        break
    }
  }

  return config
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const config = parseArgs(args)

  console.log()
  console.log('  ⚡ jcell Studio starting...')
  console.log(`  📁 Adapter: ${config.adapter}`)
  console.log(`  📂 Path:    ${config.path}`)
  console.log()

  try {
    const server = await startServer(config)

    const url = `http://${config.host}:${config.port}`
    console.log(`  🚀 Studio running at: ${url}`)
    console.log()

    if (config.open) {
      // Try to open browser
      const { spawn } = await import('node:child_process')
      const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
      spawn(cmd, [url], { stdio: 'ignore', detached: true })
    }

    console.log('  Press Ctrl+C to stop.')
    console.log()

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n  Shutting down...')
      server.stop()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      server.stop()
      process.exit(0)
    })

    // Keep the process alive
    await new Promise(() => {})
  } catch (err) {
    console.error('  ❌ Failed to start studio:', err)
    process.exit(1)
  }
}

main()
