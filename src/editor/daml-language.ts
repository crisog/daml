import type * as Monaco from 'monaco-editor'

export function registerDamlLanguage(monaco: typeof Monaco): void {
  if (monaco.languages.getLanguages().some((l) => l.id === 'daml')) return

  monaco.languages.register({ id: 'daml', extensions: ['.daml'] })

  monaco.languages.setMonarchTokensProvider('daml', {
    keywords: [
      'module', 'where', 'import', 'template', 'with', 'do', 'let', 'in',
      'if', 'then', 'else', 'case', 'of', 'data', 'type', 'class', 'instance',
      'signatory', 'observer', 'controller', 'choice', 'nonconsuming',
      'preconsuming', 'postconsuming', 'ensure', 'create', 'exercise',
      'fetch', 'archive', 'return', 'pure', 'this', 'self', 'deriving',
    ],
    typeKeywords: [
      'Party', 'Text', 'Int', 'Decimal', 'Bool', 'Optional', 'ContractId',
      'Update', 'Script', 'Date', 'Time',
    ],
    operators: ['=', '->', '<-', '::', '=>', '|', '\\', '.', '@'],
    tokenizer: {
      root: [
        [/--\|.*$/, 'comment.doc'],
        [/--.*$/, 'comment'],
        [/\{-/, 'comment', '@comment'],
        [/"/, 'string', '@string'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/[a-z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/[A-Z]\w*/, { cases: { '@typeKeywords': 'type', '@default': 'type.identifier' } }],
        [/[=\->:<|\\@.]/, 'operator'],
      ],
      comment: [
        [/[^{-]+/, 'comment'],
        [/-\}/, 'comment', '@pop'],
        [/[{-]/, 'comment'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],
    },
  })

  monaco.languages.setLanguageConfiguration('daml', {
    comments: { lineComment: '--', blockComment: ['{-', '-}'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  })
}
