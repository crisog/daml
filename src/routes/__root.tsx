import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import appCss from '@/styles/app.css?url';
import { RootProvider } from 'fumadocs-ui/provider/tanstack';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Daml Playground',
      },
      {
        name: 'description',
        content: 'An interactive sandbox for writing, compiling, and deploying Daml smart contracts. Create parties, exercise choices, and explore Canton ledger workflows without any local setup.',
      },
      {
        property: 'og:title',
        content: 'Daml Playground: Write and Deploy Smart Contracts in Your Browser',
      },
      {
        property: 'og:description',
        content: 'An interactive sandbox for writing, compiling, and deploying Daml smart contracts. Create parties, exercise choices, and explore Canton ledger workflows without any local setup.',
      },
      {
        property: 'og:image',
        content: 'https://daml.run/og.png',
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
      {
        name: 'twitter:title',
        content: 'Daml Playground: Write and Deploy Smart Contracts in Your Browser',
      },
      {
        name: 'twitter:description',
        content: 'An interactive sandbox for writing, compiling, and deploying Daml smart contracts. Create parties, exercise choices, and explore Canton ledger workflows without any local setup.',
      },
      {
        name: 'twitter:image',
        content: 'https://daml.run/og.png',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider theme={{ defaultTheme: 'dark', forcedTheme: 'dark', enableSystem: false }}>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
