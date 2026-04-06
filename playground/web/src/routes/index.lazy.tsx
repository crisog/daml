import { createLazyFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { PartyPanel } from '../components/party-panel'
import { ContractList } from '../components/contract-list'
import { CommandPanel } from '../components/command-panel'
import { CompileStatus } from '../components/compile-status'
import { DamlEditor } from '../editor/daml-editor'
import type { Party } from '../lib/types'

export const Route = createLazyFileRoute('/')({
  component: PlaygroundPage,
})

const DEFAULT_SOURCE = `module Main where

template Hello
  with
    owner : Party
  where
    signatory owner
`

function PlaygroundPage(): React.JSX.Element {
  const [parties, setParties] = useState<Party[]>([])
  const [activeParty, setActiveParty] = useState<Party | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [source, setSource] = useState(DEFAULT_SOURCE)

  return (
    <div className="flex h-screen flex-col bg-page text-ink">
      <header className="flex items-center gap-4 border-b border-stone px-4 py-2">
        <h1 className="text-sm font-medium">Daml Playground</h1>
        <CompileStatus getSource={() => ({ 'Main.daml': source })} />
        {activeParty && (
          <span className="ml-auto text-xs text-ink-muted">
            Viewing as {activeParty.displayName}
          </span>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 border-r border-stone">
          <DamlEditor value={source} onChange={setSource} />
        </div>

        <div className="flex w-96 flex-col overflow-y-auto bg-surface">
          <PartyPanel
            parties={parties}
            activeParty={activeParty}
            onPartyCreated={(p) => {
              setParties((prev) => [...prev, p])
              if (!activeParty) setActiveParty(p)
            }}
            onPartySelected={setActiveParty}
          />
          <ContractList partyId={activeParty?.id ?? null} refreshKey={refreshKey} />
          <CommandPanel
            parties={parties}
            onCommandSuccess={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      </div>
    </div>
  )
}
