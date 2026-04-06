import { useState } from 'react'
import { Button } from '@base-ui/react/button'
import { submitCreate, submitExercise } from '@/lib/playground/canton'
import type { Party } from '@/lib/playground/types'

type CommandPanelProps = {
  parties: Party[]
  onCommandSuccess: () => void
}

export function CommandPanel({ parties, onCommandSuccess }: CommandPanelProps): React.JSX.Element | null {
  const [mode, setMode] = useState<'create' | 'exercise'>('create')
  const [templateId, setTemplateId] = useState('')
  const [argsJson, setArgsJson] = useState('{}')
  const [contractId, setContractId] = useState('')
  const [choice, setChoice] = useState('')
  const [choiceArgsJson, setChoiceArgsJson] = useState('{}')
  const [actAsIds, setActAsIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (parties.length === 0) return null

  function toggleActAs(id: string) {
    setActAsIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      if (mode === 'create') {
        const args = JSON.parse(argsJson)
        await submitCreate(actAsIds, templateId, args)
        setResult('Contract created')
      } else {
        const args = JSON.parse(choiceArgsJson)
        await submitExercise(actAsIds, templateId, contractId, choice, args)
        setResult('Choice exercised')
      }
      onCommandSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Command failed')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = 'w-full rounded-md border border-stone bg-page px-2 py-1 text-xs'

  return (
    <div className="border-t border-stone p-3">
      <h3 className="mb-2 text-xs font-medium text-ink-secondary">Submit Command</h3>

      <div className="mb-2 flex gap-1">
        {(['create', 'exercise'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-sm px-2 py-0.5 text-xs capitalize ${
              mode === m ? 'bg-accent text-ink-inverted' : 'bg-elevated text-ink-secondary'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mb-2">
        <span className="text-xs text-ink-muted">Act as:</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {parties.map((p) => (
            <button
              key={p.id}
              onClick={() => toggleActAs(p.id)}
              className={`rounded-sm px-2 py-0.5 text-xs ${
                actAsIds.includes(p.id) ? 'bg-success text-ink-inverted' : 'bg-elevated text-ink-secondary'
              }`}
            >
              {p.displayName}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <input value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="Template ID" className={inputClass} />
        {mode === 'exercise' && (
          <>
            <input value={contractId} onChange={(e) => setContractId(e.target.value)} placeholder="Contract ID" className={inputClass} />
            <input value={choice} onChange={(e) => setChoice(e.target.value)} placeholder="Choice name" className={inputClass} />
          </>
        )}
        <textarea
          value={mode === 'create' ? argsJson : choiceArgsJson}
          onChange={(e) => (mode === 'create' ? setArgsJson(e.target.value) : setChoiceArgsJson(e.target.value))}
          placeholder={mode === 'create' ? 'Create arguments (JSON)' : 'Choice arguments (JSON)'}
          rows={3}
          className={`${inputClass} resize-none font-mono`}
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={submitting || actAsIds.length === 0 || !templateId}
        className="mt-2 rounded-md bg-accent px-3 py-1 text-xs text-ink-inverted hover:bg-accent-hover"
      >
        {submitting ? 'Submitting...' : 'Submit'}
      </Button>

      {result && <p className="mt-2 text-xs text-success">{result}</p>}
      {error && <pre className="mt-2 whitespace-pre-wrap rounded-md bg-error-light p-2 text-xs text-error">{error}</pre>}
    </div>
  )
}
