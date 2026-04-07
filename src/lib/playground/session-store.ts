const STORAGE_KEY = 'daml-playground-session'

export interface SessionData {
  source: string
  partyNames: string[]
  deployed: boolean
}

export function saveSession(data: SessionData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // localStorage unavailable or full
  }
}

export function loadSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SessionData
  } catch {
    return null
  }
}
