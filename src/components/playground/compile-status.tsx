import { useState } from 'react'
import { Button } from '@base-ui/react/button'
import { compileAndDeploy } from '@/lib/playground/compiler'

type CompileStatusProps = {
  getSource: () => Record<string, string>
  deployed?: boolean
  onSuccess?: (durationMs: number) => void
  onError?: (error: string) => void
}

export function CompileStatus({ getSource, deployed, onSuccess, onError }: CompileStatusProps): React.JSX.Element {
  const [compiling, setCompiling] = useState(false)

  async function handleCompile() {
    setCompiling(true)
    const start = Date.now()
    try {
      const res = await compileAndDeploy(getSource())
      if (res.success) {
        onSuccess?.(Date.now() - start)
      } else {
        onError?.(res.errors?.join('\n') ?? 'Unknown error')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Compile failed'
      onError?.(msg)
    } finally {
      setCompiling(false)
    }
  }

  return (
    <Button
      onClick={handleCompile}
      disabled={compiling}
      className="flex items-center gap-1.5 rounded-md bg-success px-3 py-1 text-xs font-medium text-ink-inverted hover:opacity-90 disabled:opacity-70"
    >
      {compiling ? (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-ink-inverted/30 border-t-ink-inverted" />
      ) : deployed ? (
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : null}
      {compiling ? 'Compiling...' : deployed ? 'Deployed' : 'Deploy'}
    </Button>
  )
}
