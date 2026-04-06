import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/')({
  component: PlaygroundPage,
})

function PlaygroundPage(): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-stone px-4 py-2">
        <h1 className="text-sm font-medium">Daml Playground</h1>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 border-r border-stone bg-elevated p-4 text-ink-muted">
          Editor goes here
        </div>
        <div className="w-96 overflow-y-auto bg-surface p-4 text-ink-muted">
          Explorer goes here
        </div>
      </div>
    </div>
  )
}
