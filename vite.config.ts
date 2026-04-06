import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import mdx from 'fumadocs-mdx/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    mdx(await import('./source.config')),
    tailwindcss(),
    tanstackStart({
      server: { entry: './server.ts' },
      prerender: {
        enabled: true,
        crawlLinks: true,
        filter: (page: { path: string }) =>
          !page.path.startsWith('/playground') &&
          !page.path.startsWith('/login') &&
          !page.path.startsWith('/api/'),
      },
      pages: [
        { path: '/' },
        { path: '/docs' },
      ],
    }),
    react(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
