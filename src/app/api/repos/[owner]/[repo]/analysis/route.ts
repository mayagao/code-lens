import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    const analysis = await prisma.repositoryAnalysis.findFirst({
      where: {
        repository: {
          owner,
          name: repo,
        },
      },
      include: {
        concepts: true,
      },
    });

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Failed to fetch repository analysis:", error);
    return NextResponse.json(
      { error: "Failed to fetch repository analysis" },
      { status: 500 }
    );
  }
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
    const { mermaidDiagram, concepts, lastAnalyzedCommit } =
      await request.json();

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

    // Create or update analysis
    const analysis = await prisma.repositoryAnalysis.upsert({
      where: {
        repositoryId: repository.id,
      },
      create: {
        repositoryId: repository.id,
        mermaidDiagram,
        lastAnalyzedCommit,
        concepts: {
          create: concepts,
        },
      },
      update: {
        mermaidDiagram,
        lastAnalyzedCommit,
        concepts: {
          deleteMany: {},
          create: concepts,
        },
      },
      include: {
        concepts: true,
      },
    });

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Failed to update repository analysis:", error);
    return NextResponse.json(
      { error: "Failed to update repository analysis" },
      { status: 500 }
    );
  }
}
