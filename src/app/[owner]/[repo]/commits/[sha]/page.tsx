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
  const [codeChanges, setCodeChanges] = useState<
    CommitAnalysis["codeChanges"] | null
  >(null);
  const [architectureDiagram, setArchitectureDiagram] = useState<
    CommitAnalysis["architectureDiagram"] | null
  >(null);
  const [reactConcept, setReactConcept] = useState<
    CommitAnalysis["reactConcept"] | null
  >(null);
  const [commitLoading, setCommitLoading] = useState(true);
  const [sectionsLoading, setSectionsLoading] = useState({
    codeChanges: true,
    architectureDiagram: true,
    reactConcept: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Initialize mermaid
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: true,
      theme: "default",
      securityLevel: "loose",
    });
  }, []);

  // Render mermaid diagram when architectureDiagram changes
  useEffect(() => {
    if (architectureDiagram?.diagram && diagramRef.current) {
      mermaid
        .render("mermaid-diagram", architectureDiagram.diagram)
        .then(({ svg }) => {
          if (diagramRef.current) {
            diagramRef.current.innerHTML = svg;
          }
        })
        .catch((error) => {
          console.error("Failed to render diagram:", error);
        });
    }
  }, [architectureDiagram?.diagram]);

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

  // Fetch analysis with progressive loading
  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        console.log(
          "Fetching analysis for:",
          params.owner,
          params.repo,
          params.sha
        );
        const response = await fetch(
          `/api/repos/${params.owner}/${params.repo}/commits/${params.sha}/analysis`
        );

        console.log("Response status:", response.status);
        console.log(
          "Response headers:",
          Object.fromEntries(response.headers.entries())
        );

        const responseText = await response.text();
        console.log("Raw response text:", responseText);

        let data;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          console.error("Failed to parse response:", parseError);
          setError("Invalid JSON response from server");
          setSectionsLoading({
            codeChanges: false,
            architectureDiagram: false,
            reactConcept: false,
          });
          return;
        }

        if (!response.ok || data.error) {
          console.error("Error response:", data);
          setError(data.details || "Failed to fetch analysis");
          setRawResponse(data.rawResponse || null);

          // If we have partial data despite the error, use it
          if (data.analysis) {
            if (data.analysis.codeChanges) {
              setCodeChanges(data.analysis.codeChanges);
            }
            if (data.analysis.architectureDiagram) {
              setArchitectureDiagram(data.analysis.architectureDiagram);
            }
            if (data.analysis.reactConcept) {
              setReactConcept(data.analysis.reactConcept);
            }
          }
        } else if (data.analysis) {
          // Set each section independently
          setCodeChanges(data.analysis.codeChanges || []);
          setArchitectureDiagram(data.analysis.architectureDiagram || null);
          setReactConcept(data.analysis.reactConcept || null);
          setError(null);
          setRawResponse(null);
        }
      } catch (error) {
        console.error("Error fetching analysis:", error);
        setError(
          error instanceof Error ? error.message : "Failed to fetch analysis"
        );
      } finally {
        setSectionsLoading({
          codeChanges: false,
          architectureDiagram: false,
          reactConcept: false,
        });
      }
    };

    fetchAnalysis();
  }, [params.owner, params.repo, params.sha]);

  // Add regenerate function
  const handleRegenerate = async () => {
    setIsRegenerating(true);
    setError(null);
    setRawResponse(null);

    try {
      console.log(
        "Forcing regeneration for:",
        params.owner,
        params.repo,
        params.sha
      );
      const response = await fetch(
        `/api/repos/${params.owner}/${params.repo}/commits/${params.sha}/analysis?force=true`
      );

      console.log("Regeneration response status:", response.status);
      const responseText = await response.text();
      console.log("Raw regeneration response:", responseText);

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error("Failed to parse regeneration response:", parseError);
        setError("Invalid JSON response from server");
        return;
      }

      if (!response.ok || data.error) {
        console.error("Error response:", data);
        setError(data.details || "Failed to regenerate analysis");
        setRawResponse(data.rawResponse || null);
        if (data.analysis) {
          setCodeChanges(data.analysis.codeChanges || []);
          setArchitectureDiagram(data.analysis.architectureDiagram || null);
          setReactConcept(data.analysis.reactConcept || null);
        }
        return;
      }

      if (data.analysis) {
        setCodeChanges(data.analysis.codeChanges || []);
        setArchitectureDiagram(data.analysis.architectureDiagram || null);
        setReactConcept(data.analysis.reactConcept || null);
        setError(null);
        setRawResponse(null);
      }
    } catch (error) {
      console.error("Error during regeneration:", error);
      setError(
        error instanceof Error ? error.message : "Failed to regenerate analysis"
      );
    } finally {
      setIsRegenerating(false);
    }
  };

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
      {/* Commit Header with Regenerate Button */}
      <div className="mb-8 pb-6 border-b">
        <div className="flex justify-between items-start mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {commit.message}
          </h1>
          <button
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              isRegenerating
                ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            } transition-colors`}
          >
            {isRegenerating ? (
              <span className="flex items-center">
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Regenerating...
              </span>
            ) : (
              "Regenerate Analysis"
            )}
          </button>
        </div>
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

        {/* Code Changes Section */}
        <section className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              Code Changes
            </h2>
          </div>
          <div className="p-6">
            {sectionsLoading.codeChanges ? (
              <div className="animate-pulse space-y-4">
                <div className="h-8 bg-gray-100 rounded w-2/3"></div>
                <div className="h-4 bg-gray-100 rounded w-1/2"></div>
                <div className="h-4 bg-gray-100 rounded w-3/4"></div>
              </div>
            ) : codeChanges?.length ? (
              codeChanges.map((change, index) => (
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
              ))
            ) : (
              <p className="text-gray-500">No code changes to display</p>
            )}
          </div>
        </section>

        {/* Architecture Diagram Section */}
        {(sectionsLoading.architectureDiagram ||
          architectureDiagram?.diagram) && (
          <section className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Architecture Diagram
              </h2>
            </div>
            <div className="p-6">
              {sectionsLoading.architectureDiagram ? (
                <div className="animate-pulse">
                  <div className="h-40 bg-gray-100 rounded-lg mb-4"></div>
                  <div className="h-4 bg-gray-100 rounded w-2/3"></div>
                </div>
              ) : (
                <>
                  <div className="mb-4 overflow-x-auto" ref={diagramRef} />
                  {architectureDiagram?.explanation && (
                    <p className="text-gray-700">
                      {architectureDiagram.explanation}
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* React Concept Section */}
        {(sectionsLoading.reactConcept || reactConcept) && (
          <section className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                React Concept Takeaway
              </h2>
            </div>
            <div className="p-6">
              {sectionsLoading.reactConcept ? (
                <div className="animate-pulse space-y-4">
                  <div className="h-6 bg-gray-100 rounded w-1/3"></div>
                  <div className="h-24 bg-gray-100 rounded"></div>
                  <div className="h-4 bg-gray-100 rounded w-3/4"></div>
                </div>
              ) : (
                <>
                  <h3 className="font-medium mb-3">{reactConcept?.concept}</h3>
                  {reactConcept?.codeSnippet && (
                    <pre className="bg-gray-800 text-gray-100 p-4 rounded-md mb-3 overflow-x-auto">
                      <code>{reactConcept.codeSnippet}</code>
                    </pre>
                  )}
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown>
                      {reactConcept?.explanation || ""}
                    </ReactMarkdown>
                  </div>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
