import { useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { registerDamlLanguage } from './daml-language'

type DamlEditorProps = {
  value: string
  onChange: (value: string) => void
}

export function DamlEditor({ value, onChange }: DamlEditorProps): React.JSX.Element {
  const registered = useRef(false)

  const handleMount: OnMount = (editor, monaco) => {
    if (!registered.current) {
      registerDamlLanguage(monaco)

      monaco.editor.defineTheme('send', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: '40FB50', fontStyle: 'bold' },
          { token: 'type', foreground: 'FFD66E' },
          { token: 'type.identifier', foreground: 'FFD66E' },
          { token: 'identifier', foreground: 'FFFFFF' },
          { token: 'number', foreground: 'FFD66E' },
          { token: 'string', foreground: 'A8F5B0' },
          { token: 'string.escape', foreground: '40FB50' },
          { token: 'comment', foreground: '6B7779', fontStyle: 'italic' },
          { token: 'comment.doc', foreground: '8C9799', fontStyle: 'italic' },
          { token: 'operator', foreground: 'B3B3B3' },
        ],
        colors: {
          'editor.background': '#0E1A1C',
          'editor.foreground': '#FFFFFF',
          'editor.lineHighlightBackground': '#12202380',
          'editor.selectionBackground': '#40FB5044',
          'editor.inactiveSelectionBackground': '#40FB5022',
          'editorCursor.foreground': '#40FB50',
          'editorLineNumber.foreground': '#556062',
          'editorLineNumber.activeForeground': '#B3B3B3',
          'editorIndentGuide.background': '#162A2D',
          'editorIndentGuide.activeBackground': '#414D4F',
          'editorWidget.background': '#122023',
          'editorWidget.border': '#414D4F',
          'scrollbarSlider.background': '#40FB5033',
          'scrollbarSlider.hoverBackground': '#40FB5055',
          'scrollbarSlider.activeBackground': '#40FB5077',
        },
      })

      registered.current = true
    }

    monaco.editor.setTheme('send')
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, 'daml')
  }

  return (
    <Editor
      height="100%"
      defaultLanguage="daml"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        padding: { top: 16 },
        fontSize: 14,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        fontFamily: 'DM Mono, SF Mono, Cascadia Code, monospace',
      }}
    />
  )
}
