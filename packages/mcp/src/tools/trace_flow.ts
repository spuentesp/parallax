"use strict";

import { z } from "zod";

/**
 * Schema for trace_flow input - replaces manual get_call_chain + trace_impact
 */
export const TraceFlowInputSchema = z.object({
  /**
   * The starting point for the trace
   * Can be a contract key, symbol, or GlobalId
   */
  from: z.object({
    /** Contract key (e.g., "http:GET /api/orders") */
    contract: z.string().optional(),
    /** Symbol name (e.g., function or class name) */
    symbol: z.string().optional(),
    /** GlobalId of a specific code location */
    globalId: z.string().optional(),
  }).refine((data) => {
    // Exactly one of contract, symbol, or globalId must be provided
    const provided = [data.contract, data.symbol, data.globalId].filter(Boolean);
    return provided.length === 1;
  }, "Exactly one of contract, symbol, or globalId must be provided"),
  
  /**
   * Trace strategy: BFS for breadth-first (impact analysis) or 
   * DFS for depth-first (root cause analysis)
   */
  strategy: z.enum(["BFS", "DFS"]).default("BFS"),
  
  /** Maximum number of hops to follow */
  maxHops: z.number().int().positive().default(12),
  
  /** Maximum number of parallel paths to explore */
  maxPaths: z.number().int().positive().default(5),
  
  /** Snapshot ID ("live" or snap_<hex>) */
  snapshot: z.string().default("live"),
  
  /** Optional repo filter */
  repo: z.string().optional(),
  
  /** Include gap detection in results */
  detectGaps: z.boolean().default(true),
});

export type TraceFlowInput = z.infer<typeof TraceFlowInputSchema>;

/**
 * Schema for trace_flow output
 */
export const TraceFlowOutputSchema = z.object({
  /** The original input parameters */
  input: TraceFlowInputSchema,
  
  /** The complete trace path */
  path: z.array(z.object({
    /** Unique identifier for this hop */
    id: z.string(),
    
    /** Lane this hop belongs to */
    lane: z.enum([
      "data",
      "data_access",
      "domain",
      "api_handler",
      "contract",
      "client_call",
      "client_logic",
      "sink"
    ]),
    
    /** Human-readable label */
    label: z.string(),
    
    /** Repository containing this hop */
    repo: z.string(),
    
    /** File path within the repository */
    path: z.string(),
    
    /** Line number */
    line: z.number().int().positive(),
    
    /** Identifier at this location */
    contains: z.string(),
    
    /** Verification status */
    status: z.enum(["verified", "unverified", "contradicted"]),
    
    /** Reason for status */
    reason: z.string().optional(),
  })),
  
  /** Links between hops showing relationships */
  links: z.array(z.object({
    from: z.string(),
    to: z.string(),
    relation: z.string(),
    basis: z.enum(["engine", "asserted", "not_found"]),
    because: z.string(),
  })),
  
  /** Gaps where the trace couldn't continue */
  gaps: z.array(z.object({
    after: z.string(),
    reason: z.string(),
    candidates: z.array(z.object({
      repo: z.string(),
      path: z.string(),
      line: z.number().int().positive(),
      contains: z.string(),
      confidence: z.number().min(0).max(1),
    })).optional(),
  })),
  
  /** Where the trace ends */
  sink: z.object({
    hop: z.string(),
    kind: z.enum([
      "rendered",
      "stored",
      "sent",
      "discarded",
      "returned",
      "unknown"
    ]),
    description: z.string(),
  }).optional(),
  
  /** Whether the trace is complete */
  complete: z.boolean(),
  
  /** Statistics about the trace */
  stats: z.object({
    hopsExplored: z.number().int().nonnegative(),
    hopsConfirmed: z.number().int().nonnegative(),
    linksConfirmed: z.number().int().nonnegative(),
    gapsDetected: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
});

export type TraceFlowOutput = z.infer<typeof TraceFlowOutputSchema>;

/**
 * Implementation of the trace_flow tool
 */
export async function traceFlow(input: TraceFlowInput): Promise<TraceFlowOutput> {
  // Helper function to get call sites using Lain tools
  async function getCallSites(query: string, snapshot: string): Promise<Array<{
    label: string;
    repo: string;
    path: string;
    line: number;
    contains: string;
    confidence: number;
  }>> {
    try {
      // Use Lain's get_call_sites tool
      const result = await lain.getCallSites({
        query,
        snapshot,
        repo: input.repo,
      });

      return result.map(site => ({
        label: site.label || site.contains,
        repo: site.repo || input.repo || "unknown",
        path: site.path,
        line: site.line,
        contains: site.contains,
        confidence: site.confidence || 0.9, // Default high confidence for call sites
      }));
    } catch (error) {
      console.error(`Error getting call sites: ${error}`);
      return [];
    }
  }

  // Helper function to search code using Lain tools
  async function searchCode(query: string, snapshot: string): Promise<Array<{
    label: string;
    repo: string;
    path: string;
    line: number;
    contains: string;
    confidence: number;
  }>> {
    try {
      // Use Lain's search_code tool
      const result = await lain.searchCode({
        query,
        snapshot,
        repo: input.repo,
        limit: input.maxPaths,
      });

      return result.map(item => ({
        label: item.label || item.contains,
        repo: item.repo || input.repo || "unknown",
        path: item.path,
        line: item.line,
        contains: item.contains,
        confidence: calculateConfidence(item), // Calculate confidence based on search result
      }));
    } catch (error) {
      console.error(`Error searching code: ${error}`);
      return [];
    }
  }

  // Helper function to calculate confidence score for search results
  function calculateConfidence(item: any): number {
    // Base confidence on how well the item matches the query
    let confidence = 0.5; // Default medium confidence

    // Increase confidence for exact matches
    if (item.exactMatch) {
      confidence += 0.3;
    }

    // Increase confidence for items in the same repository
    if (item.repo === input.repo) {
      confidence += 0.2;
    }

    // Cap confidence at 1.0
    return Math.min(confidence, 1.0);
  }

  // Helper function to get gap candidates
  async function getGapCandidates(
    currentHop: TraceFlowOutput["path"][number],
    input: TraceFlowInput
  ): Promise<TraceFlowOutput["path"]> {
    const candidates: TraceFlowOutput["path"] = [];

    try {
      // Try to find similar code in other repositories
      const similarCode = await lain.searchCode({
        query: currentHop.contains,
        snapshot: input.snapshot,
        repo: input.repo ? undefined : currentHop.repo, // Search in other repos if current repo is specified
        limit: 5,
      });

      for (const item of similarCode) {
        candidates.push({
          id: `hop_${path.length + candidates.length}`,
          lane: currentHop.lane,
          label: `Potential gap candidate: ${item.label || item.contains}`,
          repo: item.repo || "unknown",
          path: item.path,
          line: item.line,
          contains: item.contains,
          status: "unverified",
          reason: "Potential gap candidate",
        });
      }

      // If no candidates found, add a generic gap
      if (candidates.length === 0) {
        candidates.push({
          id: `hop_${path.length + candidates.length}`,
          lane: currentHop.lane,
          label: "Gap",
          repo: input.repo || "unknown",
          path: "",
          line: 0,
          contains: "",
          status: "unverified",
          reason: "No candidates found for gap",
        });
      }
    } catch (error) {
      console.error(`Error getting gap candidates: ${error}`);
      // Add a generic gap if we can't find candidates due to an error
      candidates.push({
        id: `hop_${path.length + candidates.length}`,
        lane: currentHop.lane,
        label: "Gap due to error",
        repo: input.repo || "unknown",
        path: "",
        line: 0,
        contains: "",
        status: "unverified",
        reason: `Error getting gap candidates: ${error}`,
      });
    }

    return candidates;
  }

  // Rest of the traceFlow function remains the same
  // Add findNextHops function
  async function findNextHops(
    currentHop: TraceFlowOutput["path"][number],
    input: TraceFlowInput
  ): Promise<TraceFlowOutput["path"]> {
    const nextHops: TraceFlowOutput["path"] = [];

    // Determine the type of the current hop
    let query: string;
    let lane: TraceFlowOutput["path"][number]["lane"];

    if (currentHop.lane === "contract") {
      // For contract hops, look for API handlers
      query = `api_handler:${currentHop.contains}`;
      lane = "api_handler";
    } else if (currentHop.lane === "api_handler") {
      // For API handlers, look for domain logic
      query = `domain:${currentHop.contains}`;
      lane = "domain";
    } else if (currentHop.lane === "domain") {
      // For domain logic, look for data access
      query = `data_access:${currentHop.contains}`;
      lane = "data_access";
    } else if (currentHop.lane === "data_access") {
      // For data access, look for database operations
      query = `db:${currentHop.contains}`;
      lane = "data";
    } else if (currentHop.lane === "data") {
      // For database operations, look for RPC calls
      query = `rpc:${currentHop.contains}`;
      lane = "client_call";
    } else if (currentHop.lane === "client_call") {
      // For RPC calls, look for service implementations
      query = `service:${currentHop.contains}`;
      lane = "client_logic";
    } else {
      // Default case - look for any related code
      query = currentHop.contains;
      lane = "domain";
    }

    // Use Lain tools to find next hops
    try {
      // First try to get call sites
      const callSites = await getCallSites(query, input.snapshot);

      // If we found call sites, use them
      if (callSites.length > 0) {
        for (const site of callSites) {
          nextHops.push({
            id: `hop_${path.length + nextHops.length}`,
            lane,
            label: site.label || site.contains,
            repo: site.repo || input.repo || "unknown",
            path: site.path,
            line: site.line,
            contains: site.contains,
            status: "verified",
            reason: "Found via call sites",
          });
        }
      } else {
        // If no call sites found, try a code search
        const searchResults = await searchCode(query, input.snapshot);

        if (searchResults.length > 0) {
          for (const result of searchResults) {
            nextHops.push({
              id: `hop_${path.length + nextHops.length}`,
              lane,
              label: result.label || result.contains,
              repo: result.repo || input.repo || "unknown",
              path: result.path,
              line: result.line,
              contains: result.contains,
              status: "unverified",
              reason: "Found via code search",
            });
          }
        } else {
          // If nothing found, add a gap candidate
          if (input.detectGaps) {
            const gapCandidates = await getGapCandidates(currentHop, input);
            if (gapCandidates.length > 0) {
              nextHops.push(...gapCandidates);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error finding next hops: ${error}`);
      // Add a gap if we couldn't find next hops due to an error
      if (input.detectGaps) {
        nextHops.push({
          id: `hop_${path.length + nextHops.length}`,
          lane,
          label: "Gap due to error",
          repo: input.repo || "unknown",
          path: "",
          line: 0,
          contains: "",
          status: "unverified",
          reason: `Error finding next hops: ${error}`,
        });
      }
    }

    return nextHops;
  }

  // Rest of the traceFlow function remains the same
  const startTime = Date.now();
  let hopsExplored = 0;
  let hopsConfirmed = 0;
  let linksConfirmed = 0;
  let gapsDetected = 0;

  // Initialize the trace path
  const path: TraceFlowOutput["path"] = [];
  const links: TraceFlowOutput["links"] = [];
  const gaps: TraceFlowOutput["gaps"] = [];

  // Set up the initial hop based on the input
  let currentHop: TraceFlowOutput["path"][number] | null = null;
  if (input.from.contract) {
    // Start from a contract
    currentHop = {
      id: `hop_${path.length}`,
      lane: "contract",
      label: input.from.contract,
      repo: input.repo || "unknown",
      path: "",
      line: 0,
      contains: input.from.contract,
      status: "verified",
      reason: "Starting point from contract",
    };
  } else if (input.from.symbol) {
    // Start from a symbol
    currentHop = {
      id: `hop_${path.length}`,
      lane: "domain",
      label: input.from.symbol,
      repo: input.repo || "unknown",
      path: "",
      line: 0,
      contains: input.from.symbol,
      status: "verified",
      reason: "Starting point from symbol",
    };
  } else if (input.from.globalId) {
    // Start from a GlobalId
    currentHop = {
      id: `hop_${path.length}`,
      lane: "data",
      label: input.from.globalId,
      repo: input.repo || "unknown",
      path: "",
      line: 0,
      contains: input.from.globalId,
      status: "verified",
      reason: "Starting point from GlobalId",
    };
  }

  if (!currentHop) {
    throw new Error("Invalid starting point for trace");
  }

  // Add the initial hop to the path
  path.push(currentHop);
  hopsExplored++;
  hopsConfirmed++;

  // Implement the tracing logic based on the strategy
  if (input.strategy === "BFS") {
    // Breadth-first search implementation
    const queue: { hop: TraceFlowOutput["path"][number]; depth: number }[] = [
      { hop: currentHop, depth: 0 }
    ];

    while (queue.length > 0 && path.length < input.maxHops) {
      const { hop, depth } = queue.shift()!;
      hopsExplored++;

      // Find next hops based on the current hop
      const nextHops = await findNextHops(hop, input);

      for (const nextHop of nextHops) {
        // Add the next hop to the path
        path.push(nextHop);
        hopsConfirmed++;

        // Create a link between the current and next hop
        links.push({
          from: hop.id,
          to: nextHop.id,
          relation: "follows",
          basis: "engine",
          because: "BFS traversal",
        });
        linksConfirmed++;

        // If we've reached the maximum depth, add a gap
        if (depth >= input.maxHops - 1) {
          gaps.push({
            after: nextHop.id,
            reason: "Maximum depth reached",
          });
          gapsDetected++;
        } else {
          // Add to queue for further exploration
          queue.push({ hop: nextHop, depth: depth + 1 });
        }
      }

      // If no next hops found, add a gap
      if (nextHops.length === 0) {
        gaps.push({
          after: hop.id,
          reason: "No further hops found",
        });
        gapsDetected++;
      }
    }
  } else if (input.strategy === "DFS") {
    // Depth-first search implementation
    const stack: { hop: TraceFlowOutput["path"][number]; depth: number }[] = [
      { hop: currentHop, depth: 0 }
    ];

    while (stack.length > 0 && path.length < input.maxHops) {
      const { hop, depth } = stack.pop()!;
      hopsExplored++;

      // Find next hops based on the current hop
      const nextHops = await findNextHops(hop, input);

      for (const nextHop of nextHops) {
        // Add the next hop to the path
        path.push(nextHop);
        hopsConfirmed++;

        // Create a link between the current and next hop
        links.push({
          from: hop.id,
          to: nextHop.id,
          relation: "follows",
          basis: "engine",
          because: "DFS traversal",
        });
        linksConfirmed++;

        // If we've reached the maximum depth, add a gap
        if (depth >= input.maxHops - 1) {
          gaps.push({
            after: nextHop.id,
            reason: "Maximum depth reached",
          });
          gapsDetected++;
        } else {
          // Push to stack for further exploration
          stack.push({ hop: nextHop, depth: depth + 1 });
        }
      }

      // If no next hops found, add a gap
      if (nextHops.length === 0) {
        gaps.push({
          after: hop.id,
          reason: "No further hops found",
        });
        gapsDetected++;
      }
    }
  }

  // Calculate statistics
  const durationMs = Date.now() - startTime;

  // Return the trace result
  return {
    input,
    path,
    links,
    gaps,
    complete: gaps.length === 0,
    stats: {
      hopsExplored,
      hopsConfirmed,
      linksConfirmed,
      gapsDetected,
      durationMs,
    },
  };
}

/**
 * Tool specification for trace_flow
 */
export const TRACE_FLOW_SPEC = {
  implementation: traceFlow,
  type: "function",
  function: {
    name: "trace_flow",
    description: "Trace a value's flow through the codebase across boundaries (UI to DB, RPC to service, etc.). " +
      "Replaces manual get_call_chain + trace_impact with a single cross-boundary trace. " +
      "Supports BFS (impact analysis) and DFS (root cause analysis) strategies. " +
      "Reports explicit gaps where the trace cannot continue.",
    parameters: z.toJSONSchema(TraceFlowInputSchema) as Record<string, unknown>,
  },
};

/**
 * Convert trace_flow output to the existing TraceResult format for backward compatibility
 */
export function convertToTraceResult(flowOutput: TraceFlowOutput): any {
  return {
    seed: {
      key: flowOutput.input.from.contract || flowOutput.input.from.symbol || flowOutput.input.from.globalId,
      service: "", // Will need to be populated based on context
    },
    summary: `Cross-boundary trace from ${flowOutput.input.from.contract || flowOutput.input.from.symbol}`,
    hops: flowOutput.path.map(hop => ({
      id: hop.id,
      lane: hop.lane,
      label: hop.label,
      repo: hop.repo,
      path: hop.path,
      line: hop.line,
      contains: hop.contains,
      status: hop.status,
      reason: hop.reason || "",
      origin: "engine" as const,
    })),
    rejected: [], // trace_flow doesn't have rejected hops in the same way
    links: flowOutput.links.map(link => ({
      from: link.from,
      to: link.to,
      relation: link.relation,
      basis: link.basis,
      because: link.because,
      note: link.because,
    })),
    gaps: flowOutput.gaps.map(gap => ({
      after: gap.after,
      reason: gap.reason,
    })),
    sink: flowOutput.sink ? {
      hop: flowOutput.sink.hop,
      kind: flowOutput.sink.kind,
      description: flowOutput.sink.description,
    } : null,
    complete: flowOutput.complete,
    status: flowOutput.complete ? "available" : "failed:partial_trace",
    usage: {
      modelCalls: 0,
      toolCalls: 1, // Just the trace_flow call
      promptTokens: 0,
      completionTokens: 0,
      ms: flowOutput.stats.durationMs,
    },
    errors: [],
  };
}