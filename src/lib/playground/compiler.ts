import type { CompileResult } from './types'

const COMPILE_TIMEOUT = 30_000

export async function compileAndDeploy(files: Record<string, string>): Promise<CompileResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), COMPILE_TIMEOUT)

  try {
    const res = await fetch('/api/sandbox/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text()
      try {
        const body = JSON.parse(text)
        const cause = body.cause ?? body.errors?.join('\n') ?? `Sandbox returned ${res.status}`
        return { success: false, errors: [cause] }
      } catch {
        return { success: false, errors: [text || `Sandbox returned ${res.status}`] }
      }
    }

    // Use the same abort signal for body read so timeout covers the full request
    const text = await res.text()
    return JSON.parse(text) as CompileResult
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { success: false, errors: ['Deploy timed out after 30s. Try again.'] }
    }
    const msg = err instanceof Error ? err.message : 'network error'
    return { success: false, errors: [`Could not reach sandbox: ${msg}`] }
  } finally {
    clearTimeout(timeout)
  }
}
