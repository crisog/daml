'use client';

import { useEffect, useMemo, useState } from 'react';
import mermaid from 'mermaid';

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

type MermaidProps = {
  chart: string;
};

export function Mermaid({ chart }: MermaidProps) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const isDark = useIsDark();
  const renderId = useMemo(
    () => `mermaid-${Math.random().toString(36).slice(2)}`,
    [],
  );

  useEffect(() => {
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      fontFamily: 'inherit',
      theme: isDark ? 'dark' : 'default',
      sequence: {
        useMaxWidth: false,
        mirrorActors: false,
        messageMargin: 40,
      },
    });

    mermaid
      .render(renderId, chart.replaceAll('\\n', '\n'))
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) {
          setSvg(renderedSvg);
          setError('');
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setSvg('');
          setError(e instanceof Error ? e.message : 'Failed to render diagram.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chart, renderId, isDark]);

  if (error) {
    return (
      <div className="border rounded-lg p-4 text-sm text-red-600">
        Mermaid render error: {error}
      </div>
    );
  }

  if (!svg) {
    return <div className="text-sm text-fd-muted-foreground">Rendering diagram...</div>;
  }

  // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid output must be inserted as SVG markup.
  return (
    <div
      className="my-4 overflow-x-auto [&>svg]:mx-auto [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
