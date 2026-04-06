import { createLazyFileRoute } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { PartyPanel } from '../components/party-panel'
import { ContractList } from '../components/contract-list'
import { CreateForm } from '../components/create-form'
import { CompileStatus } from '../components/compile-status'
import { Console, type ConsoleHandle } from '../components/console'
import { DamlEditor } from '../editor/daml-editor'
import { ExamplePicker } from '../components/example-picker'
import { parseDamlSource } from '../lib/daml-parser'
import { EXAMPLES } from '../lib/examples'
import type { Party } from '../lib/types'

export const Route = createLazyFileRoute('/')({
  component: PlaygroundPage,
})

function PlaygroundPage(): React.JSX.Element {
  const [parties, setParties] = useState<Party[]>([])
  const [activeParty, setActiveParty] = useState<Party | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [source, setSource] = useState(EXAMPLES[0]?.source ?? '')
  const [deployed, setDeployed] = useState(false)
  const consoleRef = useRef<ConsoleHandle>(null)

  const templates = useMemo(() => parseDamlSource(source), [source])

  return (
    <div className="flex h-screen flex-col bg-page text-ink">
      {/* Header */}
      <header className="flex items-center gap-4 border-b border-stone bg-surface px-4 py-2">
        <h1 className="text-sm font-medium text-accent">Daml Playground</h1>
        <CompileStatus
          getSource={() => ({ 'Main.daml': source })}
          onSuccess={() => {
            setDeployed(true)
            const names = templates.map((t) => t.name).join(', ')
            consoleRef.current?.success(`Deployed: ${names}`)
          }}
          onError={(err) => {
            consoleRef.current?.error(`Deploy failed: ${err}`)
          }}
        />
        <ExamplePicker
          onSelect={(src, name) => {
            setSource(src)
            setDeployed(false)
            consoleRef.current?.info(`Loaded example: ${name}`)
          }}
        />
        {activeParty && (
          <span className="ml-auto text-xs text-ink-muted">
            Viewing as {activeParty.displayName}
          </span>
        )}
      </header>

      {/* Top row: Editor (left) + Parties & Create (right) */}
      <div className="flex flex-1 overflow-hidden border-b border-stone">
        <div className="flex-1 border-r border-stone">
          <DamlEditor value={source} onChange={setSource} />
        </div>

        <div className="flex w-80 flex-col overflow-y-auto bg-surface">
          <PartyPanel
            parties={parties}
            activeParty={activeParty}
            onPartyCreated={(p) => {
              setParties((prev) => [...prev, p])
              if (!activeParty) setActiveParty(p)
              consoleRef.current?.info(`Party created: ${p.displayName}`)
            }}
            onPartySelected={setActiveParty}
          />

          {!deployed && (
            <p className="p-3 text-xs text-ink-muted">
              Deploy your contract and create parties to get started
            </p>
          )}

          {deployed && parties.length > 0 && (
            <CreateForm
              templates={templates}
              parties={parties}
              onSuccess={(templateName) => {
                setRefreshKey((k) => k + 1)
                consoleRef.current?.success(`Contract created: ${templateName}`)
              }}
              onError={(err) => {
                consoleRef.current?.error(err)
              }}
            />
          )}

          <ContractList
            partyId={activeParty?.id ?? null}
            refreshKey={refreshKey}
            templates={templates}
            parties={parties}
            onExercised={() => setRefreshKey((k) => k + 1)}
            onLog={(type, msg) => {
              if (type === 'success') consoleRef.current?.success(msg)
              else consoleRef.current?.error(msg)
            }}
          />
        </div>
      </div>

      {/* Bottom: Console */}
      <div className="h-56 shrink-0 border-t border-stone-strong">
        <Console ref={consoleRef} />
      </div>
    </div>
  )
}
