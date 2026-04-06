import { useEffect, useState } from 'react'
import { queryContracts } from '../lib/canton'
import { ContractCard } from './contract-card'
import type { ActiveContract, Party } from '../lib/types'
import type { DamlTemplate } from '../lib/daml-parser'

type ContractListProps = {
  partyId: string | null
  refreshKey: number
  templates: DamlTemplate[]
  parties: Party[]
  onExercised: () => void
  onLog?: (type: 'success' | 'error', msg: string) => void
}

function templateNameFromId(templateId: string): string {
  const parts = templateId.split(':')
  return parts[parts.length - 1] ?? templateId
}

export function ContractList({
  partyId,
  refreshKey,
  templates,
  parties,
  onExercised,
  onLog,
}: ContractListProps): React.JSX.Element | null {
  const [contracts, setContracts] = useState<ActiveContract[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!partyId) {
      setContracts([])
      return
    }
    setLoading(true)
    setError(null)
    queryContracts(partyId)
      .then(setContracts)
      .catch((e) => setError(e instanceof Error ? e.message : 'Query failed'))
      .finally(() => setLoading(false))
  }, [partyId, refreshKey])

  if (!partyId) return null
  if (loading) return <p className="p-3 text-xs text-ink-muted">Loading...</p>
  if (error) return <p className="p-3 text-xs text-error">{error}</p>
  if (contracts.length === 0) return <p className="p-3 text-xs text-ink-muted">No active contracts</p>

  return (
    <div className="p-3">
      <h3 className="mb-2 text-xs font-medium text-ink-secondary">
        Active Contracts ({contracts.length})
      </h3>
      <div className="flex flex-col gap-2">
        {contracts.map((c) => {
          const name = templateNameFromId(c.templateId)
          const template = templates.find((t) => t.name === name)
          const choices = template?.choices ?? []

          return (
            <ContractCard
              key={c.contractId}
              contract={c}
              choices={choices}
              parties={parties}
              onExercised={onExercised}
              onLog={onLog}
            />
          )
        })}
      </div>
    </div>
  )
}
