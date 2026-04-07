import { useState } from 'react'
import { Button } from '@base-ui/react/button'
import { compileAndDeploy } from '@/lib/playground/compiler'

type CompileStatusProps = {
  getSource: () => Record<string, string>
  onSuccess?: () => void
  onError?: (error: string) => void
}

export function CompileStatus({ getSource, onSuccess, onError }: CompileStatusProps): React.JSX.Element {
  const [compiling, setCompiling] = useState(false)

  async function handleCompile() {
    setCompiling(true)
    try {
      const res = await compileAndDeploy(getSource())
      if (res.success) {
        onSuccess?.()
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
      className="rounded-md bg-success px-3 py-1 text-xs font-medium text-ink-inverted hover:opacity-90"
    >
      {compiling ? 'Compiling...' : 'Deploy'}
    </Button>
  )
}
