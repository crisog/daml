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

      monaco.editor.defineTheme('canton', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: 'F3FF97', fontStyle: 'bold' },
          { token: 'type', foreground: 'D5A5E3' },
          { token: 'type.identifier', foreground: 'D5A5E3' },
          { token: 'identifier', foreground: 'FFFFFC' },
          { token: 'number', foreground: 'b8a0ff' },
          { token: 'string', foreground: 'b8a0ff' },
          { token: 'string.escape', foreground: '875CFF' },
          { token: 'comment', foreground: '5a5660', fontStyle: 'italic' },
          { token: 'comment.doc', foreground: '7a7580', fontStyle: 'italic' },
          { token: 'operator', foreground: 'A89F91' },
        ],
        colors: {
          'editor.background': '#030206',
          'editor.foreground': '#FFFFFC',
          'editor.lineHighlightBackground': '#0d0b1280',
          'editor.selectionBackground': '#875CFF44',
          'editor.inactiveSelectionBackground': '#875CFF22',
          'editorCursor.foreground': '#F3FF97',
          'editorLineNumber.foreground': '#3d3a44',
          'editorLineNumber.activeForeground': '#A89F91',
          'editorIndentGuide.background': '#1a1720',
          'editorIndentGuide.activeBackground': '#2a2730',
          'editorWidget.background': '#0d0b12',
          'editorWidget.border': '#2a2730',
          'scrollbarSlider.background': '#875CFF33',
          'scrollbarSlider.hoverBackground': '#875CFF55',
          'scrollbarSlider.activeBackground': '#875CFF77',
        },
      })

      registered.current = true
    }

    monaco.editor.setTheme('canton')
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
        fontFamily: 'SF Mono, Cascadia Code, Fira Code, monospace',
      }}
    />
  )
}
