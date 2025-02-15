export interface RepositoryAnalysis {
  summary: string;
  architecture: string; // Mermaid diagram definition
  technologies: Technology[];
  directoryStructure: DirectoryNode;
}

export interface Technology {
  name: string;
  category: "language" | "framework" | "library" | "tool";
  description: string;
  version?: string;
}

export interface DirectoryNode {
  name: string;
  type: "file" | "directory";
  description?: string;
  children?: DirectoryNode[];
}

export interface LearnedConcept {
  id: string;
  name: string;
  description: string;
  category: string;
  confidence: number;
  learnedAt: Date;
}

export interface CommitAnalysis {
  commitId: string;
  summary: string;
  functionalityChanges: string[];
  conceptsIntroduced: LearnedConcept[];
  architectureUpdate?: string; // Mermaid diagram definition
}

export interface User {
  id: string;
  githubId: string;
  name: string;
  email: string;
  avatarUrl: string;
  learnedConcepts: LearnedConcept[];
  progress: number;
}

export interface Repository {
  id: string;
  name: string;
  owner: string;
  description: string;
  lastAnalyzed?: Date;
  analysis?: RepositoryAnalysis;
}

export interface Commit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  url: string;
}
