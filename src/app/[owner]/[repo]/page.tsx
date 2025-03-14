"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { GitHubService } from "@/services/github";
import { AnalysisService } from "@/services/analysis";
import { useAppStore } from "@/store";
import type { Commit } from "@/services/github";
import { CommitList } from "@/components/CommitList";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Mermaid from "@/components/Mermaid";
import {
  FunctionCall,
  StateUsage,
  DataFlow,
} from "@/app/api/_services/codeParser";
import CodeFlowGraph from "@/components/CodeFlowGraph";

interface RepoPageParams {
  owner: string;
  repo: string;
  [key: string]: string | string[];
}

interface Location {
  line: number;
  column: number;
}

interface FunctionRelationship {
  source: string;
  target: string;
  type: string;
  location: Location;
}

interface PropFlow {
  component: string;
  prop: string;
  value: string;
  isCallback?: boolean;
}

interface StateEffect {
  context: string;
  state: string;
  operation: "read" | "write" | "dependency";
  location: Location;
}

export default function RepositoryPage() {
  const params = useParams<RepoPageParams>();
  const { owner, repo } = params;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [parsedFiles, setParsedFiles] = useState<Record<string, any> | null>(
    null
  );
  const [hasNewCommits, setHasNewCommits] = useState(false);
  const [lastAnalyzedCommit, setLastAnalyzedCommit] = useState<string | null>(
    null
  );
  const [latestCommitSha, setLatestCommitSha] = useState<string | null>(null);

  const currentRepository = useAppStore((state) => state.currentRepository);
  const repositoryAnalysis = useAppStore((state) => state.repositoryAnalysis);
  const setRepositoryAnalysis = useAppStore(
    (state) => state.setRepositoryAnalysis
  );

  useEffect(() => {
    async function fetchRepositoryData() {
      if (!owner || !repo) return;

      try {
        setLoading(true);
        setIsLoadingCommits(true);
        const analysisService = AnalysisService.getInstance();

        // Fetch commits
        try {
          const recentCommits = await analysisService.getRecentCommits(
            owner,
            repo
          );
          setCommits(recentCommits);
        } catch (err) {
          console.error("Failed to fetch commits:", err);
          setError("Failed to fetch commits");
        } finally {
          setIsLoadingCommits(false);
        }

        // Fetch existing analysis if available
        try {
          const analysis = await fetch(`/api/repos/${owner}/${repo}/analysis`);
          const data = await analysis.json();
          if (data) {
            setRepositoryAnalysis({
              mermaidDiagram: data.mermaidDiagram,
              concepts: data.concepts || [],
              lastAnalyzedCommit: data.lastAnalyzedCommit,
              isLoading: false,
              error: null,
            });
            setParsedFiles(data.parsedFiles);
            setHasNewCommits(data.hasNewCommits || false);
            setLastAnalyzedCommit(data.lastAnalyzedCommit);
            setLatestCommitSha(data.latestCommitSha);
          }
        } catch (err) {
          console.error("Failed to fetch analysis:", err);
        }

        setError(null);
      } catch (err) {
        console.error("Failed to fetch repository data:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch repository data"
        );
      } finally {
        setLoading(false);
      }
    }

    fetchRepositoryData();
  }, [owner, repo, setRepositoryAnalysis]);

  const handleAnalyze = async () => {
    if (!owner || !repo) return;

    try {
      setIsAnalyzing(true);

      const response = await fetch(`/api/repos/${owner}/${repo}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to analyze repository");
      }

      const data = await response.json();
      setParsedFiles(data.parsedFiles);
    } catch (err) {
      console.error("Failed to analyze repository:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-pulse flex flex-col gap-4 w-full max-w-4xl">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-8">
        {/* Repository Header */}
        <header className="border-b pb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold mb-2">
                {owner}/{repo}
              </h1>
              {currentRepository?.description && (
                <p className="text-gray-600">{currentRepository.description}</p>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="space-y-8">
          {/* Analysis Section */}
          <Card className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Repository Analysis</h2>
              <Button onClick={handleAnalyze} disabled={isAnalyzing}>
                {isAnalyzing ? "Analyzing..." : "Analyze"}
              </Button>
            </div>

            {parsedFiles ? (
              <div className="space-y-8">
                <div className="border rounded-lg p-4">
                  <h3 className="font-medium text-lg mb-4">
                    Code Flow Visualization
                  </h3>
                  <CodeFlowGraph
                    parsedFiles={parsedFiles}
                    repositoryId={currentRepository?.id || `${owner}/${repo}`}
                  />
                </div>

                {Object.entries(parsedFiles).map(([filename, data]) => (
                  <div key={filename} className="border rounded-lg p-4">
                    <h3 className="font-medium text-lg mb-2">{filename}</h3>
                    <div className="space-y-4">
                      {/* Functions */}
                      {data.functions?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">
                            Functions
                          </h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {data.functions.map((fn: any, i: number) => (
                              <li key={i}>
                                {fn.name}({fn.params.join(", ")})
                                {fn.isAsync && " async"}
                                {fn.isExported && " (exported)"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Classes */}
                      {data.classes?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">
                            Classes
                          </h4>
                          <ul className="list-disc pl-5 space-y-2">
                            {data.classes.map((cls: any, i: number) => (
                              <li key={i}>
                                <div>
                                  {cls.name} {cls.isExported && "(exported)"}
                                </div>
                                {cls.methods.length > 0 && (
                                  <ul className="list-circle pl-5 mt-1 space-y-1">
                                    {cls.methods.map(
                                      (method: any, j: number) => (
                                        <li key={j} className="text-sm">
                                          {method.name}(
                                          {method.params.join(", ")})
                                          {method.isAsync && " async"}
                                        </li>
                                      )
                                    )}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Hooks */}
                      {data.hooks?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">
                            Hooks
                          </h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {data.hooks.map((hook: any, i: number) => (
                              <li key={i}>
                                {hook.name}
                                {hook.dependencies &&
                                  ` [${hook.dependencies.join(", ")}]`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Imports */}
                      {data.imports?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">
                            Imports
                          </h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {data.imports.map((imp: any, i: number) => (
                              <li key={i}>
                                {imp.source}
                                {imp.specifiers.length > 0 &&
                                  ` (${imp.specifiers.join(", ")})`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Function Calls */}
                      {data.functionCalls?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">
                            Function Calls
                          </h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {data.functionCalls.map(
                              (call: FunctionCall, i: number) => (
                                <li key={i} className="text-sm">
                                  {call.caller} calls {call.callee}
                                  {call.arguments.length > 0 &&
                                    ` with (${call.arguments.join(", ")})`}
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      )}

                      {/* State Usage */}
                      {data.stateUsage?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">
                            State Management
                          </h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {data.stateUsage.map(
                              (state: StateUsage, i: number) => (
                                <li key={i} className="text-sm">
                                  {state.name} ({state.type})
                                  {state.setter &&
                                    ` with setter ${state.setter}`}
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      )}

                      {/* Data Flow */}
                      {data.dataFlow?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">
                            Data Flow
                          </h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {data.dataFlow.map((flow: DataFlow, i: number) => (
                              <li key={i} className="text-sm">
                                {flow.type === "prop" ? "Props" : "Data"} flow
                                from {flow.source} to {flow.target}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Function Relationships */}
                      {data.relationships?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">
                            Function Relationships
                          </h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {data.relationships.map(
                              (rel: FunctionRelationship, i: number) => (
                                <li key={i} className="text-sm">
                                  {rel.source} {rel.type} {rel.target} (line{" "}
                                  {rel.location.line})
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      )}

                      {/* Prop Flow */}
                      {data.propFlow?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">
                            Component Props
                          </h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {data.propFlow.map((prop: PropFlow, i: number) => (
                              <li key={i} className="text-sm">
                                <span className="font-medium">
                                  {prop.component}
                                </span>{" "}
                                receives{" "}
                                <span className="text-blue-600">
                                  {prop.prop}
                                </span>
                                {prop.isCallback ? " (callback)" : ""} ={" "}
                                <span className="text-green-600">
                                  {prop.value}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* State Effects */}
                      {data.stateEffects?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-700 mb-2">
                            State Usage
                          </h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {data.stateEffects.map(
                              (effect: StateEffect, i: number) => (
                                <li key={i} className="text-sm">
                                  <span className="font-medium">
                                    {effect.context}
                                  </span>{" "}
                                  {effect.operation === "read" && "reads"}
                                  {effect.operation === "write" && "writes"}
                                  {effect.operation === "dependency" &&
                                    "depends on"}{" "}
                                  <span className="text-purple-600">
                                    {effect.state}
                                  </span>
                                  {" (line "}
                                  {effect.location.line})
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-600">
                Click the Analyze button to see the parsed structure of this
                repository.
              </p>
            )}
          </Card>

          {/* Commits Section */}
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Recent Commits</h2>
            <CommitList commits={commits} isLoading={isLoadingCommits} />
          </Card>
        </div>
      </div>
    </div>
  );
}
