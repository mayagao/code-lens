import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GitHubService } from "@/services/github";

interface RouteParams {
  params: {
    owner: string;
    repo: string;
  };
}

export async function GET(request: Request, context: RouteParams) {
  try {
    const params = await context.params;
    if (!params?.owner || !params?.repo) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const { owner, repo } = params;

    // Get current analysis
    const analysis = await prisma.repositoryAnalysis.findFirst({
      where: {
        repository: {
          owner,
          name: repo,
        },
      },
    });

    // If no analysis exists, updates are needed
    if (!analysis) {
      return NextResponse.json({ needsUpdate: true });
    }

    // Get latest commit
    const githubService = GitHubService.getInstance();
    const latestCommit = await githubService.getLatestCommit(owner, repo);

    // Compare commit SHAs
    const needsUpdate = analysis.lastAnalyzedCommit !== latestCommit.sha;

    return NextResponse.json({ needsUpdate });
  } catch (error) {
    console.error("Failed to check for updates:", error);
    return NextResponse.json(
      { error: "Failed to check for updates" },
      { status: 500 }
    );
  }
}
