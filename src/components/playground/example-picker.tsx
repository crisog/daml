import { EXAMPLES } from '@/lib/playground/examples'

type ExamplePickerProps = {
  onSelect: (source: string, name: string) => void
}

export function ExamplePicker({ onSelect }: ExamplePickerProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-ink-muted">Examples:</span>
      {EXAMPLES.map((ex) => (
        <button
          key={ex.name}
          onClick={() => onSelect(ex.source, ex.name)}
          title={ex.description}
          className="rounded-sm border border-stone px-2 py-0.5 text-xs text-ink-secondary transition-colors hover:border-stone-strong hover:text-ink"
        >
          {ex.name}
        </button>
      ))}
    </div>
  )
}
