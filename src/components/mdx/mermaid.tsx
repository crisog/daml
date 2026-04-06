'use client';

import { use, useEffect, useId, useState } from 'react';
import type mermaidType from 'mermaid';

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : false,
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

const cache = new Map<string, Promise<unknown>>();

function cachePromise<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached as Promise<T>;

  const promise = fn();
  cache.set(key, promise);
  return promise;
}

export function Mermaid({ chart }: { chart: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return <MermaidContent chart={chart} />;
}

function MermaidContent({ chart }: { chart: string }) {
  const id = useId();
  const isDark = useIsDark();
  const theme = isDark ? 'dark' : 'default';

  const { default: mermaid } = use(
    cachePromise('mermaid', () => import('mermaid')),
  ) as { default: typeof mermaidType };

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    fontFamily: 'inherit',
    theme,
    themeCSS: 'margin: 1.5rem auto 0;',
    sequence: {
      useMaxWidth: false,
      mirrorActors: false,
      messageMargin: 40,
    },
  });

  const { svg, bindFunctions } = use(
    cachePromise(`${chart}-${theme}`, () =>
      mermaid.render(id, chart.replaceAll('\\n', '\n')),
    ),
  );

  return (
    <div
      className="my-4 overflow-x-auto"
      ref={(container) => {
        if (container) bindFunctions?.(container);
      }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid output must be inserted as SVG markup.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
