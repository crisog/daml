import { compileAndDeploy } from './compiler'
import { createParty } from './canton'
import type { Party } from './types'
import type { UserSessionData } from '@/lib/session.functions'

export interface RestoreResult {
  parties: Party[]
  deployed: boolean
}

export async function restoreSession(
  session: UserSessionData,
  onLog?: (type: 'info' | 'success' | 'error', msg: string) => void,
): Promise<RestoreResult> {
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
      onLog?.('success', `Restored party: ${name}`)
    } catch {
      onLog?.('error', `Failed to restore party: ${name}`)
    }
  }

  return { parties, deployed }
}
