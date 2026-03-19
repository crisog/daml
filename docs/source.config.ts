import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import type { LanguageRegistration } from 'shiki';
import damlGrammar from '../external/daml/sdk/compiler/daml-extension/syntaxes/daml.json';

const damlLanguage: LanguageRegistration = {
  ...(damlGrammar as LanguageRegistration),
  name: 'daml',
  aliases: ['DAML', 'Daml'],
};

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid],
    rehypeCodeOptions: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      langs: [damlLanguage],
    },
  },
});
