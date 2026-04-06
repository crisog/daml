import { useEffect, useState } from 'react'
import { queryContracts } from '../lib/canton'
import type { ActiveContract } from '../lib/types'

type ContractListProps = {
  partyId: string | null
  refreshKey: number
}

function shortId(id: string): string {
  return id.split('::')[0] ?? id
}

function shortTemplate(id: string): string {
  const parts = id.split(':')
  return parts.length >= 3 ? `${parts[parts.length - 2]}:${parts[parts.length - 1]}` : id
}

export function ContractList({ partyId, refreshKey }: ContractListProps): React.JSX.Element | null {
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
        {contracts.map((c) => (
          <div key={c.contractId} className="rounded-md border border-stone bg-page p-2">
            <div className="mb-1 text-xs font-medium text-accent">{shortTemplate(c.templateId)}</div>
            <div className="mb-1 font-mono text-xs text-ink-muted">
              {c.contractId.slice(0, 24)}...
            </div>
            <table className="w-full text-xs">
              <tbody>
                {Object.entries(c.createArguments).map(([key, val]) => (
                  <tr key={key}>
                    <td className="pr-3 align-top text-ink-muted">{key}</td>
                    <td className="text-ink">
                      {typeof val === 'string' ? shortId(val) : JSON.stringify(val)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
