import { GitHubService } from "./github";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface RepositoryAnalysis {
  id: string;
  mermaidDiagram: string;
  lastAnalyzedCommit: string;
  concepts: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    confidence: number;
  }>;
}

interface AnalysisResult {
  mermaidDiagram: string;
  concepts: Array<{
    name: string;
    description: string;
    category: string;
    confidence: number;
  }>;
}

export class AnalysisService {
  private static instance: AnalysisService;
  private githubService: GitHubService;
  private mcpServer: McpServer;

  private constructor() {
    this.githubService = GitHubService.getInstance();
    this.mcpServer = new McpServer({
      name: "codelens-analysis",
      version: "1.0.0",
    });
  }

  static getInstance(): AnalysisService {
    if (!AnalysisService.instance) {
      AnalysisService.instance = new AnalysisService();
    }
    return AnalysisService.instance;
  }

  private async generateAnalysis(
    owner: string,
    repoName: string
  ): Promise<AnalysisResult> {
    // Call the MCP server through our API endpoint
    const response = await fetch("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: "analyze-repository",
        args: {
          owner,
          repo: repoName,
          branch: "main",
        },
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to generate repository analysis");
    }

    const result = await response.json();
    if (!result.mermaidDiagram || !result.concepts) {
      throw new Error("Invalid analysis format");
    }

    return result;
  }

  async analyzeRepository(
    owner: string,
    repoName: string
  ): Promise<RepositoryAnalysis> {
    // Check if we have a recent analysis
    const response = await fetch(`/api/repos/${owner}/${repoName}/analysis`);
    if (!response.ok) {
      throw new Error("Failed to fetch repository analysis");
    }

    const existingAnalysis = await response.json();
    if (existingAnalysis) {
      return existingAnalysis;
    }

    // Generate new analysis
    const analysisData = await this.generateAnalysis(owner, repoName);

    // Save the analysis
    const latestCommit = await this.githubService.getLatestCommit(
      owner,
      repoName
    );
    const saveResponse = await fetch(
      `/api/repos/${owner}/${repoName}/analysis`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mermaidDiagram: analysisData.mermaidDiagram,
          concepts: analysisData.concepts,
          lastAnalyzedCommit: latestCommit.sha,
        }),
      }
    );

    if (!saveResponse.ok) {
      throw new Error("Failed to save repository analysis");
    }

    return saveResponse.json();
  }

  async getRecentCommits(owner: string, repoName: string, limit: number = 10) {
    return this.githubService.getRecentCommits(owner, repoName, limit);
  }

  async checkForUpdates(owner: string, repoName: string): Promise<boolean> {
    const response = await fetch(`/api/repos/${owner}/${repoName}/updates`);
    if (!response.ok) {
      throw new Error("Failed to check for updates");
    }

    const { needsUpdate } = await response.json();
    return needsUpdate;
  }
}
