import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type GitHubHeaders = Record<string, string>;

// GitHub API helper functions
async function fetchFromGitHub(endpoint: string, token?: string) {
  const headers: GitHubHeaders = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "codelens-mcp-server",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

interface TreeItem {
  path: string;
  type: string;
}

interface RepoAnalysisParams {
  owner: string;
  repo: string;
  branch: string;
}

interface RequestHandlerExtra {
  args?: Record<string, unknown>;
  runModel: (prompt: string) => Promise<string>;
}

interface GitHubHeaders {
  Accept: string;
  "User-Agent": string;
  Authorization?: string;
}

// Analyze code for concepts
function extractConcepts(code: string): string[] {
  // This is a placeholder - in practice, you'd want more sophisticated analysis
  const concepts = new Set<string>();

  // Look for common patterns
  if (code.includes("async")) concepts.add("async/await");
  if (code.includes("useState")) concepts.add("React Hooks");
  if (code.includes("try {")) concepts.add("Error Handling");
  if (code.includes("export")) concepts.add("ES Modules");
  if (code.includes("interface")) concepts.add("TypeScript Types");

  return Array.from(concepts);
}

// Create server instance
const server = new McpServer({
  name: "codelens-analysis",
  version: "1.0.0",
});

const repoAnalysisSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  branch: z.string().default("main").describe("Branch to analyze"),
});

// Repository Analysis Tool
server.tool(
  "analyze-repository",
  "Analyzes a GitHub repository and generates architecture diagrams",
  async (extra: RequestHandlerExtra) => {
    try {
      const token = process.env.GITHUB_TOKEN;
      const owner = extra.args?.owner as string;
      const repo = extra.args?.repo as string;
      const branch = (extra.args?.branch as string) || "main";

      if (!owner || !repo) {
        throw new Error("Missing required parameters: owner and repo");
      }

      // Fetch repository structure
      const repoInfo = await fetchFromGitHub(`/repos/${owner}/${repo}`, token);
      const contents = await fetchFromGitHub(
        `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
        token
      );

      // Get package info
      let packageJson;
      try {
        const packageData = await fetchFromGitHub(
          `/repos/${owner}/${repo}/contents/package.json`,
          token
        );
        packageJson = JSON.parse(
          Buffer.from(packageData.content, "base64").toString()
        );
      } catch (e) {
        packageJson = null;
      }

      // Get languages
      const languages = await fetchFromGitHub(
        `/repos/${owner}/${repo}/languages`,
        token
      );

      // Prepare repository data for Claude
      const repoData = {
        name: repoInfo.name,
        description: repoInfo.description,
        languages,
        dependencies: packageJson?.dependencies || {},
        devDependencies: packageJson?.devDependencies || {},
        structure: contents.tree.map((item: TreeItem) => ({
          path: item.path,
          type: item.type,
        })),
      };

      // Generate analysis prompt for Claude
      const prompt = `You are an expert software architect. Analyze this repository and provide:
1. A mermaid diagram showing the architecture and key components
2. A list of core concepts and patterns used in the codebase

Repository Information:
${JSON.stringify(repoData, null, 2)}

Please format your response as JSON with the following structure:
{
  "mermaidDiagram": "graph TD\\n...", // The mermaid diagram definition
  "concepts": [
    {
      "name": "string",
      "description": "string",
      "category": "language|framework|pattern|architecture",
      "confidence": number // 0-1 score
    }
  ]
}

Guidelines for the mermaid diagram:
1. Use graph TD for top-down diagrams
2. Group related components using subgraphs
3. Show key dependencies and data flow
4. Keep it high-level and focused on architecture
5. Use appropriate node shapes for different types (e.g., [Service], (Component), {Data})

Guidelines for concepts:
1. Focus on significant patterns and architectural decisions
2. Include tech stack choices with reasoning
3. Identify design patterns in use
4. Note any interesting engineering practices
5. Consider scalability and maintainability aspects`;

      // Get Claude's analysis
      const analysis = await extra.runModel(prompt);

      // Parse and validate the response
      try {
        const result = JSON.parse(analysis);
        if (!result.mermaidDiagram || !result.concepts) {
          throw new Error("Invalid analysis format");
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (parseError) {
        return {
          content: [
            {
              type: "text",
              text: `Error parsing analysis: ${
                parseError instanceof Error
                  ? parseError.message
                  : "Unknown error"
              }`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error analyzing repository: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 2: Enhanced Commit Analysis
server.tool(
  "analyze-commit",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    commit_sha: z.string().describe("Commit SHA to analyze"),
  },
  async ({ owner, repo, commit_sha }) => {
    try {
      const token = process.env.GITHUB_TOKEN;

      // Get commit info
      const commit = await fetchFromGitHub(
        `/repos/${owner}/${repo}/commits/${commit_sha}`,
        token
      );

      // Get the diff
      const headers = {
        Accept: "application/vnd.github.v3.diff",
        "User-Agent": "codelens-mcp-server",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const diffResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${commit_sha}`,
        { headers }
      );
      const diff = await diffResponse.text();

      // Extract concepts from the changes
      const concepts = extractConcepts(diff);

      const analysis = {
        commit: {
          sha: commit.sha,
          message: commit.commit.message,
          author: commit.commit.author,
          date: commit.commit.author.date,
        },
        changes: {
          files: commit.files.map((file: any) => ({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
          })),
          total: {
            additions: commit.stats.additions,
            deletions: commit.stats.deletions,
          },
        },
        concepts,
        diff,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(analysis, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error analyzing commit: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 3: Commit Range Analysis
server.tool(
  "analyze-commit-range",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    base: z.string().describe("Base commit SHA"),
    head: z.string().describe("Head commit SHA"),
  },
  async ({ owner, repo, base, head }) => {
    try {
      const token = process.env.GITHUB_TOKEN;

      // Get commits between base and head
      const comparison = await fetchFromGitHub(
        `/repos/${owner}/${repo}/compare/${base}...${head}`,
        token
      );

      // Analyze each commit
      const commits = comparison.commits.map((commit: any) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author.name,
        date: commit.commit.author.date,
      }));

      // Get aggregated changes
      const files = comparison.files.map((file: any) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      }));

      const analysis = {
        commits,
        changes: {
          files,
          total: {
            additions: comparison.total_commits,
            deletions: comparison.behind_by,
            commits: comparison.total_commits,
          },
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(analysis, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error analyzing commit range: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 4: Technology Stack Analysis
server.tool(
  "analyze-tech-stack",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
  },
  async ({ owner, repo }) => {
    try {
      const token = process.env.GITHUB_TOKEN;

      // Get languages used
      const languages = await fetchFromGitHub(
        `/repos/${owner}/${repo}/languages`,
        token
      );

      // Try to get package files
      let dependencies = {};
      let devDependencies = {};

      try {
        const packageJson = await fetchFromGitHub(
          `/repos/${owner}/${repo}/contents/package.json`,
          token
        );
        const decodedContent = Buffer.from(
          packageJson.content,
          "base64"
        ).toString();
        const pkg = JSON.parse(decodedContent);
        dependencies = pkg.dependencies || {};
        devDependencies = pkg.devDependencies || {};
      } catch (e) {
        // Package.json might not exist
      }

      const analysis = {
        languages,
        packageManager: {
          dependencies,
          devDependencies,
        },
        frameworks: {
          // Simple detection of common frameworks
          hasReact: "react" in dependencies,
          hasNextJs: "next" in dependencies,
          hasExpress: "express" in dependencies,
          hasTypeScript: "typescript" in devDependencies,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(analysis, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error analyzing tech stack: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("CodeLens MCP Server running on stdio");
