import { useEffect, useState } from "react";
import ReactFlow, {
  Controls,
  Background,
  Node,
  Edge,
  MarkerType,
  XYPosition,
} from "reactflow";
import "reactflow/dist/style.css";
import { DiagramGeneratorService } from "@/services/diagramGenerator";
import type { DiagramNode, DiagramEdge } from "@/services/diagramGenerator";

interface CodeFlowGraphProps {
  parsedFiles: Record<string, any>;
  repositoryId: string;
}

// Custom node styles based on type
const getNodeStyle = (type: string) => {
  const baseStyle = {
    padding: "10px",
    borderRadius: "8px",
  };

  switch (type) {
    case "file":
      return {
        ...baseStyle,
        border: "2px solid #e5e7eb",
        background: "white",
        width: 180,
      };
    case "component":
      return {
        ...baseStyle,
        border: "2px solid #818cf8",
        background: "#eef2ff",
        width: 200,
      };
    case "service":
      return {
        ...baseStyle,
        border: "2px solid #10b981",
        background: "#ecfdf5",
        width: 180,
      };
    case "state":
      return {
        ...baseStyle,
        border: "2px solid #93c5fd",
        background: "#eff6ff",
        borderRadius: "50%",
        width: 120,
        height: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      };
    case "function":
      return {
        ...baseStyle,
        border: "2px solid #86efac",
        background: "#f0fdf4",
        width: 150,
      };
    case "condition":
      return {
        ...baseStyle,
        border: "2px solid #fcd34d",
        background: "#fefce8",
        transform: "rotate(45deg)",
        width: 100,
        height: 100,
      };
    default:
      return baseStyle;
  }
};

// Edge styles based on type
const getEdgeStyle = (type: "data" | "control" | "import" | "service") => {
  switch (type) {
    case "data":
      return {
        stroke: "#3b82f6",
        strokeWidth: 2,
        strokeDasharray: "5 5",
      };
    case "control":
      return {
        stroke: "#22c55e",
        strokeWidth: 2,
      };
    case "import":
      return {
        stroke: "#818cf8",
        strokeWidth: 1,
        strokeDasharray: "3 3",
      };
    case "service":
      return {
        stroke: "#10b981",
        strokeWidth: 2,
        strokeDasharray: "10 2",
      };
    default:
      return {};
  }
};

// Transform parsed files into nodes and edges
const transformData = (
  parsedFiles: Record<string, any>,
  componentRelationships: Record<string, string[]>,
  serviceUsage: Record<string, string[]>
) => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const processedComponents = new Set<string>();
  const processedServices = new Set<string>();

  // Helper to add a node if it doesn't exist
  const addNodeIfNotExists = (
    id: string,
    type: string,
    label: string,
    details?: string
  ) => {
    if (!nodes.some((n) => n.id === id)) {
      nodes.push({
        id,
        type: "default",
        position: { x: 0, y: 0 }, // Will be positioned by layout
        style: getNodeStyle(type),
        data: { label, details },
      });
    }
  };

  // Process each file
  Object.entries(parsedFiles).forEach(([filePath, data]) => {
    // Add component nodes
    if (data.componentUsage) {
      const componentName = filePath
        .split("/")
        .pop()
        ?.replace(/\.[jt]sx?$/, "");
      if (componentName) {
        addNodeIfNotExists(
          componentName,
          "component",
          componentName,
          `Props: ${data.componentUsage.props.length}`
        );
        processedComponents.add(componentName);

        // Add edges for child components
        data.componentUsage.childComponents.forEach((child: string) => {
          edges.push({
            id: `${componentName}-${child}`,
            source: componentName,
            target: child,
            type: "smoothstep",
            style: getEdgeStyle("import"),
            animated: false,
            label: "uses",
          });
        });
      }
    }

    // Add service nodes and edges
    if (data.serviceDependencies) {
      data.serviceDependencies.forEach((dep: any) => {
        const serviceId = dep.service;
        addNodeIfNotExists(
          serviceId,
          "service",
          serviceId,
          `Methods: ${dep.methods.join(", ")}`
        );
        processedServices.add(serviceId);

        // Add edges for service usage
        const sourceId = filePath
          .split("/")
          .pop()
          ?.replace(/\.[jt]sx?$/, "");
        if (sourceId) {
          edges.push({
            id: `${sourceId}-${serviceId}`,
            source: sourceId,
            target: serviceId,
            type: "smoothstep",
            style: getEdgeStyle("service"),
            animated: true,
            label: `calls ${dep.methods.length} methods`,
          });
        }
      });
    }

    // Add data flow edges
    data.dataFlow?.forEach((flow: any) => {
      edges.push({
        id: `${flow.source}-${flow.target}-${flow.type}`,
        source: flow.source,
        target: flow.target,
        type: "smoothstep",
        style: getEdgeStyle("data"),
        animated: true,
        label: flow.type === "prop" ? "props" : "data",
      });
    });

    // Add control flow edges
    data.relationships?.forEach((rel: any) => {
      if (rel.type === "calls") {
        edges.push({
          id: `${rel.source}-${rel.target}-call`,
          source: rel.source,
          target: rel.target,
          type: "smoothstep",
          style: getEdgeStyle("control"),
          animated: false,
          label: "calls",
        });
      }
    });
  });

  return { nodes, edges };
};

export default function CodeFlowGraph({
  parsedFiles,
  repositoryId,
}: CodeFlowGraphProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);

  const generateDiagram = async (forceRegenerate: boolean = false) => {
    try {
      setLoading(true);
      const [owner, repo] = repositoryId.split("/");

      const response = await fetch(`/api/repos/${owner}/${repo}/diagram`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parsedFiles,
          forceRegenerate,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate diagram");
      }

      const data = await response.json();
      const { nodes, edges } = transformData(
        data.parsedFiles,
        data.componentRelationships,
        data.serviceUsage
      );

      setNodes(nodes);
      setEdges(edges);
      setSummaries(data.summaries);
      setLastGeneratedAt(new Date().toLocaleString());
      setError(null);
    } catch (err) {
      console.error("Failed to generate diagram:", err);
      setError("Failed to generate diagram. Please try again.");
    } finally {
      setLoading(false);
      setIsRegenerating(false);
    }
  };

  useEffect(() => {
    generateDiagram(false);
  }, [parsedFiles, repositoryId]);

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    await generateDiagram(true);
  };

  if (loading) {
    return (
      <div className="h-[800px] border rounded-lg flex items-center justify-center">
        <div className="text-gray-500">
          {isRegenerating ? "Regenerating diagram..." : "Generating diagram..."}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-[800px] border rounded-lg flex items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-500">
          {lastGeneratedAt && `Last generated: ${lastGeneratedAt}`}
        </div>
        <button
          onClick={handleRegenerate}
          disabled={isRegenerating}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isRegenerating ? "Regenerating..." : "Regenerate Diagram"}
        </button>
      </div>

      <div className="h-[800px] border rounded-lg">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          defaultEdgeOptions={{
            type: "smoothstep",
          }}
        >
          <Controls />
          <Background color="#aaa" gap={16} />
        </ReactFlow>
      </div>

      {/* File Summaries */}
      <div className="space-y-2">
        <h3 className="font-medium text-lg">File Summaries</h3>
        {Object.entries(summaries).map(([filename, summary]) => (
          <div key={filename} className="p-3 bg-gray-50 rounded-lg">
            <div className="font-medium">{filename}</div>
            <div className="text-sm text-gray-600">{summary}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
