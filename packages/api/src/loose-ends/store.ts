import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import type { Assessment, Category } from './types.js';

type Db = BetterSQLite3Database<typeof schema>;

export interface StoredAssessment extends Assessment {
  caseId: string;
  snippetHash: string;
  createdAt: number;
}

export function createLooseEndStore(db: Db) {
  return {
    async list(workspaceId: string): Promise<Map<string, StoredAssessment>> {
      const rows = await db
        .select()
        .from(schema.looseEndAssessment)
        .where(eq(schema.looseEndAssessment.workspaceId, workspaceId));
      return new Map(
        rows.map((r) => [
          r.caseId,
          {
            caseId: r.caseId,
            snippetHash: r.snippetHash,
            createdAt: r.createdAt,
            category: r.category as Category,
            reason: r.reason,
            evidence: r.evidence,
            source: 'model' as const,
            model: r.model,
          },
        ]),
      );
    },
    async put(
      workspaceId: string,
      caseId: string,
      snippetHash: string,
      a: Assessment,
    ): Promise<void> {
      await db
        .insert(schema.looseEndAssessment)
        .values({
          workspaceId,
          caseId,
          snippetHash,
          category: a.category,
          reason: a.reason,
          evidence: a.evidence,
          model: a.model ?? null,
          createdAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: [schema.looseEndAssessment.workspaceId, schema.looseEndAssessment.caseId],
          set: {
            snippetHash,
            category: a.category,
            reason: a.reason,
            evidence: a.evidence,
            model: a.model ?? null,
            createdAt: Date.now(),
          },
        });
    },
    async clear(workspaceId: string): Promise<void> {
      await db
        .delete(schema.looseEndAssessment)
        .where(and(eq(schema.looseEndAssessment.workspaceId, workspaceId)));
    },
  };
}
