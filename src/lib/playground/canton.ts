import type { Party, ActiveContract } from './types'

const API = '/api/sandbox'
const DEFAULT_TIMEOUT = 30_000
const COMPILE_TIMEOUT = 60_000

let commandCounter = 0
function nextCommandId(): string {
  return `playground-${Date.now()}-${++commandCounter}`
}

async function fetchWithTimeout(url: string, init?: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchInit } = init ?? {}
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...fetchInit, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeout / 1000}s`)
    }
    throw new Error(`Request to ${url} failed: ${err instanceof Error ? err.message : 'network error'}`)
  } finally {
    clearTimeout(id)
  }
}

export async function createParty(displayName: string): Promise<Party> {
  const res = await fetchWithTimeout(`${API}/v2/parties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partyIdHint: displayName, identityProviderId: '' }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const cause = body?.cause ?? res.statusText
    if (cause.includes('already exists') || cause.includes('already allocated')) {
      return fetchExistingParty(displayName)
    }
    throw new Error(cause)
  }
  const data = await res.json()
  return { id: data.partyDetails.party, displayName }
}

async function fetchExistingParty(displayName: string): Promise<Party> {
  const res = await fetchWithTimeout(`${API}/v2/parties`)
  if (!res.ok) throw new Error('Failed to list parties')
  const data = await res.json()
  const details = data.partyDetails as Array<{ party: string; isLocal: boolean }>
  const match = details.find((p) => p.party.startsWith(`${displayName}::`))
  if (!match) throw new Error(`Party ${displayName} not found`)
  return { id: match.party, displayName }
}

export async function resolveParties(displayNames: string[]): Promise<Party[]> {
  if (displayNames.length === 0) return []
  const res = await fetchWithTimeout(`${API}/v2/parties`)
  if (!res.ok) return []
  const data = await res.json()
  const details = data.partyDetails as Array<{ party: string; isLocal: boolean }>
  return displayNames
    .map((name) => {
      const match = details.find((p) => p.party.startsWith(`${name}::`))
      return match ? { id: match.party, displayName: name } : null
    })
    .filter((p): p is Party => p !== null)
}

export async function submitCreate(
  actAs: string[],
  templateId: string,
  createArguments: Record<string, unknown>,
): Promise<{ updateId: string; completionOffset: number }> {
  const res = await fetchWithTimeout(`${API}/v2/commands/submit-and-wait`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [{ CreateCommand: { templateId, createArguments } }],
      actAs,
      readAs: actAs,
      commandId: nextCommandId(),
      userId: 'playground',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body)
  }
  return res.json()
}

export async function submitExercise(
  actAs: string[],
  templateId: string,
  contractId: string,
  choice: string,
  choiceArgument: Record<string, unknown>,
): Promise<{ updateId: string; completionOffset: number }> {
  const res = await fetchWithTimeout(`${API}/v2/commands/submit-and-wait`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [{ ExerciseCommand: { templateId, contractId, choice, choiceArgument } }],
      actAs,
      readAs: actAs,
      commandId: nextCommandId(),
      userId: 'playground',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body)
  }
  return res.json()
}

export async function queryContracts(partyId: string): Promise<ActiveContract[]> {
  const endRes = await fetchWithTimeout(`${API}/v2/state/ledger-end`)
  if (!endRes.ok) throw new Error(`Failed to get ledger end`)
  const { offset } = await endRes.json()

  const res = await fetchWithTimeout(`${API}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: {
        filtersByParty: {
          [partyId]: {
            cumulative: [
              { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
            ],
          },
        },
      },
      verbose: true,
      activeAtOffset: offset,
    }),
  })
  if (!res.ok) throw new Error(`Query failed: ${res.statusText}`)

  const data = await res.json()
  if (!Array.isArray(data)) return []

  return data
    .filter((e: Record<string, unknown>) => e.contractEntry)
    .map((e: Record<string, unknown>) => {
      const active = (e.contractEntry as Record<string, unknown>).JsActiveContract as Record<string, unknown>
      const ev = active.createdEvent as Record<string, unknown>
      return {
        contractId: ev.contractId as string,
        templateId: ev.templateId as string,
        createArguments: ev.createArgument as Record<string, unknown>,
        signatories: ev.signatories as string[],
        observers: (ev.observers as string[]) ?? [],
      }
    })
}
