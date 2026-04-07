import { compileAndDeploy } from './compiler'
import { createParty } from './canton'
import type { Party } from './types'
import { loadSession } from './session-store'

export interface RestoreResult {
  parties: Party[]
  deployed: boolean
}

export async function restoreSession(
  onLog?: (type: 'info' | 'success' | 'error', msg: string) => void,
): Promise<RestoreResult | null> {
  const session = loadSession()
  if (!session) return null
  if (!session.deployed && session.partyNames.length === 0) return null

  onLog?.('info', 'Restoring previous session...')

  let deployed = false
  if (session.deployed && session.source) {
    onLog?.('info', 'Re-deploying contract...')
    const res = await compileAndDeploy({ 'Main.daml': session.source })
    if (res.success) {
      deployed = true
      onLog?.('success', 'Contract restored')
    } else {
      onLog?.('error', `Restore failed: ${res.errors?.[0] ?? 'unknown'}`)
    }
  }

  const parties: Party[] = []
  for (const name of session.partyNames) {
    try {
      const party = await createParty(name)
      parties.push(party)
    } catch {
      onLog?.('error', `Failed to restore party: ${name}`)
    }
  }
  if (parties.length > 0) {
    onLog?.('success', `Restored ${parties.length} ${parties.length === 1 ? 'party' : 'parties'}`)
  }

  return { parties, deployed }
}
