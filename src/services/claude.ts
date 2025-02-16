import Anthropic from "@anthropic-ai/sdk";

interface AnalysisResult {
  overview: string;
  mermaidDiagram: string;
  cost?: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  };
}

interface MessageContent {
  type: "text";
  text: string;
}

export const claude = new Anthropic({
  apiKey: process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY || "",
});

// Create a messages function that matches the API endpoint structure
export async function createCompletion(prompt: string) {
  console.log("Sending prompt to Claude (length):", prompt.length);

  try {
    const response = await claude.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 2000,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: prompt.slice(0, 4000),
        },
      ],
    });

    // Log detailed response information
    console.log("Claude Response Details:", {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      contentLength:
        response.content[0]?.type === "text"
          ? response.content[0].text.length
          : 0,
    });

    return response;
  } catch (error) {
    console.error("Error in createCompletion:", error);
    // Return an empty response object instead of null
    return {
      content: [
        {
          type: "text",
          text: "",
        },
      ],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }
}

export class ClaudeService {
  private static instance: ClaudeService;
  private anthropic: Anthropic;
  private readonly COST_PER_1K_INPUT_TOKENS = 0.015; // $0.015 per 1K input tokens for Claude 3 Opus
  private readonly COST_PER_1K_OUTPUT_TOKENS = 0.075; // $0.075 per 1K output tokens for Claude 3 Opus

  private constructor() {
    const apiKey = process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Anthropic API key not found. Please set NEXT_PUBLIC_ANTHROPIC_API_KEY in your .env.local file"
      );
    }

    this.anthropic = new Anthropic({
      apiKey,
    });
  }

  static getInstance(): ClaudeService {
    if (!ClaudeService.instance) {
      ClaudeService.instance = new ClaudeService();
    }
    return ClaudeService.instance;
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1000) * this.COST_PER_1K_INPUT_TOKENS;
    const outputCost = (outputTokens / 1000) * this.COST_PER_1K_OUTPUT_TOKENS;
    return inputCost + outputCost;
  }

  async analyzeRepository(
    files: Array<{ path: string; content: string }>,
    packageJson?: any
  ): Promise<AnalysisResult> {
    const prompt = `You are a software architecture analysis system that ALWAYS responds in valid JSON format.
You must NEVER include any explanatory text outside of the JSON structure.
Your response must be parseable by JSON.parse() without any preprocessing.

Analyze this repository and generate a JSON response with exactly this structure:
{
  "overview": "A clear explanation of how the repository works...",
  "mermaidDiagram": "graph TD\\n..."
}

Repository Information:
Files:
${files.map((f) => `${f.path}:\n${f.content}\n---`).join("\n")}

${packageJson ? `Package.json:\n${JSON.stringify(packageJson, null, 2)}` : ""}

Requirements for the overview field:
1. Focus on the main components and their interactions
2. Explain the architecture decisions
3. Keep it clear and concise
4. Highlight any interesting patterns or practices

Requirements for the mermaidDiagram field:
1. Use graph TD for top-down diagrams
2. Group related components using subgraphs
3. Show key dependencies and data flow
4. Keep it high-level and focused on architecture
5. Use appropriate node shapes for different types (e.g., [Service], (Component), {Data})

CRITICAL: Your entire response must be a single valid JSON object that can be parsed with JSON.parse().
Do not include any text before or after the JSON.
Ensure all quotes and special characters in strings are properly escaped.`;

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-3-opus-20240229",
        max_tokens: 4000,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (!("text" in content)) {
        throw new Error("Unexpected response format from Claude");
      }

      // Log the raw response for debugging
      console.log("Claude raw response:", content.text);

      try {
        const result = JSON.parse(content.text);

        // Validate the response structure
        if (!result.overview || typeof result.overview !== "string") {
          throw new Error("Missing or invalid 'overview' in response");
        }
        if (
          !result.mermaidDiagram ||
          typeof result.mermaidDiagram !== "string"
        ) {
          throw new Error("Missing or invalid 'mermaidDiagram' in response");
        }

        // Add cost information
        const inputTokens = response.usage?.input_tokens || 0;
        const outputTokens = response.usage?.output_tokens || 0;
        const totalCost = this.calculateCost(inputTokens, outputTokens);

        return {
          ...result,
          cost: {
            inputTokens,
            outputTokens,
            totalCost,
          },
        };
      } catch (parseError) {
        console.error("Failed to parse Claude's response:", parseError);
        console.error("Response content:", content.text);
        throw new Error(
          `Failed to parse Claude's response: ${
            parseError instanceof Error
              ? parseError.message
              : "Unknown parse error"
          }`
        );
      }
    } catch (error) {
      console.error("Error calling Claude API:", error);
      throw new Error(
        `Failed to generate analysis: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}
