import { useState } from 'react'
import { Button } from '@base-ui/react/button'
import { submitExercise } from '../lib/canton'
import type { Party, ActiveContract } from '../lib/types'
import type { DamlChoice } from '../lib/daml-parser'

type ContractCardProps = {
  contract: ActiveContract
  choices: DamlChoice[]
  parties: Party[]
  onExercised: () => void
}

function shortId(id: string): string {
  return id.split('::')[0] ?? id
}

function shortTemplate(id: string): string {
  const parts = id.split(':')
  return parts.length >= 3 ? `${parts[parts.length - 2]}:${parts[parts.length - 1]}` : id
}

export function ContractCard({
  contract,
  choices,
  parties,
  onExercised,
}: ContractCardProps): React.JSX.Element {
  const [expandedChoice, setExpandedChoice] = useState<string | null>(null)
  const [choiceArgs, setChoiceArgs] = useState<Record<string, string>>({})
  const [actAsIds, setActAsIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleActAs(id: string) {
    setActAsIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function resolvePartyId(displayName: string): string {
    const party = parties.find((p) => p.displayName === displayName)
    return party?.id ?? displayName
  }

  async function handleExercise(choice: DamlChoice) {
    if (actAsIds.length === 0) return
    setSubmitting(true)
    setError(null)

    try {
      const args: Record<string, unknown> = {}
      for (const field of choice.fields) {
        const raw = choiceArgs[field.name] ?? ''
        if (field.type === 'Party') {
          args[field.name] = resolvePartyId(raw)
        } else if (field.type === 'Decimal' || field.type === 'Int') {
          args[field.name] = raw
        } else {
          args[field.name] = raw
        }
      }

      await submitExercise(actAsIds, contract.templateId, contract.contractId, choice.name, args)
      setExpandedChoice(null)
      setChoiceArgs({})
      onExercised()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Exercise failed')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = 'w-full rounded-md border border-stone bg-elevated px-2 py-1 text-xs'

  return (
    <div className="rounded-md border border-stone bg-page p-2">
      <div className="mb-1 text-xs font-medium text-accent">
        {shortTemplate(contract.templateId)}
      </div>
      <div className="mb-1.5 font-mono text-xs text-ink-muted">
        {contract.contractId.slice(0, 20)}...
      </div>

      <table className="mb-2 w-full text-xs">
        <tbody>
          {Object.entries(contract.createArguments).map(([key, val]) => (
            <tr key={key}>
              <td className="pr-3 align-top text-ink-muted">{key}</td>
              <td className="text-ink">
                {typeof val === 'string' ? shortId(val) : JSON.stringify(val)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {choices.length > 0 && (
        <div className="border-t border-stone pt-1.5">
          <div className="flex flex-wrap gap-1">
            {choices.map((c) => (
              <button
                key={c.name}
                onClick={() => {
                  setExpandedChoice(expandedChoice === c.name ? null : c.name)
                  setError(null)
                }}
                className={`rounded-sm px-2 py-0.5 text-xs ${
                  expandedChoice === c.name
                    ? 'bg-accent text-ink-inverted'
                    : 'bg-elevated text-ink-secondary hover:bg-stone'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {expandedChoice && (() => {
            const choice = choices.find((c) => c.name === expandedChoice)
            if (!choice) return null
            return (
              <div className="mt-2">
                <div className="mb-1.5">
                  <span className="text-xs text-ink-muted">Act as:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {parties.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => toggleActAs(p.id)}
                        className={`rounded-sm px-1.5 py-0.5 text-xs ${
                          actAsIds.includes(p.id)
                            ? 'bg-success text-ink-inverted'
                            : 'bg-elevated text-ink-secondary'
                        }`}
                      >
                        {p.displayName}
                      </button>
                    ))}
                  </div>
                </div>

                {choice.fields.map((field) => (
                  <div key={field.name} className="mb-1">
                    <label className="mb-0.5 block text-xs text-ink-muted">
                      {field.name}
                      <span className="ml-1 text-ink-muted/60">{field.type}</span>
                    </label>
                    {field.type === 'Party' && parties.length > 0 ? (
                      <select
                        value={choiceArgs[field.name] ?? ''}
                        onChange={(e) =>
                          setChoiceArgs((prev) => ({ ...prev, [field.name]: e.target.value }))
                        }
                        className={inputClass}
                      >
                        <option value="">Select party...</option>
                        {parties.map((p) => (
                          <option key={p.id} value={p.displayName}>
                            {p.displayName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={choiceArgs[field.name] ?? ''}
                        onChange={(e) =>
                          setChoiceArgs((prev) => ({ ...prev, [field.name]: e.target.value }))
                        }
                        className={inputClass}
                      />
                    )}
                  </div>
                ))}

                <Button
                  onClick={() => handleExercise(choice)}
                  disabled={submitting || actAsIds.length === 0}
                  className="mt-1 rounded-md bg-accent px-3 py-1 text-xs text-ink-inverted hover:bg-accent-hover"
                >
                  {submitting ? '...' : `Exercise ${choice.name}`}
                </Button>

                {error && (
                  <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-error-light p-2 text-xs text-error">
                    {error}
                  </pre>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
