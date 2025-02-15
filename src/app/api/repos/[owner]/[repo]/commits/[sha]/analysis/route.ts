import { NextRequest } from "next/server";
import { getDiff } from "@/services/mcp/github";
import prisma from "@/lib/prisma";
import { createCompletion } from "@/services/claude";
import { GitHubService } from "@/services/github";
import {
  PrismaClientKnownRequestError,
  PrismaClientInitializationError,
} from "@prisma/client/runtime/library";

export async function GET(
  req: NextRequest,
  { params }: { params: { owner: string; repo: string; sha: string } }
) {
  const { owner, repo, sha } = await Promise.resolve(params);

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

    // Check if we have a valid existing analysis with code changes
    if (
      existingAnalysis &&
      Array.isArray(existingAnalysis.codeChanges) &&
      existingAnalysis.codeChanges.length > 0
    ) {
      console.log("Found existing analysis with code changes");
      return new Response(
        JSON.stringify({
          codeChanges: existingAnalysis.codeChanges,
          architectureDiagram: existingAnalysis.architectureDiagram,
          reactConcept: existingAnalysis.reactConcept,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // If no existing analysis or empty code changes, proceed with new analysis
    console.log("No valid existing analysis found, generating new analysis");

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
        user: {
          create: {
            name: "Anonymous",
            githubId: "anonymous",
          },
        },
      },
      update: {},
    });

    // Get diff from GitHub and generate analysis
    const diff = await getDiff(owner, repo, sha);
    const analysis = await generateAnalysis(diff);

    // Store in database with new structure
    try {
      // If we had an existing analysis, update it instead of creating new
      const savedAnalysis = existingAnalysis
        ? await prisma.commitAnalysis.update({
            where: { id: existingAnalysis.id },
            data: {
              codeChanges: analysis.codeChanges,
              architectureDiagram: analysis.architectureDiagram,
              reactConcept: analysis.reactConcept,
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

      return new Response(
        JSON.stringify({
          codeChanges: savedAnalysis.codeChanges,
          architectureDiagram: savedAnalysis.architectureDiagram,
          reactConcept: savedAnalysis.reactConcept,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (dbError) {
      console.error("Database error during analysis save:", dbError);
      // Still return the analysis even if we fail to save it
      return new Response(JSON.stringify(analysis), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("Error in commit analysis:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        error: "Failed to generate analysis",
        details: errorMessage,
        rawResponse: error instanceof Error ? error.cause : undefined,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function generateAnalysis(diff: string) {
  if (!process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY) {
    throw new Error("Anthropic API key not found in environment variables");
  }

  const prompt = `You are an expert code reviewer. Analyze this git diff and provide a detailed analysis.

Git Diff to analyze:
${diff}

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

Requirements:
1. Response MUST be valid JSON
2. Each code change should have a clear type and detailed explanation
3. Architecture diagram should show component relationships
4. React concept should be relevant to the changes
5. Do not include any text outside the JSON structure

If you cannot provide the response in JSON format, structure your response in three clear sections:
1. "Code Changes:" followed by each change
2. "Architecture Diagram:" followed by the mermaid diagram
3. "React Concept:" followed by the concept details`;

  try {
    const analysis = await createCompletion(prompt);
    const content = analysis.content[0];

    if (!("text" in content)) {
      throw new Error("Unexpected response format from Claude");
    }

    try {
      // First try to parse as JSON
      const parsedResponse = JSON.parse(content.text);

      // Validate the structure
      if (
        !parsedResponse.codeChanges ||
        !Array.isArray(parsedResponse.codeChanges)
      ) {
        throw new Error("Invalid codeChanges structure");
      }
      if (!parsedResponse.architectureDiagram?.diagram) {
        throw new Error("Invalid architectureDiagram structure");
      }
      if (!parsedResponse.reactConcept?.concept) {
        throw new Error("Invalid reactConcept structure");
      }

      return parsedResponse;
    } catch (jsonError) {
      console.log(
        "Failed to parse JSON response, attempting structured text parsing"
      );

      // Fallback to structured text parsing
      const lines = content.text.split("\n");
      let section = "";
      let codeChanges: Array<{
        type: string;
        file: string;
        lines: string;
        explanation: string;
      }> = [];
      let architectureDiagram = {
        diagram: "",
        explanation: "",
      };
      let reactConcept = {
        concept: "",
        codeSnippet: "",
        explanation: "",
      };

      for (const line of lines) {
        if (line.includes("Code Changes:")) {
          section = "changes";
          continue;
        } else if (line.includes("Architecture Diagram:")) {
          section = "diagram";
          continue;
        } else if (line.includes("React Concept:")) {
          section = "concept";
          continue;
        } else if (line.trim() === "" || line.startsWith("```")) {
          continue;
        }

        switch (section) {
          case "changes":
            if (line.match(/^[A-Za-z]+:/)) {
              const [type, ...rest] = line.split(":");
              const explanation = rest.join(":").trim();
              codeChanges.push({
                type: type.trim(),
                file: "",
                lines: "",
                explanation,
              });
            } else if (line.includes("File:")) {
              if (codeChanges.length > 0) {
                codeChanges[codeChanges.length - 1].file = line
                  .split("File:")[1]
                  .trim();
              }
            } else if (line.includes("Lines:")) {
              if (codeChanges.length > 0) {
                codeChanges[codeChanges.length - 1].lines = line
                  .split("Lines:")[1]
                  .trim();
              }
            }
            break;
          case "diagram":
            if (line.startsWith("graph") || line.includes("->")) {
              architectureDiagram.diagram += line + "\n";
            } else if (line.trim() !== "") {
              architectureDiagram.explanation += line + "\n";
            }
            break;
          case "concept":
            if (line.includes("Concept:")) {
              reactConcept.concept = line.split("Concept:")[1].trim();
            } else if (line.includes("Code Snippet:")) {
              reactConcept.codeSnippet = line.split("Code Snippet:")[1].trim();
            } else {
              reactConcept.explanation += line + "\n";
            }
            break;
        }
      }

      // Clean up explanations
      reactConcept.explanation = reactConcept.explanation.trim();
      architectureDiagram.explanation = architectureDiagram.explanation.trim();

      return {
        codeChanges,
        architectureDiagram,
        reactConcept,
      };
    }
  } catch (error) {
    console.error("Failed to generate analysis:", error);
    throw new Error(
      "Failed to generate analysis: " +
        (error instanceof Error ? error.message : "Unknown error")
    );
  }
}
