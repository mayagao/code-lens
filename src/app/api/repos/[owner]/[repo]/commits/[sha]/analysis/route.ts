import { NextRequest } from "next/server";
import { getDiff } from "@/services/mcp/github";
import prisma from "@/lib/prisma";
import { createCompletion } from "@/services/claude";
import { GitHubService } from "@/services/github";
import { z } from "zod";
import crypto from "crypto";
import chalk from "chalk";
import {
  PrismaClientKnownRequestError,
  PrismaClientInitializationError,
} from "@prisma/client/runtime/library";

// Add logging utilities
const log = {
  info: (msg: string) => console.log(chalk.blue("ℹ ") + msg),
  success: (msg: string) => console.log(chalk.green("✓ ") + msg),
  warning: (msg: string) => console.log(chalk.yellow("⚠ ") + msg),
  error: (msg: string) => console.log(chalk.red("✖ ") + msg),
  section: (title: string) =>
    console.log("\n" + chalk.bold.cyan(`=== ${title} ===`)),
  divider: () => console.log(chalk.gray("─".repeat(80))),
  json: (obj: any) => console.log(chalk.gray(JSON.stringify(obj, null, 2))),
};

// Add constants
const TOKEN_LIMIT = 2000; // Set a reasonable limit for tokens

// Define Zod schemas for our analysis structure
const CodeChangeSchema = z.object({
  type: z.enum(["Feature", "Refactor", "Logic", "Chore", "Cleanup", "Config"]),
  file: z.string(),
  lines: z.string(),
  summary: z.string(),
  codeSnippet: z.array(z.string()).optional(),
  explanation: z.string(),
});

const ArchitectureDiagramSchema = z.object({
  diagram: z.string().startsWith("graph TD"),
  explanation: z.string(),
});

const ReactConceptSchema = z.object({
  concept: z.string(),
  codeSnippet: z.array(z.string()),
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
      lines: "0-0",
      summary: "No changes detected",
      explanation: "No analysis available",
    },
  ],
  architectureDiagram: {
    diagram: "graph TD\n  A[No Analysis] --> B[Try Again]\n  B --> A",
    explanation: "No architecture diagram available",
  },
  reactConcept: {
    concept: "None",
    codeSnippet: [
      "0: // No code snippet available",
      "1: // Please try regenerating the analysis",
    ],
    explanation: "No React concept analysis available",
  },
};

// Cache static parts of the prompt
const ANALYSIS_STRUCTURE_TEMPLATE = `Provide a comprehensive analysis with EXACTLY this JSON structure:
{
  "codeChanges": [
    {
      "type": "Feature|Refactor|Logic|Chore|Cleanup|Config",
      "file": "path/to/file",
      "lines": "line_start-line_end",
      "summary": "One sentence summary of the core change",
      "codeSnippet": [
        "Each line MUST be prefixed with line number and colon",
        "Format: 'line_number: actual_code'",
        "Example: '42: function handleClick() {'",
        "Include 5-10 lines of relevant code with context",
        "Always include the actual line numbers from the file",
        "ONLY include code snippets for Feature, Refactor, and Logic changes"
      ],
      "explanation": "Explain each change in simple, non-technical terms."
    }
  ],
  "architectureDiagram": {
    "diagram": "mermaid diagram code starting with graph TD. Label components with actual code names.",
    "explanation": "explanation of the architecture"
  },
  "reactConcept": {
    "concept": "Select one core React concept to explain.",
    "codeSnippet": [
      "Each line MUST be prefixed with line number and colon",
      "Format: 'line_number: actual_code'",
      "Example: '42: const [state, setState] = useState(null);'"
    ],
    "explanation": "Keep the explanation beginner-friendly."
  }
}`;

const ANALYSIS_EXAMPLE_TEMPLATE = `EXAMPLE:

{
  "codeChanges": [
    {
      "type": "Feature",
      "file": "src/components/Editor/Block.tsx",
      "lines": "68–88",
      "summary": "Added @ mention functionality to show user names in the editor",
      "codeSnippet": [
        "68: const renderContent = () => {",
        "69:   if (block.state === \\"completed\\") {",
        "70:     return \`@\${block.selectedItem?.title}\`;",
        "71:   }",
        "72:   if (block.state === \\"searching\\") {",
        "73:     return \`\${block.searchQuery || \\"select item\\"}\`;",
        "74:   }",
        "75: };",
        "76: return <span>{renderContent()}</span>;"
      ],
      "explanation": "We added a new rule to show names when people type @. The computer checks if the name is finished or still being searched."
    }
  ],
  "architectureDiagram": {
    "diagram": "graph TD\\n  EditorState --> TextBlock\\n  EditorState --> MentionBlock\\n  TextBlock --> content\\n  MentionBlock --> searchQuery\\n  MentionBlock --> selections",
    "explanation": "The computer stores words in little blocks. Some blocks have regular text. Some blocks show names with @."
  },
  "reactConcept": {
    "concept": "React's useState",
    "codeSnippet": [
      "42: const [state, setState] = useState({",
      "43:   blocks: [createTextBlock()],",
      "44:   cursor: { blockIndex: 0, offset: 0 }",
      "45: });"
    ],
    "explanation": "React has a magic memory called useState. It helps the app remember what you're typing, like a sticky note that React checks when drawing the screen. When you type something new, setState updates the note so React can show the change."
  }
}`;

// Add cache helpers
function generateDiffHash(diff: string): string {
  return crypto.createHash("md5").update(diff).digest("hex");
}

// Add error handling for cache operations
async function getCachedAnalysis(diffHash: string) {
  try {
    if (!prisma) {
      console.error("Prisma client is not initialized");
      return null;
    }
    return await prisma.analysisCache.findUnique({
      where: { diffHash },
    });
  } catch (error) {
    console.error("Error accessing cache:", error);
    return null;
  }
}

// Enhanced cache helpers
interface DiffSignature {
  files: string[];
  changeTypes: Set<string>;
  changeCount: number;
  mainChanges: string[];
}

function generateDiffSignature(diff: string): DiffSignature {
  const lines = diff.split("\n");
  const files = new Set<string>();
  const changeTypes = new Set<string>();
  let changeCount = 0;
  const mainChanges = new Set<string>();

  let currentFile = "";

  lines.forEach((line) => {
    if (line.startsWith("diff --git")) {
      currentFile = line.split(" b/")[1];
      files.add(currentFile);
    } else if (line.startsWith("+") || line.startsWith("-")) {
      changeCount++;

      // Identify change type
      if (line.includes("import ")) changeTypes.add("import");
      if (line.includes("function ")) changeTypes.add("function");
      if (line.includes("class ")) changeTypes.add("class");
      if (line.includes("interface ")) changeTypes.add("interface");
      if (line.includes("const ")) changeTypes.add("const");

      // Store significant changes (function definitions, class declarations, etc.)
      if (line.match(/^[+-].*?(function|class|interface|type|enum)\s+\w+/)) {
        mainChanges.add(line.replace(/^[+-]/, "").trim());
      }
    }
  });

  return {
    files: Array.from(files),
    changeTypes: changeTypes,
    changeCount,
    mainChanges: Array.from(mainChanges),
  };
}

function calculateDiffSimilarity(
  sig1: DiffSignature,
  sig2: DiffSignature
): number {
  // File similarity (30% weight)
  const fileIntersection = sig1.files.filter((f) => sig2.files.includes(f));
  const fileSimilarity =
    fileIntersection.length / Math.max(sig1.files.length, sig2.files.length);

  // Change type similarity (20% weight)
  const typeIntersection = new Set(
    [...sig1.changeTypes].filter((x) => sig2.changeTypes.has(x))
  );
  const typeSimilarity =
    typeIntersection.size /
    Math.max(sig1.changeTypes.size, sig2.changeTypes.size);

  // Change count similarity (20% weight)
  const countSimilarity =
    1 -
    Math.abs(sig1.changeCount - sig2.changeCount) /
      Math.max(sig1.changeCount, sig2.changeCount);

  // Main changes similarity (30% weight)
  const mainChangeIntersection = sig1.mainChanges.filter((c) =>
    sig2.mainChanges.includes(c)
  );
  const mainChangeSimilarity =
    mainChangeIntersection.length /
    Math.max(sig1.mainChanges.length, sig2.mainChanges.length);

  return (
    fileSimilarity * 0.3 +
    typeSimilarity * 0.2 +
    countSimilarity * 0.2 +
    mainChangeSimilarity * 0.3
  );
}

async function findSimilarAnalysis(diff: string, similarityThreshold = 0.8) {
  try {
    if (!prisma) {
      console.error("Prisma client is not initialized");
      return null;
    }

    const signature = generateDiffSignature(diff);

    // Get recent cache entries (limit to last 100 to avoid performance issues)
    const recentCaches = await prisma.analysisCache.findMany({
      take: 100,
      orderBy: {
        createdAt: "desc",
      },
    });

    let bestMatch = null;
    let highestSimilarity = 0;

    for (const cache of recentCaches) {
      try {
        const cachedSignature = generateDiffSignature(cache.diff);
        const similarity = calculateDiffSimilarity(signature, cachedSignature);

        if (
          similarity > similarityThreshold &&
          similarity > highestSimilarity
        ) {
          highestSimilarity = similarity;
          bestMatch = cache;
        }
      } catch (error) {
        console.error("Error comparing with cached diff:", error);
        continue;
      }
    }

    return bestMatch;
  } catch (error) {
    console.error("Error finding similar analysis:", error);
    return null;
  }
}

async function cacheAnalysis(diffHash: string, diff: string, analysis: any) {
  try {
    if (!prisma) {
      console.error("Prisma client is not initialized");
      return;
    }
    await prisma.analysisCache.create({
      data: {
        diffHash,
        diff,
        analysis,
        createdAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Failed to cache analysis:", error);
  }
}

// Add cost calculation constants
const CLAUDE_COSTS = {
  input: 0.008 / 1000, // $0.008 per 1K input tokens
  output: 0.024 / 1000, // $0.024 per 1K output tokens
};

// Add token counting helper
function estimateTokenCount(text: string): number {
  // Rough estimation: ~4 characters per token on average
  return Math.ceil(text.length / 4);
}

function calculateCost(inputTokens: number, outputTokens: number): string {
  const inputCost = (inputTokens * CLAUDE_COSTS.input).toFixed(4);
  const outputCost = (outputTokens * CLAUDE_COSTS.output).toFixed(4);
  const totalCost = (Number(inputCost) + Number(outputCost)).toFixed(4);

  return `Cost Breakdown:
  Input  (${inputTokens.toLocaleString()} tokens): $${inputCost}
  Output (${outputTokens.toLocaleString()} tokens): $${outputCost}
  Total: $${totalCost}`;
}

// Helper function to generate a summary from code changes
function generateSummary(codeChanges: any[], commitMessage: string): string {
  // Try to find a Feature or Refactor change with a summary
  const significantChange = codeChanges.find(
    (change) =>
      (change.type === "Feature" || change.type === "Refactor") &&
      change.summary
  );

  if (significantChange?.summary) {
    // Ensure summary is not too long
    return significantChange.summary.split(" ").slice(0, 12).join(" ");
  }

  // Fall back to commit message, truncated to 12 words
  return commitMessage.split(" ").slice(0, 12).join(" ");
}

export async function GET(
  req: NextRequest,
  { params }: { params: { owner: string; repo: string; sha: string } }
) {
  const { owner, repo, sha } = await Promise.resolve(params);
  const forceRegenerate = req.nextUrl.searchParams.get("force") === "true";

  try {
    if (!prisma) {
      return new Response(
        JSON.stringify({
          error: true,
          details: "Database connection not initialized",
          analysis: DEFAULT_ANALYSIS,
          rawResponse: null,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // First try to find existing analysis in database
    let existingAnalysis;
    try {
      existingAnalysis = await prisma.commitAnalysis.findFirst({
        where: {
          AND: [{ repository: { owner, name: repo } }, { commitSha: sha }],
        },
        include: {
          repository: true,
        },
      });
    } catch (dbError) {
      console.error("Error querying existing analysis:", dbError);
      return new Response(
        JSON.stringify({
          error: true,
          details: "Failed to query existing analysis",
          analysis: DEFAULT_ANALYSIS,
          rawResponse:
            dbError instanceof Error ? dbError.message : String(dbError),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get commit details to access the commit message
    let commitDetails;
    try {
      commitDetails = await GitHubService.getCommit(owner, repo, sha);
      if (!commitDetails) {
        return new Response(
          JSON.stringify({
            error: true,
            details: "Failed to fetch commit details",
            analysis: DEFAULT_ANALYSIS,
            rawResponse: "No commit details returned from GitHub",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    } catch (error) {
      console.error("Error fetching commit details:", error);
      return new Response(
        JSON.stringify({
          error: true,
          details: "Failed to fetch commit details",
          analysis: DEFAULT_ANALYSIS,
          rawResponse: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const commitMessage =
      commitDetails?.commit?.message || "No commit message available";

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
            codeChanges: existingAnalysis.codeChanges || [],
            architectureDiagram:
              existingAnalysis.architectureDiagram ||
              DEFAULT_ANALYSIS.architectureDiagram,
            reactConcept:
              existingAnalysis.reactConcept || DEFAULT_ANALYSIS.reactConcept,
          },
          summary: existingAnalysis.summary || commitMessage,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get diff from GitHub and generate analysis
    let diff;
    try {
      diff = await getDiff(owner, repo, sha);
      if (!diff) {
        return new Response(
          JSON.stringify({
            error: true,
            details: `No diff content returned from GitHub for ${owner}/${repo}/${sha}`,
            analysis: DEFAULT_ANALYSIS,
            rawResponse: null,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    } catch (error) {
      console.error("Error fetching diff:", error);
      return new Response(
        JSON.stringify({
          error: true,
          details: "Failed to fetch diff",
          analysis: DEFAULT_ANALYSIS,
          rawResponse: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Generating analysis with Claude for ${owner}/${repo}/${sha}`);
    const analysis = await generateAnalysis(diff);
    if (!analysis) {
      return new Response(
        JSON.stringify({
          error: true,
          details: `Analysis generation returned no results for ${owner}/${repo}/${sha}`,
          analysis: DEFAULT_ANALYSIS,
          rawResponse: null,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get or create repository
    let repository;
    try {
      repository = await prisma.repository.upsert({
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
        },
      });

      if (!repository || !repository.id) {
        throw new Error("Failed to create/update repository");
      }
    } catch (error) {
      console.error("Error upserting repository:", error);
      return new Response(
        JSON.stringify({
          error: true,
          details: "Failed to create/update repository",
          analysis: DEFAULT_ANALYSIS,
          rawResponse: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // After generating new analysis, create/update with summary
    try {
      const summary = generateSummary(analysis.codeChanges, commitMessage);

      const savedAnalysis = existingAnalysis
        ? await prisma.commitAnalysis.update({
            where: { id: existingAnalysis.id },
            data: {
              codeChanges: analysis.codeChanges || [],
              architectureDiagram:
                analysis.architectureDiagram ||
                DEFAULT_ANALYSIS.architectureDiagram,
              reactConcept:
                analysis.reactConcept || DEFAULT_ANALYSIS.reactConcept,
              summary,
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
              codeChanges: analysis.codeChanges || [],
              architectureDiagram:
                analysis.architectureDiagram ||
                DEFAULT_ANALYSIS.architectureDiagram,
              reactConcept:
                analysis.reactConcept || DEFAULT_ANALYSIS.reactConcept,
              summary,
            },
            include: {
              repository: true,
            },
          });

      if (!savedAnalysis) {
        return new Response(
          JSON.stringify({
            error: true,
            details: "Failed to save analysis",
            analysis: analysis || DEFAULT_ANALYSIS,
            rawResponse: null,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          error: false,
          details: null,
          analysis: {
            codeChanges: savedAnalysis.codeChanges || [],
            architectureDiagram:
              savedAnalysis.architectureDiagram ||
              DEFAULT_ANALYSIS.architectureDiagram,
            reactConcept:
              savedAnalysis.reactConcept || DEFAULT_ANALYSIS.reactConcept,
          },
          summary: savedAnalysis.summary || commitMessage,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (dbError) {
      console.error("Database error during analysis save:", dbError);
      return new Response(
        JSON.stringify({
          error: true,
          details:
            dbError instanceof Error
              ? dbError.message
              : "Unknown database error",
          analysis: analysis || DEFAULT_ANALYSIS,
          rawResponse: dbError instanceof Error ? dbError.stack : null,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    const errorDetails = error instanceof Error ? error.stack : String(error);

    console.error("Error in commit analysis:", {
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
    log.error("No Anthropic API key found");
    return DEFAULT_ANALYSIS;
  }

  if (!diff || typeof diff !== "string") {
    log.error("Invalid diff provided");
    return DEFAULT_ANALYSIS;
  }

  try {
    log.section("Processing Diff");
    log.info("Filtering irrelevant changes...");

    // Filter out irrelevant changes to reduce context length
    const filteredDiff = diff
      .split("\n")
      .filter((line) => {
        // Skip package-lock.json changes
        if (line.includes("package-lock.json")) return false;
        // Skip dist/build directory changes
        if (line.includes("/dist/") || line.includes("/build/")) return false;
        // Skip test files unless they're the main changes
        if (line.includes(".test.") || line.includes(".spec.")) return false;
        // Skip pure whitespace changes
        if (line.trim() === "+" || line.trim() === "-") return false;
        // Skip comment-only changes
        if (line.trim().startsWith("+ //") || line.trim().startsWith("- //"))
          return false;
        return true;
      })
      .join("\n");

    if (!filteredDiff) {
      log.warning("No meaningful changes found in diff");
      return DEFAULT_ANALYSIS;
    }

    const diffHash = generateDiffHash(filteredDiff);
    log.info(`Generated diff hash: ${diffHash}`);

    // Check cache
    log.section("Checking Cache");
    const exactMatch = await getCachedAnalysis(diffHash);
    if (exactMatch?.analysis) {
      log.success("Found exact cached analysis match");
      return exactMatch.analysis;
    }
    log.info("No exact match found, checking for similar diffs...");

    const similarMatch = await findSimilarAnalysis(filteredDiff);
    if (similarMatch?.analysis) {
      log.success("Found similar cached analysis");
      return similarMatch.analysis;
    }
    log.info("No similar matches found, generating new analysis...");

    const prompt = `Generate a comprehensive summary of commit patch files with code snippets, architecture diagrams, and educational takeaways.

${ANALYSIS_STRUCTURE_TEMPLATE}

${ANALYSIS_EXAMPLE_TEMPLATE}

Git Diff to analyze:
${filteredDiff}`;

    const inputTokenCount = estimateTokenCount(prompt);
    log.info(`Input tokens: ${inputTokenCount.toLocaleString()}`);
    log.info(`Diff length: ${filteredDiff.length} characters`);

    log.section("Calling Claude API");
    const response = await createCompletion(prompt);

    if (!response) {
      log.error("Received null response from Claude");
      return DEFAULT_ANALYSIS;
    }

    const { content, usage } = response;
    if (!content || !Array.isArray(content) || content.length === 0) {
      log.error("Invalid response structure from Claude");
      log.json(response);
      return DEFAULT_ANALYSIS;
    }

    const firstContent = content[0];
    if (
      !firstContent ||
      firstContent.type !== "text" ||
      typeof firstContent.text !== "string"
    ) {
      log.error("Invalid content structure from Claude");
      log.json(firstContent);
      return DEFAULT_ANALYSIS;
    }

    const outputTokenCount = estimateTokenCount(firstContent.text);
    log.section("Claude API Usage");
    log.info(calculateCost(inputTokenCount, outputTokenCount));

    log.section("Processing Response");
    log.info(`Response length: ${firstContent.text.length} characters`);
    log.info("First 500 characters of response:");
    console.log(chalk.gray(firstContent.text.substring(0, 500)));
    log.divider();

    try {
      // Extract and clean JSON
      log.info("Extracting JSON from response...");
      let jsonStr = firstContent.text;
      const jsonMatch = jsonStr.match(/({[\s\S]*})/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      } else if (jsonStr.includes("```json")) {
        jsonStr = jsonStr.split("```json")[1].split("```")[0].trim();
      } else if (jsonStr.includes("```")) {
        jsonStr = jsonStr.split("```")[1].split("```")[0].trim();
      }

      if (!jsonStr) {
        log.error("No JSON content found in response");
        return DEFAULT_ANALYSIS;
      }

      jsonStr = jsonStr.replace(/^[^{]*({[\s\S]*})[^}]*$/, "$1");

      log.info("Parsing JSON...");
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(jsonStr);
        if (!parsedResponse || typeof parsedResponse !== "object") {
          throw new Error("Parsed response is not an object");
        }
        log.success("JSON parsed successfully");
      } catch (parseError) {
        log.error("JSON Parse Error:");
        console.error(chalk.red(parseError));
        return DEFAULT_ANALYSIS;
      }

      try {
        log.info("Validating analysis structure...");
        const validatedAnalysis = AnalysisSchema.parse(parsedResponse);
        log.success("Analysis validated successfully");

        if (validatedAnalysis) {
          log.info("Caching analysis...");
          await cacheAnalysis(diffHash, filteredDiff, validatedAnalysis);
          log.success("Analysis cached");
          return validatedAnalysis;
        }
        return DEFAULT_ANALYSIS;
      } catch (zodError) {
        if (zodError instanceof z.ZodError) {
          log.error("Validation Errors:");
          console.error(chalk.red(zodError.errors));

          log.info("Attempting to fix response...");
          // Try to fix the response
          const fixedResponse = {
            codeChanges: Array.isArray(parsedResponse.codeChanges)
              ? parsedResponse.codeChanges.map((change: any) => ({
                  type: validateChangeType(change.type) ? change.type : "Chore",
                  file: change.file || "unknown",
                  lines: change.lines || "N/A",
                  summary: change.summary || "No summary provided",
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
            const validatedFixedAnalysis = AnalysisSchema.parse(fixedResponse);
            if (validatedFixedAnalysis) {
              return validatedFixedAnalysis;
            }
          } catch (finalError) {
            log.error("\n=== Failed to fix response ===");
            return DEFAULT_ANALYSIS; // Return default if fix fails
          }
        }
        return DEFAULT_ANALYSIS; // Return default on validation error
      }
    } catch (error) {
      log.error("Analysis Processing Error:");
      console.error(chalk.red(error));
      return DEFAULT_ANALYSIS; // Return default on any error
    }
  } catch (error) {
    log.error("Claude API Error:");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error))
    );
    return DEFAULT_ANALYSIS;
  }
}

// Helper function to validate change type
function validateChangeType(type: string): boolean {
  const validTypes = [
    "Feature",
    "Refactor",
    "Logic",
    "Chore",
    "Cleanup",
    "Config",
  ];
  return validTypes.includes(type);
}
