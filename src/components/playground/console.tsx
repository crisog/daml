import { useEffect, useImperativeHandle, useRef, forwardRef, useState } from 'react'
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

const ANSI_REGEX = /\x1B\[[0-9;]*m/g

export const Console = forwardRef<ConsoleHandle>(function Console(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const linesRef = useRef<string[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: false,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      disableStdin: true,
      fontSize: 13,
      fontFamily: "'DM Mono', 'SF Mono', 'Cascadia Code', monospace",
      theme: {
        background: '#0E1A1C',
        foreground: '#e1e4e8',
        cursor: 'transparent',
        cursorAccent: 'transparent',
        selectionBackground: '#40FB5044',
        green: '#33C940',
        red: '#f97583',
        yellow: '#ffab70',
        cyan: '#79b8ff',
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

    const isMobile = window.matchMedia('(max-width: 639px)').matches
    term.writeln('')
    if (!isMobile) {
      term.writeln(`  ${GREEN}Daml Playground Console${RESET}`)
      term.writeln('')
    }

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(containerRef.current!)

    return () => {
      observer.disconnect()
      term.dispose()
    }
  }, [])

  function writeLine(line: string) {
    termRef.current?.writeln(line)
    linesRef.current.push(line.replace(ANSI_REGEX, ''))
  }

  useImperativeHandle(ref, () => ({
    info(msg: string) {
      writeLine(`  ${timestamp()} ${CYAN}INFO${RESET}  ${msg}`)
    },
    success(msg: string) {
      writeLine(`  ${timestamp()} ${GREEN}OK${RESET}    ${msg}`)
    },
    error(msg: string) {
      writeLine(`  ${timestamp()} ${RED}ERR${RESET}   ${msg}`)
    },
    warn(msg: string) {
      writeLine(`  ${timestamp()} ${YELLOW}WARN${RESET}  ${msg}`)
    },
    clear() {
      termRef.current?.clear()
      linesRef.current = []
    },
  }))

  const handleCopy = async () => {
    const text = linesRef.current.join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {linesRef.current.length > 0 && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-2 top-2 rounded border border-stone bg-surface px-2 py-0.5 text-xs text-ink-muted hover:text-ink"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  )
})
