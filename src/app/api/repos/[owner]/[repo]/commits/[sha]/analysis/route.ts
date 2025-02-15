import { NextRequest } from "next/server";
import { getDiff } from "@/services/mcp/github";
import prisma from "@/lib/prisma";
import { createCompletion } from "@/services/claude";
import { GitHubService } from "@/services/github";
import { z } from "zod";
import {
  PrismaClientKnownRequestError,
  PrismaClientInitializationError,
} from "@prisma/client/runtime/library";

// Define Zod schemas for our analysis structure
const CodeChangeSchema = z.object({
  type: z.enum(["New Feature", "Refactor", "Chore", "Cleanup", "Config"]),
  file: z.string(),
  lines: z.string(),
  explanation: z.string(),
});

const ArchitectureDiagramSchema = z.object({
  diagram: z.string().startsWith("graph TD"),
  explanation: z.string(),
});

const ReactConceptSchema = z.object({
  concept: z.string(),
  codeSnippet: z.string(),
  explanation: z.string(),
});

const AnalysisSchema = z.object({
  codeChanges: z.array(CodeChangeSchema),
  architectureDiagram: ArchitectureDiagramSchema,
  reactConcept: ReactConceptSchema,
});

// Add a default valid analysis structure
const DEFAULT_ANALYSIS = {
  codeChanges: [
    {
      type: "Chore" as const,
      file: "unknown",
      lines: "N/A",
      explanation: "No analysis available",
    },
  ],
  architectureDiagram: {
    diagram: "graph TD\n  A[No Analysis] -->|Generate New| B[Try Again]",
    explanation: "No architecture diagram available",
  },
  reactConcept: {
    concept: "None",
    codeSnippet: "// No code snippet available",
    explanation: "No React concept analysis available",
  },
};

export async function GET(
  req: NextRequest,
  { params }: { params: { owner: string; repo: string; sha: string } }
) {
  const { owner, repo, sha } = await Promise.resolve(params);
  const forceRegenerate = req.nextUrl.searchParams.get("force") === "true";

  try {
    // First try to find existing analysis in database
    const existingAnalysis = await prisma.commitAnalysis.findFirst({
      where: {
        AND: [{ repository: { owner, name: repo } }, { commitSha: sha }],
      },
      include: {
        repository: true,
      },
    });

    // Check if we have a valid existing analysis with code changes and not forcing regeneration
    if (
      !forceRegenerate &&
      existingAnalysis &&
      Array.isArray(existingAnalysis.codeChanges) &&
      existingAnalysis.codeChanges.length > 0
    ) {
      console.log(
        "Found existing analysis with code changes for",
        owner,
        repo,
        sha
      );
      return new Response(
        JSON.stringify({
          error: false,
          details: null,
          analysis: {
            codeChanges: existingAnalysis.codeChanges,
            architectureDiagram: existingAnalysis.architectureDiagram,
            reactConcept: existingAnalysis.reactConcept,
          },
          rawResponse: null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // If forcing regeneration or no existing analysis, proceed with new analysis
    console.log(
      `${
        forceRegenerate ? "Force regenerating" : "Generating new"
      } analysis for`,
      owner,
      repo,
      sha
    );

    // Get or create repository with correct owner/name
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
        user: {
          connectOrCreate: {
            where: {
              githubId: "anonymous",
            },
            create: {
              name: "Anonymous",
              githubId: "anonymous",
            },
          },
        },
      },
      update: {
        owner,
        name: repo,
        // Don't update githubId as it should remain the same
      },
    });

    // Get diff from GitHub and generate analysis
    const diff = await getDiff(owner, repo, sha);
    if (!diff) {
      const message = `No diff content returned from GitHub for ${owner}/${repo}/${sha}`;
      console.log(message);
      return new Response(
        JSON.stringify({
          error: true,
          details: message,
          analysis: DEFAULT_ANALYSIS,
          rawResponse: null,
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Generating analysis with Claude for ${owner}/${repo}/${sha}`);
    const analysis = await generateAnalysis(diff);
    if (!analysis) {
      const message = `Analysis generation returned no results for ${owner}/${repo}/${sha}`;
      console.log(message);
      return new Response(
        JSON.stringify({
          error: true,
          details: message,
          analysis: DEFAULT_ANALYSIS,
          rawResponse: null,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Store in database with new structure and repository info
    try {
      const savedAnalysis = existingAnalysis
        ? await prisma.commitAnalysis.update({
            where: { id: existingAnalysis.id },
            data: {
              codeChanges: analysis.codeChanges,
              architectureDiagram: analysis.architectureDiagram,
              reactConcept: analysis.reactConcept,
              repository: {
                connect: {
                  id: repository.id,
                },
              },
            },
            include: {
              repository: true,
            },
          })
        : await prisma.commitAnalysis.create({
            data: {
              repositoryId: repository.id,
              commitSha: sha,
              codeChanges: analysis.codeChanges,
              architectureDiagram: analysis.architectureDiagram,
              reactConcept: analysis.reactConcept,
            },
            include: {
              repository: true,
            },
          });

      console.log("Successfully saved analysis for", owner, repo, sha);
      return new Response(
        JSON.stringify({
          error: false,
          details: null,
          analysis: {
            codeChanges: savedAnalysis.codeChanges,
            architectureDiagram: savedAnalysis.architectureDiagram,
            reactConcept: savedAnalysis.reactConcept,
          },
          rawResponse: null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (dbError) {
      console.error("Database error during analysis save:", dbError);
      // Still return the analysis even if we fail to save it
      return new Response(
        JSON.stringify({
          error: true,
          details:
            dbError instanceof Error
              ? dbError.message
              : "Unknown database error",
          analysis: analysis,
          rawResponse: null,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    // Safely handle the error object
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    const errorDetails = error instanceof Error ? error.stack : String(error);

    console.log("Error in commit analysis:", {
      message: errorMessage,
      details: errorDetails,
      owner,
      repo,
      sha,
    });

    return new Response(
      JSON.stringify({
        error: true,
        details: errorMessage,
        analysis: DEFAULT_ANALYSIS,
        rawResponse: errorDetails,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

async function generateAnalysis(diff: string) {
  if (!process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY) {
    console.log("No Anthropic API key found");
    return DEFAULT_ANALYSIS;
  }

  const prompt = `You are an expert code reviewer. Analyze this git diff and provide a detailed analysis, focusing on important code changes.

Git Diff to analyze:
${diff.slice(
  0,
  2500
)} // Only analyze first 1500 chars of diff to stay within limit

Provide a comprehensive analysis with EXACTLY this JSON structure:
{
  "codeChanges": [
    {
      "type": "New Feature|Refactor|Chore|Cleanup|Config",
      "file": "path/to/file",
      "lines": "line range",
      "explanation": "markdown formatted explanation"
    }
  ],
  "architectureDiagram": {
    "diagram": "mermaid diagram code starting with graph TD",
    "explanation": "explanation of the architecture"
  },
  "reactConcept": {
    "concept": "name of the concept",
    "codeSnippet": "relevant code snippet",
    "explanation": "markdown formatted explanation"
  }
}

ANALYSIS PRIORITIES:
1. Focus first on new features and significant logic changes
2. Next, highlight important refactoring that improves code structure
3. Include cleanup changes that affect code quality or performance
4. Only include config changes if they have significant impact
5. For each change, explain WHY it matters, not just WHAT changed

CRITICAL REQUIREMENTS:
1. Response MUST be valid JSON - do not include ANY text outside the JSON structure
2. Each code change type MUST be exactly one of: "New Feature", "Refactor", "Chore", "Cleanup", "Config"
3. Architecture diagram MUST start with "graph TD"
4. All fields are required - do not omit any fields
5. Do not include markdown code blocks or any formatting around the JSON
6. The response should be ONLY the JSON object, nothing else
7. Order code changes by importance: New Features > Refactors > Cleanup > Config
8. Focus explanations on impact and reasoning, not just describing the change`;

  try {
    console.log("=== Sending Analysis Request to Claude ===");
    const analysis = await createCompletion(prompt);

    if (!analysis || !analysis.content || !analysis.content[0]) {
      console.log("Received empty response from Claude");
      return DEFAULT_ANALYSIS;
    }

    const content = analysis.content[0];
    if (!("text" in content) || !content.text) {
      console.log("Unexpected content format from Claude:", content);
      return DEFAULT_ANALYSIS;
    }

    // Log the raw response for debugging
    console.log("\n=== Raw Claude Response ===");
    console.log("Response length:", content.text.length);
    console.log("First 500 characters:", content.text.substring(0, 500));

    try {
      // Try to extract JSON if it's wrapped in code blocks
      let jsonStr = content.text;

      // First try to find a valid JSON object anywhere in the response
      const jsonMatch = jsonStr.match(/({[\s\S]*})/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      } else if (jsonStr.includes("```json")) {
        jsonStr = jsonStr.split("```json")[1].split("```")[0].trim();
      } else if (jsonStr.includes("```")) {
        jsonStr = jsonStr.split("```")[1].split("```")[0].trim();
      }

      // Clean up any remaining non-JSON content
      jsonStr = jsonStr.replace(/^[^{]*({[\s\S]*})[^}]*$/, "$1");

      console.log("\n=== Cleaned JSON string ===");
      console.log(jsonStr);

      let parsedResponse;
      try {
        parsedResponse = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error("\n=== JSON Parse Error ===");
        console.error("Error:", parseError);
        return DEFAULT_ANALYSIS; // Return default on parse error
      }

      try {
        const validatedAnalysis = AnalysisSchema.parse(parsedResponse);
        console.log("\n=== Successfully validated with Zod ===");
        return validatedAnalysis;
      } catch (zodError) {
        if (zodError instanceof z.ZodError) {
          console.error("\n=== Zod Validation Errors ===");
          console.error(zodError.errors);

          // Try to fix the response
          const fixedResponse = {
            codeChanges: Array.isArray(parsedResponse.codeChanges)
              ? parsedResponse.codeChanges.map((change: any) => ({
                  type: validateChangeType(change.type) ? change.type : "Chore",
                  file: change.file || "unknown",
                  lines: change.lines || "N/A",
                  explanation: change.explanation || "No explanation provided",
                }))
              : DEFAULT_ANALYSIS.codeChanges,
            architectureDiagram: {
              diagram: parsedResponse.architectureDiagram?.diagram?.startsWith(
                "graph TD"
              )
                ? parsedResponse.architectureDiagram.diagram
                : DEFAULT_ANALYSIS.architectureDiagram.diagram,
              explanation:
                parsedResponse.architectureDiagram?.explanation ||
                DEFAULT_ANALYSIS.architectureDiagram.explanation,
            },
            reactConcept: {
              concept:
                parsedResponse.reactConcept?.concept ||
                DEFAULT_ANALYSIS.reactConcept.concept,
              codeSnippet:
                parsedResponse.reactConcept?.codeSnippet ||
                DEFAULT_ANALYSIS.reactConcept.codeSnippet,
              explanation:
                parsedResponse.reactConcept?.explanation ||
                DEFAULT_ANALYSIS.reactConcept.explanation,
            },
          };

          try {
            return AnalysisSchema.parse(fixedResponse);
          } catch (finalError) {
            console.error("\n=== Failed to fix response ===");
            return DEFAULT_ANALYSIS; // Return default if fix fails
          }
        }
        return DEFAULT_ANALYSIS; // Return default on validation error
      }
    } catch (error) {
      console.error("\n=== Analysis Processing Error ===");
      console.error(error);
      return DEFAULT_ANALYSIS; // Return default on any error
    }
  } catch (error) {
    console.log("=== Claude API Error ===", {
      message: error instanceof Error ? error.message : "Unknown error",
      details: error instanceof Error ? error.stack : String(error),
    });
    return DEFAULT_ANALYSIS;
  }
}

// Helper function to validate change type
function validateChangeType(type: string): boolean {
  const validTypes = ["New Feature", "Refactor", "Chore", "Cleanup", "Config"];
  return validTypes.includes(type);
}
