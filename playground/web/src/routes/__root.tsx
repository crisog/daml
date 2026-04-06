import { createRootRoute, Outlet } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const RouterDevtools = import.meta.env.DEV
  ? lazy(async () => {
      const mod = await import('@tanstack/router-devtools')
      return { default: mod.TanStackRouterDevtools }
    })
  : null

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent(): React.JSX.Element {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV && RouterDevtools ? (
        <Suspense fallback={null}>
          <RouterDevtools />
        </Suspense>
      ) : null}
    </>
  )
}
