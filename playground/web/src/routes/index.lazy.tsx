import { createLazyFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { PartyPanel } from '../components/party-panel'
import { ContractList } from '../components/contract-list'
import { CreateForm } from '../components/create-form'
import { CompileStatus } from '../components/compile-status'
import { DamlEditor } from '../editor/daml-editor'
import { parseDamlSource } from '../lib/daml-parser'
import type { Party } from '../lib/types'

export const Route = createLazyFileRoute('/')({
  component: PlaygroundPage,
})

const DEFAULT_SOURCE = `module Main where

template PaymentObligation
  with
    debtor : Party
    creditor : Party
    amount : Decimal
  where
    ensure amount > 0.0

    signatory debtor, creditor

    nonconsuming choice Pay : ()
      controller debtor
      do
        archive self
`

function PlaygroundPage(): React.JSX.Element {
  const [parties, setParties] = useState<Party[]>([])
  const [activeParty, setActiveParty] = useState<Party | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [source, setSource] = useState(DEFAULT_SOURCE)
  const [deployed, setDeployed] = useState(false)

  const templates = useMemo(() => parseDamlSource(source), [source])

  function handleDeploySuccess() {
    setDeployed(true)
  }

  return (
    <div className="flex h-screen flex-col bg-page text-ink">
      <header className="flex items-center gap-4 border-b border-stone px-4 py-2">
        <h1 className="text-sm font-medium">Daml Playground</h1>
        <CompileStatus
          getSource={() => ({ 'Main.daml': source })}
          onSuccess={handleDeploySuccess}
        />
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

          {deployed && parties.length > 0 && (
            <CreateForm
              templates={templates}
              parties={parties}
              onSuccess={() => setRefreshKey((k) => k + 1)}
            />
          )}

          {!deployed && parties.length > 0 && (
            <p className="p-3 text-xs text-ink-muted">
              Deploy your contract to create instances
            </p>
          )}

          {!deployed && parties.length === 0 && (
            <p className="p-3 text-xs text-ink-muted">
              Create parties, then deploy your contract
            </p>
          )}

          <ContractList
            partyId={activeParty?.id ?? null}
            refreshKey={refreshKey}
            templates={templates}
            parties={parties}
            onExercised={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      </div>
    </div>
  )
}
