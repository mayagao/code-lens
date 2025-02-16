import { Octokit } from "@octokit/rest";
import { Repository } from "@/types";
import { minimatch } from "minimatch";

// Constants for optimization
const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_DEPTH = 3;
const CORE_PATTERNS = [
  "package.json",
  "tsconfig.json",
  "src/**/index.ts",
  "src/**/types.ts",
  "src/app/**/page.tsx",
  "src/app/**/layout.tsx",
  "prisma/schema.prisma",
  "src/services/**/*.ts",
  "src/lib/**/*.ts",
];

export interface Commit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
    avatarUrl?: string;
  };
  url: string;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
}

export class GitHubService {
  private static instance: GitHubService;
  private octokit: Octokit;

  private constructor() {
    const token = process.env.NEXT_PUBLIC_GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        "GitHub token not found. Please set NEXT_PUBLIC_GITHUB_TOKEN in your .env.local file"
      );
    }

    this.octokit = new Octokit({
      auth: token,
    });
  }

  static getInstance(): GitHubService {
    if (!GitHubService.instance) {
      GitHubService.instance = new GitHubService();
    }
    return GitHubService.instance;
  }

  async getUserRepositories(): Promise<Repository[]> {
    const { data } = await this.octokit.repos.listForAuthenticatedUser({
      sort: "updated",
      per_page: 100,
      visibility: "all",
    });

    return data.map((repo) => ({
      id: repo.id.toString(),
      name: repo.name,
      owner: repo.owner.login,
      description: repo.description || "",
      lastAnalyzed: undefined,
    }));
  }

  async getLatestCommit(owner: string, repo: string): Promise<Commit> {
    const { data } = await this.octokit.repos.getCommit({
      owner,
      repo,
      ref: "HEAD",
    });

    return {
      sha: data.sha,
      message: data.commit.message,
      author: {
        name: data.commit.author?.name || "Unknown",
        email: data.commit.author?.email || "",
        date: data.commit.author?.date || new Date().toISOString(),
        avatarUrl: data.author?.avatar_url,
      },
      url: data.html_url,
      stats: data.stats
        ? {
            additions: data.stats.additions || 0,
            deletions: data.stats.deletions || 0,
            total: data.stats.total || 0,
          }
        : undefined,
      files: data.files?.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
      })),
    };
  }

  async getRecentCommits(
    owner: string,
    repo: string,
    limit: number = 10
  ): Promise<Commit[]> {
    const { data } = await this.octokit.repos.listCommits({
      owner,
      repo,
      per_page: limit,
    });

    const detailedCommits = await Promise.all(
      data.map(async (commit) => {
        const { data: fullCommit } = await this.octokit.repos.getCommit({
          owner,
          repo,
          ref: commit.sha,
        });

        return {
          sha: fullCommit.sha,
          message: fullCommit.commit.message,
          author: {
            name: fullCommit.commit.author?.name || "Unknown",
            email: fullCommit.commit.author?.email || "",
            date: fullCommit.commit.author?.date || new Date().toISOString(),
            avatarUrl: fullCommit.author?.avatar_url,
          },
          url: fullCommit.html_url,
          stats: fullCommit.stats
            ? {
                additions: fullCommit.stats.additions || 0,
                deletions: fullCommit.stats.deletions || 0,
                total: fullCommit.stats.total || 0,
              }
            : undefined,
          files: fullCommit.files?.map((file) => ({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
          })),
        };
      })
    );

    return detailedCommits;
  }

  private isImportantFile(path: string): boolean {
    return CORE_PATTERNS.some((pattern) => minimatch(path, pattern));
  }

  async getRepositoryContents(
    owner: string,
    repo: string,
    path: string = "",
    depth: number = MAX_DEPTH
  ): Promise<Array<{ path: string; content: string }>> {
    if (depth <= 0) return [];

    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    if (!Array.isArray(data)) {
      // Single file
      if ("content" in data && typeof data.content === "string") {
        if (data.size > MAX_FILE_SIZE) {
          console.log(`Skipping large file: ${data.path} (${data.size} bytes)`);
          return [];
        }
        const content = Buffer.from(data.content, "base64").toString();
        return [{ path: data.path, content }];
      }
      return [];
    }

    // Directory - recursively fetch contents of important files
    const files: Array<{ path: string; content: string }> = [];
    const promises: Promise<Array<{ path: string; content: string }>>[] = [];

    for (const item of data) {
      if (item.type === "file" && this.isImportantFile(item.path)) {
        promises.push(
          this.octokit.repos
            .getContent({
              owner,
              repo,
              path: item.path,
            })
            .then(({ data: fileData }) => {
              if (
                !Array.isArray(fileData) &&
                "content" in fileData &&
                typeof fileData.content === "string"
              ) {
                if (fileData.size > MAX_FILE_SIZE) {
                  console.log(
                    `Skipping large file: ${fileData.path} (${fileData.size} bytes)`
                  );
                  return [];
                }
                const content = Buffer.from(
                  fileData.content,
                  "base64"
                ).toString();
                return [{ path: fileData.path, content }];
              }
              return [];
            })
            .catch((error) => {
              console.error(`Error fetching file ${item.path}:`, error);
              return [];
            })
        );
      } else if (item.type === "dir") {
        promises.push(
          this.getRepositoryContents(owner, repo, item.path, depth - 1)
        );
      }
    }

    const results = await Promise.all(promises);
    return files.concat(...results);
  }

  async getRepositoryLanguages(
    owner: string,
    repo: string
  ): Promise<Record<string, number>> {
    const { data } = await this.octokit.repos.listLanguages({
      owner,
      repo,
    });

    return data;
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<Commit> {
    const { data } = await this.octokit.repos.getCommit({
      owner,
      repo,
      ref: sha,
    });

    return {
      sha: data.sha,
      message: data.commit.message,
      author: {
        name: data.commit.author?.name || "Unknown",
        email: data.commit.author?.email || "",
        date: data.commit.author?.date || new Date().toISOString(),
        avatarUrl: data.author?.avatar_url,
      },
      url: data.html_url,
      stats: data.stats
        ? {
            additions: data.stats.additions || 0,
            deletions: data.stats.deletions || 0,
            total: data.stats.total || 0,
          }
        : undefined,
      files: data.files?.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
      })),
    };
  }

  static async getCommit(owner: string, repo: string, sha: string) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch commit: ${response.statusText}`);
    }

    return response.json();
  }
}
