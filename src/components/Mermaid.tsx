import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

interface MermaidProps {
  chart: string;
  className?: string;
}

export default function Mermaid({ chart, className }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (containerRef.current && !showRaw) {
      mermaid.initialize({
        startOnLoad: true,
        theme: "default",
        securityLevel: "loose",
        fontFamily: "inherit",
      });

      mermaid.render("mermaid-svg", chart).then(({ svg }) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      });
    }
  }, [chart, showRaw]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          {showRaw ? "Show Diagram" : "Show Raw"}
        </button>
      </div>
      {showRaw ? (
        <pre className="p-4 bg-gray-50 rounded-lg overflow-auto text-sm">
          {chart}
        </pre>
      ) : (
        <div ref={containerRef} className={className} />
      )}
    </div>
  );
}
