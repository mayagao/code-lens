import { NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({
  name: "codelens-analysis",
  version: "1.0.0",
});

export async function POST(request: Request) {
  try {
    const { tool, args } = await request.json();

    if (!tool || !args) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const result = await server.tool(tool, args);
    if (!result?.content?.[0]?.text) {
      return NextResponse.json(
        { error: "Failed to process request" },
        { status: 500 }
      );
    }

    return NextResponse.json(JSON.parse(result.content[0].text));
  } catch (error) {
    console.error("MCP API error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
