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
      registered.current = true
    }
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
