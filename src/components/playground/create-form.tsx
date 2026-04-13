import { useState } from 'react'
import { Button } from '@base-ui/react/button'
import { submitCreate } from '@/lib/playground/canton'
import type { Party } from '@/lib/playground/types'
import type { DamlTemplate } from '@/lib/playground/daml-parser'

type CreateFormProps = {
  templates: DamlTemplate[]
  parties: Party[]
  onSuccess: (templateName: string, durationMs: number) => void
  onError?: (error: string) => void
}

export function CreateForm({ templates, parties, onSuccess, onError }: CreateFormProps): React.JSX.Element | null {
  const [selectedTemplate, setSelectedTemplate] = useState<string>(templates[0]?.name ?? '')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [actAsIds, setActAsIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  if (templates.length === 0) {
    return <p className="p-3 text-xs text-ink-muted">Deploy a contract to get started</p>
  }

  const template = templates.find((t) => t.name === selectedTemplate)

  function setField(name: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [name]: value }))
  }

  function toggleActAs(id: string) {
    setActAsIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function resolvePartyId(displayName: string): string {
    const party = parties.find((p) => p.displayName === displayName)
    return party?.id ?? displayName
  }

  async function handleSubmit() {
    if (!template) return
    setSubmitting(true)
    const start = Date.now()
    setResult(null)

    try {
      const args: Record<string, unknown> = {}
      const partyIds = new Set<string>()

      for (const field of template.fields) {
        const raw = fieldValues[field.name] ?? ''
        if (field.type === 'Party') {
          const resolved = resolvePartyId(raw)
          args[field.name] = resolved
          if (resolved) partyIds.add(resolved)
        } else if (field.type === 'Decimal' || field.type === 'Int') {
          args[field.name] = raw
        } else if (field.type === 'Bool') {
          args[field.name] = raw === 'true'
        } else {
          args[field.name] = raw
        }
      }

      // Auto-derive actAs from all Party fields used in the contract
      const derivedActAs = partyIds.size > 0 ? [...partyIds] : actAsIds

      await submitCreate(derivedActAs, `#playground-project:Main:${template.name}`, args)
      const ms = Date.now() - start
      setResult(`${template.name} created`)
      setFieldValues({})
      onSuccess(template.name, ms)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Create failed'
      onError?.(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = 'w-full rounded-md border border-stone bg-page px-2 py-1 text-xs'

  return (
    <div className="border-t border-stone p-3">
      <h3 className="mb-2 text-xs font-medium text-ink-secondary">Create Contract</h3>

      {templates.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {templates.map((t) => (
            <button
              key={t.name}
              onClick={() => {
                setSelectedTemplate(t.name)
                setFieldValues({})
              }}
              className={`rounded-sm border px-2 py-0.5 text-xs ${
                selectedTemplate === t.name
                  ? 'border-accent bg-accent-light text-accent'
                  : 'border-stone text-ink-secondary'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {template && (
        <>
          {templates.length <= 1 && (
            <p className="mb-2 text-xs text-ink-secondary">{template.name}</p>
          )}

          <div className="mb-2">
            <span className="text-xs text-ink-muted">Act as:</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {parties.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggleActAs(p.id)}
                  className={`rounded-sm border px-2 py-0.5 text-xs ${
                    actAsIds.includes(p.id)
                      ? 'border-accent bg-accent-light text-accent'
                      : 'border-stone text-ink-secondary'
                  }`}
                >
                  {p.displayName}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            {template.fields.map((field) => (
              <div key={field.name}>
                <label className="mb-0.5 block text-xs text-ink-muted">
                  {field.name}
                  <span className="ml-1 text-ink-muted/60">{field.type}</span>
                </label>
                {field.type === 'Party' && parties.length > 0 ? (
                  <select
                    value={fieldValues[field.name] ?? ''}
                    onChange={(e) => setField(field.name, e.target.value)}
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
                    value={fieldValues[field.name] ?? ''}
                    onChange={(e) => setField(field.name, e.target.value)}
                    placeholder={field.type === 'Decimal' ? '0.0' : field.type === 'Int' ? '0' : ''}
                    className={inputClass}
                  />
                )}
              </div>
            ))}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting || actAsIds.length === 0}
            className="mt-2 rounded-md bg-accent px-3 py-1 text-xs text-ink-inverted hover:bg-accent-hover"
          >
            {submitting ? 'Creating...' : `Create ${template.name}`}
          </Button>
        </>
      )}

      {result && <p className="mt-2 text-xs text-success">{result}</p>}
    </div>
  )
}
