/**
 * Lightweight parser that extracts template metadata from Daml source text.
 * Not a full parser. Handles the common patterns used in playground code.
 */

export type DamlField = {
  name: string
  type: string
}

export type DamlChoice = {
  name: string
  nonconsuming: boolean
  fields: DamlField[]
}

export type DamlTemplate = {
  name: string
  fields: DamlField[]
  choices: DamlChoice[]
}

export function parseDamlSource(source: string): DamlTemplate[] {
  const templates: DamlTemplate[] = []
  const lines = source.split('\n')

  let i = 0
  while (i < lines.length) {
    const templateMatch = lines[i]?.match(/^template\s+(\w+)/)
    if (templateMatch) {
      const template = parseTemplate(lines, i, templateMatch[1]!)
      templates.push(template)
    }
    i++
  }

  return templates
}

function parseTemplate(lines: string[], start: number, name: string): DamlTemplate {
  const fields: DamlField[] = []
  const choices: DamlChoice[] = []

  let i = start + 1

  // Find "with" block for template fields
  while (i < lines.length) {
    const line = lines[i]!.trim()
    if (line === 'with') {
      i++
      // Parse fields until "where"
      while (i < lines.length) {
        const fieldLine = lines[i]!.trim()
        if (fieldLine === 'where') break
        const fieldMatch = fieldLine.match(/^(\w+)\s*:\s*(.+)/)
        if (fieldMatch) {
          fields.push({ name: fieldMatch[1]!, type: fieldMatch[2]!.trim() })
        }
        i++
      }
      break
    }
    // If we hit something that's not indented, stop
    if (line.length > 0 && !lines[i]!.startsWith(' ') && !lines[i]!.startsWith('\t')) break
    i++
  }

  // Find choices in the "where" block
  while (i < lines.length) {
    const line = lines[i]!
    // Stop if we hit a new top-level declaration
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) break

    const trimmed = line.trim()

    // Match "choice Foo : ReturnType" or "nonconsuming choice Foo : ReturnType"
    const choiceMatch = trimmed.match(/^(nonconsuming\s+|preconsuming\s+|postconsuming\s+)?choice\s+(\w+)\s*:/)
    if (choiceMatch) {
      const choice = parseChoice(lines, i, choiceMatch[2]!, !!choiceMatch[1]?.includes('nonconsuming'))
      choices.push(choice)
    }
    i++
  }

  return { name, fields, choices }
}

function parseChoice(lines: string[], start: number, name: string, nonconsuming: boolean): DamlChoice {
  const fields: DamlField[] = []
  let i = start + 1

  // Look for "with" block (choice arguments)
  while (i < lines.length) {
    const trimmed = lines[i]!.trim()
    if (trimmed === 'with') {
      i++
      // Parse choice argument fields until "controller" or "do"
      while (i < lines.length) {
        const fieldLine = lines[i]!.trim()
        if (fieldLine.startsWith('controller') || fieldLine === 'do') break
        const fieldMatch = fieldLine.match(/^(\w+)\s*:\s*(.+)/)
        if (fieldMatch) {
          fields.push({ name: fieldMatch[1]!, type: fieldMatch[2]!.trim() })
        }
        i++
      }
      break
    }
    // If we hit "controller" or "do" first, there are no choice args
    if (trimmed.startsWith('controller') || trimmed === 'do') break
    i++
  }

  return { name, nonconsuming, fields }
}
