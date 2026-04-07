import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import * as React from 'react';
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
        content: 'Write, deploy, and interact with Daml smart contracts in your browser.',
      },
      {
        property: 'og:title',
        content: 'Daml Playground',
      },
      {
        property: 'og:description',
        content: 'Write, deploy, and interact with Daml smart contracts in your browser.',
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
        content: 'Daml Playground',
      },
      {
        name: 'twitter:description',
        content: 'Write, deploy, and interact with Daml smart contracts in your browser.',
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
        <RootProvider>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
