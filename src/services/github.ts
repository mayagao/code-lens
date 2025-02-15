import { Octokit } from "@octokit/rest";
import { Repository } from "@/types";

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

  async getRepositoryContents(
    owner: string,
    repo: string,
    path: string = ""
  ): Promise<any> {
    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    return data;
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
}
