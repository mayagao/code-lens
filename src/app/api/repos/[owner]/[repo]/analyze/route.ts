import { NextResponse } from "next/server";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { GitHubService } from "@/services/github";
import { ClaudeService } from "@/services/claude";
import { CodeParserService } from "@/app/api/_services/codeParser";
import { DiagramGeneratorService } from "@/app/api/_services/diagramGenerator";

// Force this route to be server-side only
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  // Ensure we're on the server
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return NextResponse.json(
      { error: "This API route must be called from the server" },
      { status: 400 }
    );
  }

  try {
    const params = await context.params;
    if (!params?.owner || !params?.repo) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const { owner, repo } = params;

    // Get repository files
    const githubService = GitHubService.getInstance();
    let files;
    try {
      files = await githubService.getRepositoryContents(owner, repo);
      console.log(`Found ${files.length} files to analyze`);
    } catch (error) {
      console.error("Failed to fetch repository contents:", error);
      return NextResponse.json(
        { error: "Failed to fetch repository contents" },
        { status: 500 }
      );
    }

    // Parse files
    const codeParserService = CodeParserService.getInstance();
    const parsedFiles = new Map();
    const componentRelationships = new Map();
    const serviceUsage = new Map();

    // First pass: Parse all files
    for (const file of files) {
      if (
        file.path.endsWith(".js") ||
        file.path.endsWith(".jsx") ||
        file.path.endsWith(".ts") ||
        file.path.endsWith(".tsx")
      ) {
        try {
          const parsed = await codeParserService.parseFile(
            file.path,
            file.content
          );
          parsedFiles.set(file.path, parsed);

          // Track component imports and relationships
          if (parsed.imports) {
            for (const imp of parsed.imports) {
              if (imp.source.includes("/components/")) {
                if (!componentRelationships.has(file.path)) {
                  componentRelationships.set(file.path, new Set());
                }
                componentRelationships.get(file.path).add(imp.source);
              }
              if (imp.source.includes("/services/")) {
                if (!serviceUsage.has(file.path)) {
                  serviceUsage.set(file.path, new Set());
                }
                serviceUsage.get(file.path).add(imp.source);
              }
            }
          }
        } catch (error) {
          console.error(`Failed to parse file ${file.path}:`, error);
          continue;
        }
      }
    }

    // Second pass: Analyze relationships
    for (const [filePath, parsed] of parsedFiles.entries()) {
      try {
        // Analyze component usage
        const componentUsage = await codeParserService.analyzeComponentUsage(
          parsed,
          Array.from(parsedFiles.entries())
        );
        parsed.componentUsage = componentUsage;

        // Analyze service dependencies
        const serviceDeps = await codeParserService.analyzeServiceDependencies(
          parsed,
          Array.from(parsedFiles.entries())
        );
        parsed.serviceDependencies = serviceDeps;

        // Update the parsed file
        parsedFiles.set(filePath, parsed);
      } catch (error) {
        console.error(
          `Failed to analyze relationships for ${filePath}:`,
          error
        );
        continue;
      }
    }

    // Convert Maps to regular objects for JSON serialization
    const parsedFilesObject = Object.fromEntries(parsedFiles);
    const componentRelationshipsObject = Object.fromEntries(
      Array.from(componentRelationships.entries()).map(([key, value]) => [
        key,
        Array.from(value),
      ])
    );
    const serviceUsageObject = Object.fromEntries(
      Array.from(serviceUsage.entries()).map(([key, value]) => [
        key,
        Array.from(value),
      ])
    );

    return NextResponse.json({
      totalFiles: files.length,
      parsedFiles: parsedFilesObject,
      componentRelationships: componentRelationshipsObject,
      serviceUsage: serviceUsageObject,
    });
  } catch (error) {
    console.error("Error in analyze route:", error);
    return NextResponse.json(
      {
        error: "Failed to analyze repository",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
