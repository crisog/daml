import { useState } from 'react'
import { Button } from '@base-ui/react/button'
import { compileAndDeploy } from '../lib/compiler'

type CompileStatusProps = {
  getSource: () => Record<string, string>
  onSuccess?: () => void
}

export function CompileStatus({ getSource, onSuccess }: CompileStatusProps): React.JSX.Element {
  const [compiling, setCompiling] = useState(false)
  const [result, setResult] = useState<{ success: boolean; errors?: string[] } | null>(null)

  async function handleCompile() {
    setCompiling(true)
    setResult(null)
    try {
      const res = await compileAndDeploy(getSource())
      setResult(res)
      if (res.success) onSuccess?.()
    } catch (e) {
      setResult({ success: false, errors: [e instanceof Error ? e.message : 'Compile failed'] })
    } finally {
      setCompiling(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        onClick={handleCompile}
        disabled={compiling}
        className="rounded-md bg-success px-3 py-1 text-xs font-medium text-ink-inverted hover:opacity-90"
      >
        {compiling ? 'Compiling...' : 'Deploy'}
      </Button>
      {result?.success && <span className="text-xs text-success">Deployed</span>}
      {result && !result.success && (
        <span className="text-xs text-error" title={result.errors?.join('\n')}>
          Build failed
        </span>
      )}
    </div>
  )
}
