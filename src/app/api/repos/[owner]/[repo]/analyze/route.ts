import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GitHubService } from "@/services/github";
import { ClaudeService } from "@/services/claude";

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface RouteParams {
  params: {
    owner: string;
    repo: string;
  };
}

interface AnalysisProgress {
  step: string;
  status: "pending" | "in_progress" | "completed" | "error";
  error?: string;
}

export async function POST(request: Request, context: RouteParams) {
  try {
    const params = await context.params;
    if (!params?.owner || !params?.repo) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const { owner, repo } = params;

    // Check cache first
    const existingAnalysis = await prisma.repositoryAnalysis.findFirst({
      where: {
        repository: {
          owner,
          name: repo,
        },
        updatedAt: {
          gt: new Date(Date.now() - CACHE_DURATION),
        },
      },
    });

    if (existingAnalysis) {
      console.log("Using cached analysis");
      return NextResponse.json(existingAnalysis);
    }

    const progress: AnalysisProgress[] = [
      { step: "Fetching repository structure", status: "pending" },
      { step: "Analyzing core files", status: "pending" },
      { step: "Generating architecture diagram", status: "pending" },
    ];

    // Get repository files
    const githubService = GitHubService.getInstance();
    let files;
    try {
      progress[0].status = "in_progress";
      files = await githubService.getRepositoryContents(owner, repo);
      console.log(`Found ${files.length} files to analyze`);
      progress[0].status = "completed";
    } catch (error) {
      progress[0].status = "error";
      progress[0].error =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to fetch repository contents:", error);
      return NextResponse.json(
        { error: "Failed to fetch repository contents", progress },
        { status: 500 }
      );
    }

    // Get package.json if it exists
    let packageJson;
    try {
      progress[1].status = "in_progress";
      const packageJsonContent = await githubService.getRepositoryContents(
        owner,
        repo,
        "package.json"
      );
      if (packageJsonContent.length > 0) {
        packageJson = JSON.parse(packageJsonContent[0].content);
        console.log("Successfully parsed package.json");
      }
      progress[1].status = "completed";
    } catch (e) {
      console.log("No package.json found or failed to parse");
      progress[1].status = "completed"; // Not an error, just no package.json
    }

    // Generate analysis using Claude
    try {
      progress[2].status = "in_progress";
      const claudeService = ClaudeService.getInstance();
      const analysis = await claudeService.analyzeRepository(
        files,
        packageJson
      );
      console.log("Successfully generated analysis with Claude");
      progress[2].status = "completed";

      // Get or create repository
      const repository = await prisma.repository.upsert({
        where: {
          owner_name: {
            owner,
            name: repo,
          },
        },
        create: {
          owner,
          name: repo,
          githubId: `${owner}/${repo}`,
        },
        update: {},
      });

      // Get latest commit
      const latestCommit = await githubService.getLatestCommit(owner, repo);

      // Save analysis
      const savedAnalysis = await prisma.repositoryAnalysis.upsert({
        where: {
          repositoryId: repository.id,
        },
        create: {
          repositoryId: repository.id,
          mermaidDiagram: analysis.mermaidDiagram,
          overview: analysis.overview,
          lastAnalyzedCommit: latestCommit.sha,
        },
        update: {
          mermaidDiagram: analysis.mermaidDiagram,
          overview: analysis.overview,
          lastAnalyzedCommit: latestCommit.sha,
        },
      });

      return NextResponse.json({ ...savedAnalysis, progress });
    } catch (error) {
      progress[2].status = "error";
      progress[2].error =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to generate or save analysis:", error);
      return NextResponse.json(
        {
          error: "Failed to generate or save analysis",
          details: error instanceof Error ? error.message : "Unknown error",
          progress,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Top level error in analyze route:", error);
    return NextResponse.json(
      {
        error: "Failed to analyze repository",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
