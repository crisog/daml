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

      monaco.editor.defineTheme('github-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: 'f97583' },
          { token: 'type', foreground: 'b392f0' },
          { token: 'type.identifier', foreground: 'b392f0' },
          { token: 'identifier', foreground: 'e1e4e8' },
          { token: 'number', foreground: '79b8ff' },
          { token: 'string', foreground: '9ecbff' },
          { token: 'string.escape', foreground: '79b8ff' },
          { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
          { token: 'comment.doc', foreground: '6a737d', fontStyle: 'italic' },
          { token: 'operator', foreground: 'e1e4e8' },
        ],
        colors: {
          'editor.background': '#0E1A1C',
          'editor.foreground': '#e1e4e8',
          'editor.lineHighlightBackground': '#12202380',
          'editor.selectionBackground': '#40FB5044',
          'editor.inactiveSelectionBackground': '#40FB5022',
          'editorCursor.foreground': '#FFFFFF',
          'editorLineNumber.foreground': '#556062',
          'editorLineNumber.activeForeground': '#B3B3B3',
          'editorIndentGuide.background': '#162A2D',
          'editorIndentGuide.activeBackground': '#414D4F',
          'editorWidget.background': '#122023',
          'editorWidget.border': '#414D4F',
          'scrollbarSlider.background': '#6a737d33',
          'scrollbarSlider.hoverBackground': '#6a737d44',
          'scrollbarSlider.activeBackground': '#6a737d88',
        },
      })

      registered.current = true
    }

    monaco.editor.setTheme('github-dark')
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
