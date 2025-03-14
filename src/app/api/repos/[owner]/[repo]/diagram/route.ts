import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { DiagramGeneratorService } from "@/services/diagramGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: {
    owner: string;
    repo: string;
  };
}

export async function POST(request: Request, context: RouteParams) {
  try {
    const { parsedFiles, forceRegenerate } = await request.json();
    const { owner, repo } = context.params;

    if (!parsedFiles) {
      return NextResponse.json(
        { error: "Missing parsed files data" },
        { status: 400 }
      );
    }

    // Get or create repository record
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

    // Generate diagram
    const diagramService = DiagramGeneratorService.getInstance();
    const diagram = await diagramService.generateDiagram(
      parsedFiles,
      forceRegenerate,
      repository.id
    );

    return NextResponse.json(diagram);
  } catch (error) {
    console.error("Error generating diagram:", error);
    return NextResponse.json(
      {
        error: "Failed to generate diagram",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
