import { useState } from 'react'
import { Button } from '@base-ui/react/button'
import { createParty } from '@/lib/playground/canton'
import type { Party } from '@/lib/playground/types'

type PartyPanelProps = {
  parties: Party[]
  activeParty: Party | null
  onPartyCreated: (party: Party) => void
  onPartySelected: (party: Party) => void
}

export function PartyPanel({
  parties,
  activeParty,
  onPartyCreated,
  onPartySelected,
}: PartyPanelProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!name.trim()) return
    setCreating(true)
    try {
      const party = await createParty(name.trim())
      onPartyCreated(party)
      setName('')
    } catch (e) {
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="border-b border-stone p-3">
      <h3 className="mb-2 text-xs font-medium text-lilac">Parties</h3>
      <div className="mb-2 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="Party name"
          disabled={creating}
          className="flex-1 rounded-md border border-stone bg-page px-2 py-1 text-xs"
        />
        <Button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          className="rounded-md bg-accent px-3 py-1 text-xs text-ink-inverted hover:bg-accent-hover"
        >
          {creating ? '...' : 'Create'}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {parties.map((p) => (
          <button
            key={p.id}
            onClick={() => onPartySelected(p)}
            className={`rounded-sm border px-2 py-0.5 text-xs transition-colors ${
              activeParty?.id === p.id
                ? 'border-accent bg-accent-light text-accent'
                : 'border-stone text-ink-secondary hover:border-stone-strong'
            }`}
          >
            {p.displayName}
          </button>
        ))}
      </div>
    </div>
  )
}
