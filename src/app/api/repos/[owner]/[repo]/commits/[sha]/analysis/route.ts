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
  type: z.enum([
    "New Feature",
    "Refactor",
    "Improvement",
    "Chore",
    "Cleanup",
    "Config",
  ]),
  file: z.string(),
  lines: z.string(),
  codeSnippet: z.array(z.string()).optional(),
  explanation: z.string(),
});

const ArchitectureDiagramSchema = z.object({
  diagram: z.string().startsWith("graph TD"),
  explanation: z.string(),
});

const ReactConceptSchema = z.object({
  concept: z.string(),
  file: z.string(),
  lines: z.string(),
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
    file: "unknown",
    lines: "N/A",
    codeSnippet: ["1: // No code snippet available"],
    explanation: "No React concept analysis available",
  },
};

// Cache static parts of the prompt
const ANALYSIS_STRUCTURE_TEMPLATE = `Provide a comprehensive analysis with EXACTLY this JSON structure:
{
  "codeChanges": [
    {
      "type": "New Feature|Refactor|Improvement|Chore|Cleanup|Config",
      "file": "path/to/file",
      "lines": "line numbers in format like 68-88",
      "codeSnippet": ["array of code lines with line numbers", "only for New Feature, Refactor, and Improvement types"],
      "explanation": "Explain each change in simple, non-technical terms."
    }
  ],
  "architectureDiagram": {
    "diagram": "mermaid diagram code starting with graph TD. Label components with actual code names.",
    "explanation": "explanation of the architecture"
  },
  "reactConcept": {
    "concept": "Select one core React concept to explain.",
    "file": "path to the file containing the concept",
    "lines": "line numbers in format like 68-75",
    "codeSnippet": ["array of code lines with line numbers"],
    "explanation": "Keep the explanation beginner-friendly."
  }
}

IMPORTANT NOTES:
1. Sort code changes by type: New Feature, Refactor, and Improvement first, followed by Chore, Cleanup, and Config
2. Include code snippets ONLY for New Feature, Refactor, and Improvement changes
3. For Chore, Cleanup, and Config changes, omit the codeSnippet field
4. Each code snippet line MUST include the actual line number as prefix (e.g. "68: const foo = bar;")
5. Ensure line numbers in the 'lines' field exactly match the actual code snippet line numbers
6. For React concept, always include the file path and correct line numbers`;

const ANALYSIS_EXAMPLE_TEMPLATE = `EXAMPLE:

{
  "codeChanges": [
    {
      "type": "New Feature",
      "file": "src/components/Editor/Block.tsx",
      "lines": "68-75",
      "codeSnippet": [
        "68: const renderContent = () => {",
        "69:   if (block.state === \\"completed\\") {",
        "70:     return \`@\${block.selectedItem?.title}\`;",
        "71:   }",
        "72:   if (block.state === \\"searching\\") {",
        "73:     return \`\${block.searchQuery || \\"select item\\"}\`;",
        "74:   }",
        "75: };"
      ],
      "explanation": "Added a new feature to show names when people type @. The computer checks if the name is finished or still being searched."
    },
    {
      "type": "Chore",
      "file": "package.json",
      "lines": "15-17",
      "explanation": "Updated development dependencies to latest versions for better security."
    }
  ],
  "architectureDiagram": {
    "diagram": "graph TD\\n  EditorState --> TextBlock\\n  EditorState --> MentionBlock\\n  TextBlock --> content\\n  MentionBlock --> searchQuery\\n  MentionBlock --> selections",
    "explanation": "The computer stores words in little blocks. Some blocks have regular text. Some blocks show names with @."
  },
  "reactConcept": {
    "concept": "React's useState",
    "file": "src/components/Editor/Block.tsx",
    "lines": "12-16",
    "codeSnippet": [
      "12: const [state, setState] = useState({",
      "13:   blocks: [createTextBlock()],",
      "14:   cursor: { blockIndex: 0, offset: 0 }",
      "15: });",
      "16: "
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
    log.error("No Anthropic API key found");
    return DEFAULT_ANALYSIS;
  }

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

  log.info("Extracting meaningful changes...");
  // Extract only the meaningful parts of the diff
  const meaningfulDiff = filteredDiff
    .split("\n")
    .filter((line) => {
      // Keep file headers
      if (line.startsWith("diff --git")) return true;
      // Keep actual code changes
      if (line.startsWith("+") || line.startsWith("-")) return true;
      // Keep a few lines of context around changes
      if (line.startsWith("@@ ")) return true;
      return false;
    })
    .join("\n");

  const estimatedTokens = estimateTokenCount(meaningfulDiff);
  log.info(`Initial token estimate: ${estimatedTokens.toLocaleString()}`);

  // If still too long, take most important parts
  let finalDiff = meaningfulDiff;
  if (estimatedTokens > TOKEN_LIMIT) {
    log.warning(`Diff exceeds token limit (${TOKEN_LIMIT}), truncating...`);
    // Extract file headers and changes, prioritize actual code changes
    const changes = meaningfulDiff.split("diff --git");
    const importantChanges = changes.filter((change) => {
      // Prioritize src/ directory changes
      if (change.includes(" a/src/")) return true;
      // Prioritize actual code files
      if (
        change.includes(".ts") ||
        change.includes(".tsx") ||
        change.includes(".js")
      )
        return true;
      return false;
    });
    finalDiff = importantChanges.slice(0, 3).join("diff --git"); // Take top 3 most important files
  }

  const diffHash = generateDiffHash(filteredDiff);
  log.info(`Generated diff hash: ${diffHash}`);

  // Check cache
  log.section("Checking Cache");
  const exactMatch = await getCachedAnalysis(diffHash);
  if (exactMatch) {
    log.success("Found exact cached analysis match");
    return exactMatch.analysis;
  }
  log.info("No exact match found, checking for similar diffs...");

  const similarMatch = await findSimilarAnalysis(filteredDiff);
  if (similarMatch) {
    log.success("Found similar cached analysis");
    return similarMatch.analysis;
  }
  log.info("No similar matches found, generating new analysis...");

  // Prepare prompt
  log.section("Preparing Claude Request");
  const prompt = `Generate a comprehensive summary of commit patch files with code snippets, architecture diagrams, and educational takeaways.

${ANALYSIS_STRUCTURE_TEMPLATE}

${ANALYSIS_EXAMPLE_TEMPLATE}

Git Diff to analyze:
${finalDiff}`;

  try {
    const inputTokenCount = estimateTokenCount(prompt);
    log.info(`Input tokens: ${inputTokenCount.toLocaleString()}`);
    log.info(`Diff length: ${finalDiff.length} characters`);

    log.section("Calling Claude API");
    const analysis = await createCompletion(prompt);

    if (!analysis || !analysis.content || !analysis.content[0]) {
      log.error("Received empty response from Claude");
      return DEFAULT_ANALYSIS;
    }

    const content = analysis.content[0];
    if (!("text" in content) || !content.text) {
      log.error("Unexpected content format from Claude");
      return DEFAULT_ANALYSIS;
    }

    const outputTokenCount = estimateTokenCount(content.text);
    log.section("Claude API Usage");
    log.info(calculateCost(inputTokenCount, outputTokenCount));

    log.section("Processing Response");
    log.info(`Response length: ${content.text.length} characters`);
    log.info("First 500 characters of response:");
    console.log(chalk.gray(content.text.substring(0, 500)));
    log.divider();

    try {
      // Extract and clean JSON
      log.info("Extracting JSON from response...");
      let jsonStr = content.text;
      const jsonMatch = jsonStr.match(/({[\s\S]*})/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      } else if (jsonStr.includes("```json")) {
        jsonStr = jsonStr.split("```json")[1].split("```")[0].trim();
      } else if (jsonStr.includes("```")) {
        jsonStr = jsonStr.split("```")[1].split("```")[0].trim();
      }

      jsonStr = jsonStr.replace(/^[^{]*({[\s\S]*})[^}]*$/, "$1");

      log.info("Parsing JSON...");
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(jsonStr);
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

        // Additional validation for line numbers
        const cleanedAnalysis = {
          ...validatedAnalysis,
          codeChanges: sortCodeChanges(
            validateAndCleanCodeChanges(validatedAnalysis.codeChanges)
          ),
          reactConcept: validateAndCleanReactConcept(
            validatedAnalysis.reactConcept
          ),
        };

        log.info("Caching analysis...");
        await cacheAnalysis(diffHash, filteredDiff, cleanedAnalysis);
        log.success("Analysis cached");

        return cleanedAnalysis;
      } catch (zodError) {
        if (zodError instanceof z.ZodError) {
          log.error("Validation Errors:");
          console.error(chalk.red(zodError.errors));

          log.info("Attempting to fix response...");
          // Try to fix the response
          const fixedResponse = {
            codeChanges: Array.isArray(parsedResponse.codeChanges)
              ? sortCodeChanges(
                  validateAndCleanCodeChanges(parsedResponse.codeChanges)
                )
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
              file:
                parsedResponse.reactConcept?.file ||
                DEFAULT_ANALYSIS.reactConcept.file,
              lines:
                parsedResponse.reactConcept?.lines ||
                DEFAULT_ANALYSIS.reactConcept.lines,
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
    "New Feature",
    "Refactor",
    "Improvement",
    "Chore",
    "Cleanup",
    "Config",
  ];
  return validTypes.includes(type);
}

// Add helper to sort code changes by type
function sortCodeChanges(changes: any[]) {
  const typeOrder = {
    "New Feature": 0,
    Refactor: 1,
    Improvement: 2,
    Chore: 3,
    Cleanup: 4,
    Config: 5,
  };

  return changes.sort((a, b) => {
    const aOrder = typeOrder[a.type as keyof typeof typeOrder] ?? 999;
    const bOrder = typeOrder[b.type as keyof typeof typeOrder] ?? 999;
    return aOrder - bOrder;
  });
}

// Add helper to validate and clean code changes
function validateAndCleanCodeChanges(changes: any[]) {
  return changes.map((change: any) => {
    const type = validateChangeType(change.type) ? change.type : "Chore";
    const shouldHaveSnippet = [
      "New Feature",
      "Refactor",
      "Improvement",
    ].includes(type);

    const cleanedChange = {
      type,
      file: change.file || "unknown",
      lines: change.lines || "N/A",
      explanation: change.explanation || "No explanation provided",
    };

    if (shouldHaveSnippet && Array.isArray(change.codeSnippet)) {
      // Validate line numbers in code snippet
      if (validateLineNumbers(change.codeSnippet, change.lines)) {
        return {
          ...cleanedChange,
          codeSnippet: change.codeSnippet,
        };
      } else {
        // If line numbers are invalid, try to fix them
        const [startStr] = (change.lines || "").split("-");
        const start = parseInt(startStr) || 1;
        return {
          ...cleanedChange,
          lines: `${start}-${start + change.codeSnippet.length - 1}`,
          codeSnippet: change.codeSnippet.map((line: string, index: number) => {
            const lineContent = line.includes(": ")
              ? line.split(": ")[1]
              : line;
            return `${start + index}: ${lineContent}`;
          }),
        };
      }
    }

    return cleanedChange;
  });
}

// Add helper to validate line numbers in code snippets
function validateLineNumbers(
  codeSnippet: string[],
  lineRange: string
): boolean {
  if (!lineRange || !codeSnippet || codeSnippet.length === 0) return false;

  const [startStr, endStr] = lineRange.split("-");
  const start = parseInt(startStr);
  const end = parseInt(endStr);

  if (isNaN(start) || isNaN(end)) return false;

  // Check if each line in the snippet has the correct line number prefix
  return codeSnippet.every((line, index) => {
    const expectedLineNum = start + index;
    return line.startsWith(`${expectedLineNum}: `) && expectedLineNum <= end;
  });
}

// Add helper to validate and clean React concept
function validateAndCleanReactConcept(concept: any) {
  const cleanedConcept = {
    concept: concept?.concept || DEFAULT_ANALYSIS.reactConcept.concept,
    file: concept?.file || DEFAULT_ANALYSIS.reactConcept.file,
    lines: concept?.lines || DEFAULT_ANALYSIS.reactConcept.lines,
    codeSnippet: Array.isArray(concept?.codeSnippet)
      ? concept.codeSnippet
      : DEFAULT_ANALYSIS.reactConcept.codeSnippet,
    explanation:
      concept?.explanation || DEFAULT_ANALYSIS.reactConcept.explanation,
  };

  // Validate and fix line numbers in code snippet if needed
  if (!validateLineNumbers(cleanedConcept.codeSnippet, cleanedConcept.lines)) {
    const start = parseInt(cleanedConcept.lines.split("-")[0]) || 1;
    return {
      ...cleanedConcept,
      lines: `${start}-${start + cleanedConcept.codeSnippet.length - 1}`,
      codeSnippet: cleanedConcept.codeSnippet.map(
        (line: string, index: number) => {
          const lineContent = line.includes(": ") ? line.split(": ")[1] : line;
          return `${start + index}: ${lineContent}`;
        }
      ),
    };
  }

  return cleanedConcept;
}
