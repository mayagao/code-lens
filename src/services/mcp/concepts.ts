// Types for concept detection
export interface DetectedConcept {
  name: string;
  confidence: number; // 0-1
  location?: {
    file: string;
    line: number;
  };
}

// Patterns for concept detection
const CONCEPT_PATTERNS = {
  "async/await": {
    pattern: /\basync\s+|await\b/,
    description: "Asynchronous programming with async/await",
  },
  "React Hooks": {
    pattern: /\buse[A-Z]\w+/,
    description: "React Hook usage",
  },
  "TypeScript Types": {
    pattern: /\binterface\b|\btype\b|\b:\s*[A-Z]\w+/,
    description: "TypeScript type definitions",
  },
  "Error Handling": {
    pattern: /\btry\s*{|\bcatch\s*\(|\bthrow\b/,
    description: "Error handling patterns",
  },
  "ES Modules": {
    pattern: /\b(import|export)\b/,
    description: "ES Module system usage",
  },
} as const;

export function extractConcepts(
  code: string,
  filename?: string
): DetectedConcept[] {
  const concepts: DetectedConcept[] = [];

  // Split code into lines for location tracking
  const lines = code.split("\n");

  for (const [conceptName, { pattern }] of Object.entries(CONCEPT_PATTERNS)) {
    // Check each line for the pattern
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        concepts.push({
          name: conceptName,
          confidence: 0.8, // Could be more sophisticated
          location: filename
            ? {
                file: filename,
                line: index + 1,
              }
            : undefined,
        });
      }
    });
  }

  // Remove duplicates by concept name
  return Array.from(new Map(concepts.map((c) => [c.name, c])).values());
}

// Framework detection based on dependencies
export function detectFrameworks(dependencies: Record<string, string> = {}) {
  return {
    hasReact: "react" in dependencies,
    hasNextJs: "next" in dependencies,
    hasExpress: "express" in dependencies,
    hasTypeScript: "typescript" in dependencies,
  };
}
