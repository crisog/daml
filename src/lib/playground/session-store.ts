import { saveUserSession, loadUserSession } from '@/lib/sandbox.functions'

interface SessionData {
  source: string
  partyNames: string[]
  deployed: boolean
}

let pending: Promise<void> | null = null

export function saveSession(data: SessionData): void {
  // Debounce: only the last save wins
  pending = saveUserSession({ data }).catch(() => {})
}

export async function loadSession(): Promise<SessionData | null> {
  try {
    return await loadUserSession()
  } catch {
    return null
  }
}
