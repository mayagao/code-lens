"use client";

import { useEffect, useRef } from "react";
import mermaid from "mermaid";

interface MermaidDiagramProps {
  definition: string;
  className?: string;
}

mermaid.initialize({
  startOnLoad: true,
  theme: "default",
  securityLevel: "loose",
  themeVariables: {
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  },
});

export function MermaidDiagram({
  definition,
  className = "",
}: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      mermaid.render("mermaid-diagram", definition).then(({ svg }) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      });
    }
  }, [definition]);

  return (
    <div ref={containerRef} className={`mermaid overflow-auto ${className}`} />
  );
}
