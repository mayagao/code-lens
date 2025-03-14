import { ClaudeService } from "./claude";
import prisma from "@/lib/prisma";

export interface DiagramNode {
  id: string;
  label: string;
  type: "file" | "state" | "function" | "condition";
  details?: string;
  position?: { x: number; y: number };
}

export interface DiagramEdge {
  source: string;
  target: string;
  label: string;
  type: "data" | "control";
  details?: string;
}

export interface DiagramStructure {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  summaries: Record<string, string>;
}

const DIAGRAM_PROMPT = `Analyze this codebase structure and generate a diagram showing data and control flow.
Focus on:
1. Data Flow
   - React state and props
   - Function arguments and returns
   - External data sources

2. Control Flow
   - Function calls
   - Conditional logic
   - Event handlers

Generate a JSON response with this structure:
{
  "nodes": [
    {
      "id": string,
      "label": string,
      "type": "file" | "state" | "function" | "condition",
      "details": string (optional)
    }
  ],
  "edges": [
    {
      "source": string (node id),
      "target": string (node id),
      "label": string,
      "type": "data" | "control",
      "details": string (optional)
    }
  ],
  "summaries": {
    [filename: string]: string (role description)
  }
}

Rules:
1. Use descriptive labels for edges to show the type of relationship
2. Include all important control flow paths
3. Show data dependencies between components
4. Provide meaningful summaries for each file

Code Structure:
`;

export class DiagramGeneratorService {
  private static instance: DiagramGeneratorService;
  private claude: ClaudeService;

  private constructor() {
    this.claude = ClaudeService.getInstance();
  }

  static getInstance(): DiagramGeneratorService {
    if (!DiagramGeneratorService.instance) {
      DiagramGeneratorService.instance = new DiagramGeneratorService();
    }
    return DiagramGeneratorService.instance;
  }

  async generateDiagram(
    parsedFiles: Record<string, any>,
    forceRegenerate: boolean = false,
    repositoryId?: string
  ): Promise<DiagramStructure> {
    try {
      const codeStructure = JSON.stringify(parsedFiles, null, 2);

      // Check for existing diagram if not forcing regeneration
      if (!forceRegenerate && repositoryId) {
        const existingDiagram = await prisma.repositoryDiagram.findFirst({
          where: {
            repositoryId,
            codeStructure,
          },
        });

        if (existingDiagram) {
          const diagram = JSON.parse(
            existingDiagram.diagram
          ) as DiagramStructure;
          return this.addNodePositions(diagram);
        }
      }

      // Generate new diagram
      const prompt = DIAGRAM_PROMPT + codeStructure;
      const response = await this.claude.analyzeRepository([
        {
          path: "codebase",
          content: codeStructure,
        },
      ]);

      const diagram = JSON.parse(response.overview) as DiagramStructure;
      const positionedDiagram = this.addNodePositions(diagram);

      // Store in database if repository ID is provided
      if (repositoryId) {
        await prisma.repositoryDiagram.upsert({
          where: {
            repositoryId_codeStructure: {
              repositoryId,
              codeStructure,
            },
          },
          create: {
            repositoryId,
            codeStructure,
            diagram: JSON.stringify(positionedDiagram),
            generatedAt: new Date(),
          },
          update: {
            diagram: JSON.stringify(positionedDiagram),
            generatedAt: new Date(),
          },
        });
      }

      return positionedDiagram;
    } catch (error) {
      console.error("Failed to generate diagram:", error);
      throw error;
    }
  }

  private addNodePositions(diagram: DiagramStructure): DiagramStructure {
    return {
      ...diagram,
      nodes: diagram.nodes.map((node, index) => ({
        ...node,
        position: node.position || {
          x: Math.cos((index * 2 * Math.PI) / diagram.nodes.length) * 300 + 400,
          y: Math.sin((index * 2 * Math.PI) / diagram.nodes.length) * 300 + 300,
        },
      })),
    };
  }
}
