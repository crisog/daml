import type { CompileResult } from './types'

export async function compileAndDeploy(files: Record<string, string>): Promise<CompileResult> {
  const res = await fetch('/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  return res.json()
}
