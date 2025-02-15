"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import mermaid from "mermaid";

interface Commit {
  sha: string;
  message: string;
  author: {
    name: string;
    avatarUrl: string;
    date: string;
  };
  stats?: {
    additions: number;
    deletions: number;
  };
  url: string;
}

interface CommitAnalysis {
  codeChanges: {
    type: string;
    file: string;
    lines: string;
    explanation: string;
  }[];
  architectureDiagram: {
    diagram: string;
    explanation: string;
  };
  reactConcept: {
    concept: string;
    codeSnippet: string;
    explanation: string;
  };
}

export default function CommitAnalysisPage() {
  const params = useParams();
  const [commit, setCommit] = useState<Commit | null>(null);
  const [analysis, setAnalysis] = useState<CommitAnalysis | null>(null);
  const [commitLoading, setCommitLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);
  const diagramRef = useRef<HTMLDivElement>(null);

  // Initialize mermaid
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: true,
      theme: "default",
      securityLevel: "loose",
    });
  }, []);

  // Render mermaid diagram when analysis changes
  useEffect(() => {
    if (analysis?.architectureDiagram?.diagram && diagramRef.current) {
      mermaid
        .render("mermaid-diagram", analysis.architectureDiagram.diagram)
        .then(({ svg }) => {
          if (diagramRef.current) {
            diagramRef.current.innerHTML = svg;
          }
        })
        .catch((error) => {
          console.error("Failed to render diagram:", error);
        });
    }
  }, [analysis?.architectureDiagram?.diagram]);

  // Fetch commit details immediately
  useEffect(() => {
    const fetchCommit = async () => {
      try {
        const response = await fetch(
          `/api/repos/${params.owner}/${params.repo}/commits/${params.sha}`
        );
        if (!response.ok) throw new Error("Failed to fetch commit details");
        const data = await response.json();
        setCommit(data);
      } catch (error) {
        console.error("Error fetching commit:", error);
        setError(
          error instanceof Error ? error.message : "Failed to fetch commit"
        );
      } finally {
        setCommitLoading(false);
      }
    };

    fetchCommit();
  }, [params.owner, params.repo, params.sha]);

  // Fetch analysis separately
  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        const response = await fetch(
          `/api/repos/${params.owner}/${params.repo}/commits/${params.sha}/analysis`
        );
        const data = await response.json();
        console.log("Raw analysis data:", data);

        if (!response.ok) {
          setError(data.details || "Failed to fetch analysis");
          setRawResponse(data.rawResponse || null);
          if (data.codeChanges) {
            setAnalysis(data);
          }
        } else {
          // Handle the nested summary structure
          const normalizedAnalysis = {
            codeChanges: data.codeChanges || [],
            architectureDiagram: data.architectureDiagram || {
              diagram: "",
              explanation: "",
            },
            reactConcept: data.reactConcept || {
              concept: "",
              codeSnippet: "",
              explanation: "",
            },
          };
          console.log("Normalized analysis:", normalizedAnalysis);
          setAnalysis(normalizedAnalysis);
          setError(null);
          setRawResponse(null);
        }
      } catch (error) {
        console.error("Error fetching analysis:", error);
        setError(
          error instanceof Error ? error.message : "Failed to fetch analysis"
        );
      } finally {
        setAnalysisLoading(false);
      }
    };

    fetchAnalysis();
  }, [params.owner, params.repo, params.sha]);

  if (commitLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
        </div>
      </div>
    );
  }

  if (!commit) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Commit Not Found
          </h1>
          <p className="text-gray-600">
            The commit you're looking for doesn't exist or you don't have access
            to it.
          </p>
          <Link
            href={`/${params.owner}/${params.repo}`}
            className="mt-4 inline-block text-blue-600 hover:text-blue-800"
          >
            ← Back to repository
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Commit Header */}
      <div className="mb-8 pb-6 border-b">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {commit.message}
        </h1>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <img
              src={commit.author.avatarUrl}
              alt={commit.author.name}
              className="w-5 h-5 rounded-full"
            />
            <span>{commit.author.name}</span>
          </div>
          <span>•</span>
          <span>
            {new Date(commit.author.date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "numeric",
            })}
          </span>
          <span>•</span>
          <a
            href={commit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono hover:text-blue-600"
          >
            {commit.sha.substring(0, 7)}
          </a>
        </div>
      </div>

      {/* Analysis Section */}
      <div className="space-y-8">
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-red-800 mb-2">
              Analysis Error
            </h2>
            <p className="text-red-700 mb-4">{error}</p>
            {rawResponse && (
              <div className="mt-4 p-4 bg-red-100 rounded overflow-auto">
                <h3 className="text-sm font-medium text-red-800 mb-2">
                  Raw Response:
                </h3>
                <pre className="text-xs text-red-600">{rawResponse}</pre>
              </div>
            )}
          </div>
        ) : null}

        {analysisLoading ? (
          <div className="animate-pulse space-y-6">
            <div className="h-40 bg-gray-100 rounded-lg"></div>
            <div className="h-40 bg-gray-100 rounded-lg"></div>
            <div className="h-40 bg-gray-100 rounded-lg"></div>
          </div>
        ) : analysis ? (
          <>
            {/* Code Changes Section */}
            <section className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  Code Changes
                </h2>
              </div>
              <div className="p-6">
                {analysis.codeChanges?.map((change, index) => (
                  <div key={index} className="mb-6 last:mb-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">
                        {change.type}
                      </span>
                      <span className="text-gray-600">{change.file}</span>
                      <span className="text-gray-500">({change.lines})</span>
                    </div>
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>{change.explanation}</ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Architecture Diagram Section */}
            {analysis.architectureDiagram?.diagram && (
              <section className="bg-white rounded-lg shadow">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Architecture Diagram
                  </h2>
                </div>
                <div className="p-6">
                  <div className="mb-4 overflow-x-auto" ref={diagramRef} />
                  {analysis.architectureDiagram.explanation && (
                    <p className="text-gray-700">
                      {analysis.architectureDiagram.explanation}
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* React Concept Section */}
            {analysis.reactConcept && (
              <section className="bg-white rounded-lg shadow">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">
                    React Concept Takeaway
                  </h2>
                </div>
                <div className="p-6">
                  <h3 className="font-medium mb-3">
                    {analysis.reactConcept.concept}
                  </h3>
                  {analysis.reactConcept.codeSnippet && (
                    <pre className="bg-gray-800 text-gray-100 p-4 rounded-md mb-3 overflow-x-auto">
                      <code>{analysis.reactConcept.codeSnippet}</code>
                    </pre>
                  )}
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown>
                      {analysis.reactConcept.explanation}
                    </ReactMarkdown>
                  </div>
                </div>
              </section>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
