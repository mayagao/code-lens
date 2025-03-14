// Server-side only code parser
import { headers } from "next/headers";

interface TreeSitterModules {
  Parser: any;
  JavaScript: any;
  TypeScript: any;
}

let treeSitterModules: TreeSitterModules | null = null;

async function loadTreeSitter(): Promise<TreeSitterModules> {
  // This is a more reliable way to check for server-side code in Next.js
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      // Use require() for native modules on the server
      return {
        Parser: require("tree-sitter"),
        JavaScript: require("tree-sitter-javascript"),
        TypeScript: require("tree-sitter-typescript"),
      };
    } catch (error) {
      console.error("Failed to load tree-sitter:", error);
      throw error;
    }
  }
  throw new Error("Tree-sitter can only be loaded on the server side");
}

// Define types for Tree-sitter nodes
interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  parent: SyntaxNode | null;
  children: SyntaxNode[];
  childForFieldName(name: string): SyntaxNode | null;
  descendantsOfType(type: string): SyntaxNode[];
  previousSibling?: SyntaxNode;
}

export interface ParsedFunction {
  name: string;
  startLine: number;
  endLine: number;
  params: string[];
  isAsync: boolean;
  isExported: boolean;
}

export interface ParsedClass {
  name: string;
  startLine: number;
  endLine: number;
  methods: ParsedFunction[];
  isExported: boolean;
}

export interface ParsedVariable {
  name: string;
  line: number;
  type: "const" | "let" | "var";
  isExported: boolean;
}

export interface ParsedImport {
  source: string;
  specifiers: string[];
  line: number;
}

export interface ParsedHook {
  name: string;
  line: number;
  dependencies?: string[];
}

export interface FunctionCall {
  caller: string;
  callee: string;
  arguments: string[];
  line: number;
}

export interface StateUsage {
  name: string;
  type: "useState" | "useReducer" | "useContext" | "prop";
  setter?: string;
  dependencies?: string[];
  line: number;
}

export interface DataFlow {
  source: string;
  target: string;
  type: "prop" | "state" | "context";
  line: number;
}

export interface FunctionRelationship {
  source: string;
  target: string;
  type: "calls" | "imports" | "extends" | "implements";
  location: { line: number; column: number };
}

export interface PropRelationship {
  component: string;
  prop: string;
  value: string;
  isCallback: boolean;
  location: { line: number; column: number };
}

export interface StateEffect {
  state: string;
  operation: "read" | "write" | "dependency";
  location: { line: number; column: number };
  context: string; // function/component where this occurs
}

export interface ComponentUsage {
  usedIn: string[];
  props: {
    name: string;
    type: string;
    isRequired: boolean;
  }[];
  childComponents: string[];
  parentComponents: string[];
}

export interface ServiceDependency {
  service: string;
  methods: string[];
  usageLocations: {
    file: string;
    line: number;
  }[];
}

export interface ParsedFile {
  functions: ParsedFunction[];
  classes: ParsedClass[];
  variables: ParsedVariable[];
  imports: ParsedImport[];
  hooks: ParsedHook[];
  functionCalls: FunctionCall[];
  stateUsage: StateUsage[];
  dataFlow: DataFlow[];
  relationships: FunctionRelationship[];
  propFlow: PropRelationship[];
  stateEffects: StateEffect[];
  componentUsage?: ComponentUsage;
  serviceDependencies?: ServiceDependency[];
}

export class CodeParserService {
  private static instance: CodeParserService;
  private jsParser: any;
  private tsParser: any;
  private initialized: boolean = false;

  private constructor() {
    this.initialized = false;
  }

  private async initialize() {
    if (this.initialized) return;

    if (!treeSitterModules) {
      treeSitterModules = await loadTreeSitter();
    }

    const { Parser, JavaScript, TypeScript } = treeSitterModules;

    this.jsParser = new Parser();
    this.jsParser.setLanguage(JavaScript);

    this.tsParser = new Parser();
    this.tsParser.setLanguage(TypeScript.tsx);
    this.initialized = true;
  }

  public static getInstance(): CodeParserService {
    if (!CodeParserService.instance) {
      CodeParserService.instance = new CodeParserService();
    }
    return CodeParserService.instance;
  }

  private getParser(filename: string): any {
    return filename.endsWith(".ts") || filename.endsWith(".tsx")
      ? this.tsParser
      : this.jsParser;
  }

  public async parseFile(
    filename: string,
    content: string
  ): Promise<ParsedFile> {
    await this.initialize();

    const parser = this.getParser(filename);
    const tree = parser.parse(content);
    const root = tree.rootNode as SyntaxNode;

    const result: ParsedFile = {
      functions: [],
      classes: [],
      variables: [],
      imports: [],
      hooks: [],
      functionCalls: [],
      stateUsage: [],
      dataFlow: [],
      relationships: [],
      propFlow: [],
      stateEffects: [],
    };

    // Walk through the syntax tree
    this.walkTree(root, result);

    // Parse React hooks and data flow for React files
    if (filename.endsWith(".jsx") || filename.endsWith(".tsx")) {
      this.parseReactHooks(root, result);
      this.parseDataFlow(root, result);
      this.analyzeRelationships(root, result);
    }

    return result;
  }

  private walkTree(node: SyntaxNode, result: ParsedFile) {
    switch (node.type) {
      case "function_declaration":
      case "arrow_function":
        this.parseFunctionNode(node, result);
        break;
      case "class_declaration":
        this.parseClassNode(node, result);
        break;
      case "variable_declaration":
        this.parseVariableNode(node, result);
        break;
      case "import_declaration":
        this.parseImportNode(node, result);
        break;
    }

    for (const child of node.children) {
      this.walkTree(child, result);
    }
  }

  private parseFunctionNode(node: SyntaxNode, result: ParsedFile) {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const params = node
      .descendantsOfType("identifier")
      .filter((n) => n.parent?.type === "formal_parameters")
      .map((n) => n.text);

    const func: ParsedFunction = {
      name: nameNode.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      params,
      isAsync: node.previousSibling?.type === "async",
      isExported: this.isNodeExported(node),
    };

    result.functions.push(func);
  }

  private parseClassNode(node: SyntaxNode, result: ParsedFile) {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods = node
      .descendantsOfType("method_definition")
      .map((methodNode) => {
        const methodNameNode = methodNode.childForFieldName("name");
        if (!methodNameNode) return null;

        const params = methodNode
          .descendantsOfType("identifier")
          .filter((n) => n.parent?.type === "formal_parameters")
          .map((n) => n.text);

        return {
          name: methodNameNode.text,
          startLine: methodNode.startPosition.row + 1,
          endLine: methodNode.endPosition.row + 1,
          params,
          isAsync: methodNode.previousSibling?.type === "async",
          isExported: false,
        };
      })
      .filter((m): m is ParsedFunction => m !== null);

    const classDecl: ParsedClass = {
      name: nameNode.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      methods,
      isExported: this.isNodeExported(node),
    };

    result.classes.push(classDecl);
  }

  private parseVariableNode(node: SyntaxNode, result: ParsedFile) {
    const declarations = node.descendantsOfType("variable_declarator");
    const kind = node.previousSibling?.text as "const" | "let" | "var";

    for (const decl of declarations) {
      const nameNode = decl.childForFieldName("name");
      if (!nameNode) continue;

      const variable: ParsedVariable = {
        name: nameNode.text,
        line: decl.startPosition.row + 1,
        type: kind,
        isExported: this.isNodeExported(node),
      };

      result.variables.push(variable);
    }
  }

  private parseImportNode(node: SyntaxNode, result: ParsedFile) {
    const sourceNode = node.childForFieldName("source");
    if (!sourceNode) return;

    const specifiers = node
      .descendantsOfType("import_specifier")
      .map((spec) => {
        const nameNode = spec.childForFieldName("name");
        return nameNode ? nameNode.text : "";
      })
      .filter((name) => name !== "");

    const importDecl: ParsedImport = {
      source: sourceNode.text.replace(/['"]/g, ""),
      specifiers,
      line: node.startPosition.row + 1,
    };

    result.imports.push(importDecl);
  }

  private parseReactHooks(node: SyntaxNode, result: ParsedFile) {
    const callExpressions = node.descendantsOfType("call_expression");

    for (const expr of callExpressions) {
      const functionName = expr.childForFieldName("function")?.text;

      if (functionName?.startsWith("use")) {
        const hook: ParsedHook = {
          name: functionName,
          line: expr.startPosition.row + 1,
        };

        // Try to parse dependencies array for useEffect/useMemo/useCallback
        if (["useEffect", "useMemo", "useCallback"].includes(functionName)) {
          const args = expr.descendantsOfType("array");
          if (args.length > 0) {
            hook.dependencies = args[0]
              .descendantsOfType("identifier")
              .map((n) => n.text);
          }
        }

        result.hooks.push(hook);
      }
    }
  }

  private parseDataFlow(node: SyntaxNode, result: ParsedFile) {
    // Analyze function calls
    const callExpressions = node.descendantsOfType("call_expression");
    for (const expr of callExpressions) {
      const callee = expr.childForFieldName("function");
      const args = expr
        .descendantsOfType("identifier")
        .filter((n) => n.parent?.type === "arguments")
        .map((n) => n.text);

      if (callee) {
        const enclosingFunction = this.findEnclosingFunction(expr);
        const callerName =
          enclosingFunction?.name ||
          this.findFunctionComponent(expr)?.name ||
          "anonymous";

        result.functionCalls.push({
          caller: callerName,
          callee: callee.text,
          arguments: args,
          line: expr.startPosition.row + 1,
        });
      }
    }

    // Analyze state usage
    const variableDeclarations = node.descendantsOfType("variable_declaration");
    for (const decl of variableDeclarations) {
      // Check for useState calls
      const init = decl.descendantsOfType("call_expression")[0];
      const hookName = init?.childForFieldName("function")?.text;

      if (
        hookName?.includes("useState") ||
        (init?.childForFieldName("function")?.type === "member_expression" &&
          init?.childForFieldName("function")?.text.includes("useState"))
      ) {
        // Handle both array destructuring and regular assignment
        let stateName, setterName;
        const arrayPattern = decl.descendantsOfType("array_pattern")[0];

        if (arrayPattern) {
          [stateName, setterName] = arrayPattern
            .descendantsOfType("identifier")
            .map((n) => n.text);
        } else {
          stateName = decl.descendantsOfType("identifier")[0]?.text;
        }

        if (stateName) {
          result.stateUsage.push({
            name: stateName,
            type: "useState",
            setter: setterName,
            line: decl.startPosition.row + 1,
          });
        }
      }
    }

    // Analyze prop flow
    const jsxAttributes = node.descendantsOfType("jsx_attribute");
    for (const attr of jsxAttributes) {
      const propName = attr.childForFieldName("name")?.text;
      const value = attr.childForFieldName("value");

      if (propName && value) {
        const elementName = this.findJSXElementName(attr);
        const sourceName = this.findEnclosingComponentName(attr);

        if (elementName && sourceName) {
          result.dataFlow.push({
            source: sourceName,
            target: elementName,
            type: "prop",
            line: attr.startPosition.row + 1,
          });
        }
      }
    }
  }

  private findEnclosingFunction(
    node: SyntaxNode
  ): { name: string; type: string } | null {
    let current: SyntaxNode | null = node;
    while (current) {
      // Check for function declarations
      if (current.type === "function_declaration") {
        return {
          name: current.childForFieldName("name")?.text || "anonymous",
          type: "function",
        };
      }

      // Check for arrow functions
      if (current.type === "arrow_function") {
        const parent = current.parent;
        if (parent?.type === "variable_declarator") {
          return {
            name: parent.childForFieldName("name")?.text || "anonymous",
            type: "arrow",
          };
        }
      }

      // Check for method definitions
      if (current.type === "method_definition") {
        return {
          name: current.childForFieldName("name")?.text || "anonymous",
          type: "method",
        };
      }

      // Check for variable declarations that are functions
      if (
        current.type === "variable_declarator" &&
        (current.descendantsOfType("arrow_function").length > 0 ||
          current.descendantsOfType("function").length > 0)
      ) {
        return {
          name: current.childForFieldName("name")?.text || "anonymous",
          type: "variable",
        };
      }

      current = current.parent;
    }
    return null;
  }

  private findFunctionComponent(node: SyntaxNode): { name: string } | null {
    let current: SyntaxNode | null = node;
    while (current) {
      // Look for exported function declarations that return JSX
      if (
        current.type === "function_declaration" &&
        current.descendantsOfType("jsx_element").length > 0
      ) {
        return {
          name: current.childForFieldName("name")?.text || "anonymous",
        };
      }

      // Look for variable declarations that are function components
      if (
        current.type === "variable_declarator" &&
        current.descendantsOfType("jsx_element").length > 0
      ) {
        return {
          name: current.childForFieldName("name")?.text || "anonymous",
        };
      }

      current = current.parent;
    }
    return null;
  }

  private findJSXElementName(node: SyntaxNode): string | null {
    let current = node;
    while (current && current.type !== "jsx_element") {
      current = current.parent!;
    }
    return current?.childForFieldName("name")?.text || null;
  }

  private findEnclosingComponentName(node: SyntaxNode): string | null {
    const component = this.findFunctionComponent(node);
    if (component) return component.name;

    const func = this.findEnclosingFunction(node);
    if (func) return func.name;

    return "anonymous";
  }

  private isNodeExported(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node;
    while (current) {
      if (current.type === "export_statement") return true;
      current = current.parent;
    }
    return false;
  }

  private analyzeRelationships(node: SyntaxNode, result: ParsedFile) {
    // Track function calls and relationships
    this.analyzeFunctionCalls(node, result);

    // Track prop passing between components
    this.analyzePropFlow(node, result);

    // Track state usage and effects
    this.analyzeStateEffects(node, result);
  }

  private analyzeFunctionCalls(node: SyntaxNode, result: ParsedFile) {
    const callExpressions = node.descendantsOfType("call_expression");

    for (const expr of callExpressions) {
      const callee = expr.childForFieldName("function");
      if (!callee?.text) continue;

      const caller = this.findEnclosingFunction(expr);
      const callerName = caller?.name || "anonymous";

      // Track direct function calls
      result.relationships.push({
        source: callerName,
        target: callee.text,
        type: "calls",
        location: {
          line: expr.startPosition.row + 1,
          column: expr.startPosition.column,
        },
      });

      // Track callback props
      if (expr.parent?.type === "jsx_attribute") {
        const componentName = this.findJSXElementName(expr.parent);
        const propName = expr.parent.childForFieldName("name")?.text;
        if (componentName && propName) {
          result.propFlow.push({
            component: componentName,
            prop: propName,
            value: callee.text,
            isCallback: true,
            location: {
              line: expr.startPosition.row + 1,
              column: expr.startPosition.column,
            },
          });
        }
      }
    }
  }

  private analyzePropFlow(node: SyntaxNode, result: ParsedFile) {
    const jsxElements = node.descendantsOfType("jsx_element");

    for (const element of jsxElements) {
      const componentName = element.childForFieldName("name")?.text;
      if (!componentName) continue;

      const attributes = element.descendantsOfType("jsx_attribute");
      for (const attr of attributes) {
        const propName = attr.childForFieldName("name")?.text;
        const value = attr.childForFieldName("value");
        if (!propName || !value?.text) continue;

        // Track prop passing
        result.propFlow.push({
          component: componentName,
          prop: propName,
          value: value.text,
          isCallback: value.type === "call_expression",
          location: {
            line: attr.startPosition.row + 1,
            column: attr.startPosition.column,
          },
        });
      }
    }
  }

  private analyzeStateEffects(node: SyntaxNode, result: ParsedFile) {
    // Track useState declarations
    const stateDeclarations = this.findStateDeclarations(node);
    const stateSetters = new Set(
      stateDeclarations.map((d) => d.setter).filter(Boolean)
    );

    // Analyze all identifiers for state usage
    const identifiers = node.descendantsOfType("identifier");
    for (const id of identifiers) {
      const name = id.text;
      const context = this.findEnclosingComponentName(id);

      // Check state reads
      if (stateDeclarations.some((d) => d.name === name)) {
        result.stateEffects.push({
          state: name,
          operation: "read",
          location: {
            line: id.startPosition.row + 1,
            column: id.startPosition.column,
          },
          context,
        });
      }

      // Check state writes
      if (stateSetters.has(name)) {
        result.stateEffects.push({
          state: name,
          operation: "write",
          location: {
            line: id.startPosition.row + 1,
            column: id.startPosition.column,
          },
          context,
        });
      }
    }

    // Track useEffect dependencies
    const effects = node
      .descendantsOfType("call_expression")
      .filter(
        (expr) => expr.childForFieldName("function")?.text === "useEffect"
      );

    for (const effect of effects) {
      const deps =
        effect.descendantsOfType("array")[0]?.descendantsOfType("identifier") ||
        [];
      const context = this.findEnclosingComponentName(effect);

      for (const dep of deps) {
        result.stateEffects.push({
          state: dep.text,
          operation: "dependency",
          location: {
            line: dep.startPosition.row + 1,
            column: dep.startPosition.column,
          },
          context,
        });
      }
    }
  }

  private findStateDeclarations(
    node: SyntaxNode
  ): Array<{ name: string; setter?: string }> {
    const declarations: Array<{ name: string; setter?: string }> = [];

    const useStateNodes = node
      .descendantsOfType("call_expression")
      .filter((expr) => {
        const funcName = expr.childForFieldName("function")?.text;
        return funcName === "useState" || funcName?.includes("useState");
      });

    for (const useState of useStateNodes) {
      const declarator = useState.parent;
      if (declarator?.type === "variable_declarator") {
        const pattern = declarator.descendantsOfType("array_pattern")[0];
        if (pattern) {
          const [state, setter] = pattern
            .descendantsOfType("identifier")
            .map((id) => id.text);
          declarations.push({ name: state, setter });
        }
      }
    }

    return declarations;
  }

  public async analyzeComponentUsage(
    parsedFile: ParsedFile,
    allFiles: [string, ParsedFile][]
  ): Promise<ComponentUsage> {
    const usage: ComponentUsage = {
      usedIn: [],
      props: [],
      childComponents: [],
      parentComponents: [],
    };

    // Find component name from file path or exports
    const componentName = this.getComponentName(parsedFile);
    if (!componentName) return usage;

    // Analyze where this component is used
    for (const [filePath, file] of allFiles) {
      if (
        file.imports.some(
          (imp) =>
            imp.specifiers.includes(componentName) ||
            imp.source.includes(componentName)
        )
      ) {
        usage.usedIn.push(filePath);
      }
    }

    // Analyze props
    const propsInterface = this.findPropsInterface(parsedFile);
    if (propsInterface) {
      usage.props = this.extractPropsFromInterface(propsInterface);
    }

    // Analyze child components (components used within this component)
    const childComponents = new Set<string>();
    parsedFile.imports.forEach((imp) => {
      if (imp.source.includes("/components/")) {
        imp.specifiers.forEach((spec) => childComponents.add(spec));
      }
    });
    usage.childComponents = Array.from(childComponents);

    // Analyze parent components (components that use this component)
    const parentComponents = new Set<string>();
    allFiles.forEach(([_, file]) => {
      file.imports.forEach((imp) => {
        if (imp.specifiers.includes(componentName)) {
          const fileComponentName = this.getComponentName(file);
          if (fileComponentName) {
            parentComponents.add(fileComponentName);
          }
        }
      });
    });
    usage.parentComponents = Array.from(parentComponents);

    return usage;
  }

  public async analyzeServiceDependencies(
    parsedFile: ParsedFile,
    allFiles: [string, ParsedFile][]
  ): Promise<ServiceDependency[]> {
    const dependencies: ServiceDependency[] = [];
    const serviceImports = parsedFile.imports.filter((imp) =>
      imp.source.includes("/services/")
    );

    for (const imp of serviceImports) {
      const serviceName = imp.source.split("/").pop() || "";
      const methods = new Set<string>();
      const usageLocations: { file: string; line: number }[] = [];

      // Find service method calls
      parsedFile.functionCalls.forEach((call) => {
        if (imp.specifiers.includes(call.callee.split(".")[0])) {
          methods.add(call.callee.split(".")[1]);
          usageLocations.push({
            file: parsedFile.toString(),
            line: call.line,
          });
        }
      });

      if (methods.size > 0) {
        dependencies.push({
          service: serviceName,
          methods: Array.from(methods),
          usageLocations,
        });
      }
    }

    return dependencies;
  }

  private getComponentName(parsedFile: ParsedFile): string | null {
    // Try to find exported function or class that returns JSX
    const exportedComponent = parsedFile.functions.find(
      (f) => f.isExported && this.isReactComponent(f)
    );
    if (exportedComponent) return exportedComponent.name;

    const exportedClass = parsedFile.classes.find(
      (c) => c.isExported && this.isReactComponent(c)
    );
    if (exportedClass) return exportedClass.name;

    return null;
  }

  private isReactComponent(node: ParsedFunction | ParsedClass): boolean {
    // For simplicity, assume if it's exported and capitalized, it's a component
    return node.isExported && /^[A-Z]/.test(node.name);
  }

  private findPropsInterface(parsedFile: ParsedFile): SyntaxNode | null {
    const root = this.getParser(parsedFile.toString()).parse(
      parsedFile.toString()
    ).rootNode;
    const interfaces = root.descendantsOfType("interface_declaration");
    return interfaces.find((i) => i.text.includes("Props")) || null;
  }

  private extractPropsFromInterface(node: SyntaxNode): Array<{
    name: string;
    type: string;
    isRequired: boolean;
  }> {
    const props: Array<{
      name: string;
      type: string;
      isRequired: boolean;
    }> = [];

    const propertySignatures = node.descendantsOfType("property_signature");
    for (const prop of propertySignatures) {
      const nameNode = prop.childForFieldName("name");
      const typeNode = prop.childForFieldName("type");
      if (nameNode && typeNode) {
        props.push({
          name: nameNode.text,
          type: typeNode.text,
          isRequired: !prop.text.includes("?:"),
        });
      }
    }

    return props;
  }
}
