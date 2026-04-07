import { createFileRoute } from '@tanstack/react-router'
import { loadUserSession } from '@/lib/session.functions'

export const Route = createFileRoute('/')({
  loader: async () => {
    try {
      return await loadUserSession()
    } catch {
      return null
    }
  },
})
