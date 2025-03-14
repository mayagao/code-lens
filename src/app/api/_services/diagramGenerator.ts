import {
  ParsedFile,
  ParsedFunction,
  ParsedClass,
  ParsedHook,
  ParsedImport,
} from "./codeParser";

interface DiagramNode {
  id: string;
  label: string;
  type: "file" | "function" | "class" | "variable" | "hook";
}

interface DiagramEdge {
  from: string;
  to: string;
  type: "data" | "control";
  label?: string;
}

export class DiagramGeneratorService {
  private static instance: DiagramGeneratorService;
  private nodes: Map<string, DiagramNode>;
  private edges: DiagramEdge[];

  private constructor() {
    this.nodes = new Map();
    this.edges = [];
  }

  public static getInstance(): DiagramGeneratorService {
    if (!DiagramGeneratorService.instance) {
      DiagramGeneratorService.instance = new DiagramGeneratorService();
    }
    return DiagramGeneratorService.instance;
  }

  public generateDiagram(files: Map<string, ParsedFile>): string {
    this.nodes.clear();
    this.edges = [];

    // Process each file
    for (const [filename, parsedFile] of files.entries()) {
      this.processFile(filename, parsedFile);
    }

    // Generate the Mermaid diagram
    return this.generateMermaidCode();
  }

  private processFile(filename: string, file: ParsedFile) {
    const fileId = this.sanitizeId(filename);

    // Add file node
    this.nodes.set(fileId, {
      id: fileId,
      label: filename,
      type: "file",
    });

    // Process functions
    file.functions.forEach((func: ParsedFunction) => {
      const funcId = this.sanitizeId(`${fileId}_${func.name}`);
      this.nodes.set(funcId, {
        id: funcId,
        label: `${func.name}(${func.params.join(", ")})`,
        type: "function",
      });

      // Connect function to file
      this.edges.push({
        from: fileId,
        to: funcId,
        type: "control",
      });
    });

    // Process classes
    file.classes.forEach((cls: ParsedClass) => {
      const classId = this.sanitizeId(`${fileId}_${cls.name}`);
      this.nodes.set(classId, {
        id: classId,
        label: cls.name,
        type: "class",
      });

      // Connect class to file
      this.edges.push({
        from: fileId,
        to: classId,
        type: "control",
      });

      // Process class methods
      cls.methods.forEach((method: ParsedFunction) => {
        const methodId = this.sanitizeId(`${classId}_${method.name}`);
        this.nodes.set(methodId, {
          id: methodId,
          label: `${method.name}(${method.params.join(", ")})`,
          type: "function",
        });

        // Connect method to class
        this.edges.push({
          from: classId,
          to: methodId,
          type: "control",
        });
      });
    });

    // Process hooks
    file.hooks.forEach((hook: ParsedHook) => {
      const hookId = this.sanitizeId(`${fileId}_${hook.name}`);
      this.nodes.set(hookId, {
        id: hookId,
        label: hook.name,
        type: "hook",
      });

      // Connect hook to file
      this.edges.push({
        from: fileId,
        to: hookId,
        type: "data",
      });

      // Add dependencies if they exist
      if (hook.dependencies) {
        hook.dependencies.forEach((dep: string) => {
          // Look for matching variables or hooks
          const depNode = Array.from(this.nodes.values()).find((n) =>
            n.label.includes(dep)
          );
          if (depNode) {
            this.edges.push({
              from: depNode.id,
              to: hookId,
              type: "data",
              label: "dependency",
            });
          }
        });
      }
    });

    // Process imports to create connections between files
    file.imports.forEach((imp: ParsedImport) => {
      const importedFileId = this.sanitizeId(imp.source);
      if (this.nodes.has(importedFileId)) {
        this.edges.push({
          from: importedFileId,
          to: fileId,
          type: "control",
          label: "imports",
        });
      }
    });
  }

  private generateMermaidCode(): string {
    let code = "graph TD\n";

    // Style definitions
    code += "  %% Styles\n";
    code += "  classDef file fill:#f9f,stroke:#333,stroke-width:2px;\n";
    code += "  classDef function fill:#bbf,stroke:#333,stroke-width:1px;\n";
    code += "  classDef class fill:#fb7,stroke:#333,stroke-width:2px;\n";
    code += "  classDef hook fill:#bfb,stroke:#333,stroke-width:1px;\n";

    // Nodes
    code += "\n  %% Nodes\n";
    this.nodes.forEach((node) => {
      code += `  ${node.id}["${node.label}"]\n`;
      code += `  class ${node.id} ${node.type};\n`;
    });

    // Edges
    code += "\n  %% Edges\n";
    this.edges.forEach((edge) => {
      const style = edge.type === "data" ? "-.->|" : "-->|";
      const label = edge.label || "";
      code += `  ${edge.from}${style}${label}|${edge.to}\n`;
    });

    return code;
  }

  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, "_");
  }
}
