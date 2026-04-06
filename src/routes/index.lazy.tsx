import { createLazyFileRoute } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { PartyPanel } from '@/components/playground/party-panel'
import { ContractList } from '@/components/playground/contract-list'
import { CreateForm } from '@/components/playground/create-form'
import { CompileStatus } from '@/components/playground/compile-status'
import { Console, type ConsoleHandle } from '@/components/playground/console'
import { DamlEditor } from '@/editor/daml-editor'
import { ExamplePicker } from '@/components/playground/example-picker'
import { parseDamlSource } from '@/lib/playground/daml-parser'
import { EXAMPLES } from '@/lib/playground/examples'
import type { Party } from '@/lib/playground/types'
import { SandboxLoader } from '@/components/playground/sandbox-loader'
import { useAuth } from '@/lib/use-auth'
import { authClient } from '@/lib/auth-client'

export const Route = createLazyFileRoute('/')({
  component: PlaygroundPage,
})

type MobileTab = 'editor' | 'interact' | 'console'

function PlaygroundPage(): React.JSX.Element {
  const auth = useAuth()
  const isAuthed = auth.status === 'authenticated'

  const [parties, setParties] = useState<Party[]>([])
  const [activeParty, setActiveParty] = useState<Party | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [source, setSource] = useState(EXAMPLES[0]?.source ?? '')
  const [deployed, setDeployed] = useState(false)
  const consoleRef = useRef<ConsoleHandle>(null)
  const [mobileTab, setMobileTab] = useState<MobileTab>('editor')

  const templates = useMemo(() => parseDamlSource(source), [source])

  const handleSignIn = () => {
    authClient.signIn.social({
      provider: 'github',
      callbackURL: '/',
    })
  }

  const handleSignOut = async () => {
    await authClient.signOut()
    window.location.reload()
  }

  const handleExampleSelect = (src: string, name: string) => {
    setSource(src)
    setDeployed(false)
    consoleRef.current?.info(`Loaded example: ${name}`)
  }

  const compileStatus = (
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
  )

  const signInButton = (
    <button
      type="button"
      onClick={handleSignIn}
      disabled={auth.status === 'loading'}
      className="rounded-md bg-success px-3 py-1 text-xs font-medium text-ink-inverted hover:opacity-90 disabled:opacity-50"
    >
      Sign in
    </button>
  )

  const interactPanel = isAuthed ? (
    <SandboxLoader
      enabled={isAuthed}
      onReady={() => consoleRef.current?.success('Connected to sandbox')}
    >
      {(sandboxReady) =>
        sandboxReady ? (
          <>
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
                Deploy your contract and create parties to get started.{' '}
                <a href="/docs/daml/creating-your-first-daml-smart-contract" className="text-accent hover:underline">
                  Learn how
                </a>
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
          </>
        ) : null
      }
    </SandboxLoader>
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-ink-muted">
        Sign in to deploy contracts, create parties, and interact with the ledger.
      </p>
      <a href="/docs/daml/creating-your-first-daml-smart-contract" className="text-xs text-accent hover:underline">
        Read the docs
      </a>
      {auth.status !== 'loading' && (
        <button
          type="button"
          onClick={handleSignIn}
          className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-ink-inverted hover:bg-accent-hover"
        >
          Sign in with GitHub
        </button>
      )}
    </div>
  )

  return (
    <div className="flex h-dvh flex-col bg-page text-ink">
      <header className="flex items-center gap-2 border-b border-stone bg-surface px-3 py-2 md:gap-4 md:px-4">
        <h1 className="shrink-0 text-sm font-medium text-accent">Daml Playground</h1>
        {isAuthed && compileStatus}
        <div className="hidden sm:block">
          <ExamplePicker onSelect={handleExampleSelect} />
        </div>
        <span className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
          {activeParty && (
            <span className="hidden sm:inline">Viewing as {activeParty.displayName}</span>
          )}
          {isAuthed ? (
            <>
              <span className="hidden md:inline">{auth.user.name}</span>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-ink-muted hover:text-ink"
              >
                Sign out
              </button>
            </>
          ) : (
            signInButton
          )}
        </span>
      </header>

      <div className="flex border-b border-stone bg-surface sm:hidden">
        {(['editor', 'interact', 'console'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
              mobileTab === tab
                ? 'border-b-2 border-accent text-accent'
                : 'text-ink-muted'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="hidden flex-1 overflow-hidden border-b border-stone sm:flex">
        <div className="flex-1 border-r border-stone">
          <DamlEditor value={source} onChange={setSource} />
        </div>
        <div className="flex w-80 flex-col overflow-y-auto bg-surface">
          {interactPanel}
        </div>
      </div>

      <div className={`flex-1 overflow-hidden sm:hidden ${mobileTab === 'console' ? 'hidden' : ''}`}>
        <div className={mobileTab === 'editor' ? 'flex h-full flex-col' : 'hidden'}>
          <div className="flex items-center gap-2 border-b border-stone bg-surface px-3 py-1.5">
            <select
              onChange={(e) => {
                const ex = EXAMPLES.find((x) => x.name === e.target.value)
                if (ex) handleExampleSelect(ex.source, ex.name)
              }}
              defaultValue=""
              className="rounded-md border border-stone bg-page px-2 py-1 text-xs text-ink"
            >
              <option value="" disabled>
                Load example...
              </option>
              {EXAMPLES.map((ex) => (
                <option key={ex.name} value={ex.name}>
                  {ex.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <DamlEditor value={source} onChange={setSource} />
          </div>
        </div>
        <div className={mobileTab === 'interact' ? 'h-full overflow-y-auto bg-surface' : 'hidden'}>
          {interactPanel}
        </div>
      </div>

      <div className={`shrink-0 border-t border-stone-strong sm:block sm:h-56 ${mobileTab === 'console' ? 'flex-1' : 'hidden'}`}>
        <Console ref={consoleRef} />
      </div>
    </div>
  )
}
