import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export type ConsoleHandle = {
  info: (msg: string) => void
  success: (msg: string) => void
  error: (msg: string) => void
  warn: (msg: string) => void
  clear: () => void
}

// ANSI color codes
const RESET = '\x1B[0m'
const GREEN = '\x1B[32m'
const RED = '\x1B[31m'
const YELLOW = '\x1B[33m'
const CYAN = '\x1B[36m'
const DIM = '\x1B[2m'

function timestamp(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${DIM}${h}:${m}:${s}${RESET}`
}

export const Console = forwardRef<ConsoleHandle>(function Console(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: false,
      cursorStyle: 'bar',
      disableStdin: true,
      fontSize: 13,
      fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
      theme: {
        background: '#1a1814',
        foreground: '#c4bdb4',
        cursor: '#c4bdb4',
        selectionBackground: '#5F628F44',
      },
      scrollback: 1000,
      convertEol: true,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current!)
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    term.writeln(`${CYAN}Daml Playground Console${RESET}`)
    term.writeln(`${DIM}Deploy a contract and create parties to get started${RESET}`)
    term.writeln('')

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(containerRef.current!)

    return () => {
      observer.disconnect()
      term.dispose()
    }
  }, [])

  useImperativeHandle(ref, () => ({
    info(msg: string) {
      termRef.current?.writeln(`${timestamp()} ${CYAN}INFO${RESET}  ${msg}`)
    },
    success(msg: string) {
      termRef.current?.writeln(`${timestamp()} ${GREEN}OK${RESET}    ${msg}`)
    },
    error(msg: string) {
      termRef.current?.writeln(`${timestamp()} ${RED}ERR${RESET}   ${msg}`)
    },
    warn(msg: string) {
      termRef.current?.writeln(`${timestamp()} ${YELLOW}WARN${RESET}  ${msg}`)
    },
    clear() {
      termRef.current?.clear()
    },
  }))

  return <div ref={containerRef} className="h-full w-full" />
})
