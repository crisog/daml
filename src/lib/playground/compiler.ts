import type { CompileResult } from './types'

export async function compileAndDeploy(files: Record<string, string>): Promise<CompileResult> {
  let res: Response
  try {
    res = await fetch('/api/sandbox/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    })
  } catch {
    return { success: false, errors: ['Could not reach sandbox. It may be restarting, try again in a moment.'] }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    try {
      const body = JSON.parse(text)
      const cause = body.cause ?? body.errors?.join('\n') ?? `Sandbox returned ${res.status}`
      return { success: false, errors: [cause] }
    } catch {
      return { success: false, errors: [text || `Sandbox returned ${res.status}`] }
    }
  }

  return res.json()
}
