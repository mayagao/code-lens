// GitHub API helper functions that we had in the main file
export async function fetchFromGitHub(endpoint: string, token?: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "codelens-mcp-server",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

// Additional GitHub API utilities
export async function getDiff(
  owner: string,
  repo: string,
  commit_sha: string,
  token?: string
) {
  const headers = {
    Accept: "application/vnd.github.v3.diff",
    "User-Agent": "codelens-mcp-server",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${commit_sha}`,
    { headers }
  );
  return response.text();
}

export async function getPackageJson(
  owner: string,
  repo: string,
  token?: string
) {
  try {
    const packageJson = await fetchFromGitHub(
      `/repos/${owner}/${repo}/contents/package.json`,
      token
    );
    const decodedContent = Buffer.from(
      packageJson.content,
      "base64"
    ).toString();
    return JSON.parse(decodedContent);
  } catch (e) {
    return null;
  }
}
