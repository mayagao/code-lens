import { NextRequest } from "next/server";
import { GitHubService } from "@/services/github";

export async function GET(
  req: NextRequest,
  { params }: { params: { owner: string; repo: string; sha: string } }
) {
  const { owner, repo, sha } = await Promise.resolve(params);

  try {
    const githubService = GitHubService.getInstance();
    const commit = await githubService.getCommit(owner, repo, sha);

    if (!commit) {
      return new Response("Commit not found", { status: 404 });
    }

    return new Response(JSON.stringify(commit), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching commit:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch commit details" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
