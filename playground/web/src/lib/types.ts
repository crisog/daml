export type Party = {
  id: string
  displayName: string
}

export type ActiveContract = {
  contractId: string
  templateId: string
  createArguments: Record<string, unknown>
  signatories: string[]
  observers: string[]
}

export type CompileResult = {
  success: boolean
  errors?: string[]
}
