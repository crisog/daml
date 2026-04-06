import type { Party, ActiveContract } from './types'

const API = '/api'

let commandCounter = 0
function nextCommandId(): string {
  return `playground-${Date.now()}-${++commandCounter}`
}

export async function createParty(displayName: string): Promise<Party> {
  const res = await fetch(`${API}/v2/parties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partyIdHint: displayName, identityProviderId: '' }),
  })
  if (!res.ok) throw new Error(`Failed to create party: ${res.statusText}`)
  const data = await res.json()
  return { id: data.partyDetails.party, displayName }
}

export async function submitCreate(
  actAs: string[],
  templateId: string,
  createArguments: Record<string, unknown>,
): Promise<{ updateId: string; completionOffset: number }> {
  const res = await fetch(`${API}/v2/commands/submit-and-wait`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [{ CreateCommand: { templateId, createArguments } }],
      actAs,
      readAs: actAs,
      userId: 'playground-user',
      commandId: nextCommandId(),
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
  const res = await fetch(`${API}/v2/commands/submit-and-wait`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [{ ExerciseCommand: { templateId, contractId, choice, choiceArgument } }],
      actAs,
      readAs: actAs,
      userId: 'playground-user',
      commandId: nextCommandId(),
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body)
  }
  return res.json()
}

export async function queryContracts(partyId: string): Promise<ActiveContract[]> {
  const endRes = await fetch(`${API}/v2/state/ledger-end`)
  if (!endRes.ok) throw new Error(`Failed to get ledger end`)
  const { offset } = await endRes.json()

  const res = await fetch(`${API}/v2/state/active-contracts`, {
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
