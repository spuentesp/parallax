import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { ClaimResult } from '../agent/claims.js';
import * as schema from '../db/schema.js';
import type { StoredTurn } from './history.js';

// Conversaciones persistidas. El dueño es un HASH del token de acceso: el token
// no se guarda, y otro token nunca ve, continúa ni borra una conversación ajena
// (para él no existe: el store devuelve null y la ruta responde 404).

export const MAX_TURNS_PER_CONVERSATION = 50;
export const MAX_CONVERSATIONS_PER_OWNER = 100;

export class ConversationFullError extends Error {
  constructor() {
    super(`this conversation reached ${MAX_TURNS_PER_CONVERSATION} turns: start a new one`);
    this.name = 'ConversationFullError';
  }
}

export function ownerOf(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

export interface ConversationRow {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
export interface ConversationSummary extends ConversationRow {
  turns: number;
}

export interface StoredTurnRow extends StoredTurn {
  id: string;
  /** Veredictos completos del motor (con su razón), tal como se mostraron. */
  claimResults: ClaimResult[];
  focus: unknown | null;
  model: string | null;
  createdAt: number;
}

export interface NewTurn {
  question: string;
  answer: string;
  status: string;
  claims: readonly ClaimResult[];
  focus: unknown | null;
  model: string | null;
}

const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

const titleOf = (question: string): string => {
  const t = question.replace(/\s+/g, ' ').trim();
  return t.length <= 80 ? t : `${t.slice(0, 79).trimEnd()}…`;
};

function parseClaims(json: string): ClaimResult[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as ClaimResult[]) : [];
  } catch {
    return [];
  }
}

export function createConversationStore(db: BetterSQLite3Database<typeof schema>) {
  const mine = (owner: string, id: string) =>
    and(eq(schema.conversation.id, id), eq(schema.conversation.owner, owner));

  return {
    /** Abre una conversación; si el dueño ya tiene el máximo, se descarta la más antigua. */
    async start(
      owner: string,
      workspaceId: string,
      firstQuestion: string,
    ): Promise<ConversationRow> {
      const existing = await db
        .select({ id: schema.conversation.id })
        .from(schema.conversation)
        .where(eq(schema.conversation.owner, owner))
        .orderBy(asc(schema.conversation.updatedAt));
      for (const old of existing.slice(
        0,
        Math.max(0, existing.length - MAX_CONVERSATIONS_PER_OWNER + 1),
      )) {
        await db.delete(schema.conversation).where(eq(schema.conversation.id, old.id));
      }
      const now = Date.now();
      const row: ConversationRow = {
        id: newId('conv'),
        workspaceId,
        title: titleOf(firstQuestion),
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(schema.conversation).values({ ...row, owner });
      return row;
    },

    /** La conversación y sus turnos, sólo si es de `owner` (y, si se pide, del workspace). */
    async get(
      owner: string,
      id: string,
      workspaceId?: string,
    ): Promise<{ conversation: ConversationRow; turns: StoredTurnRow[] } | null> {
      const [c] = await db.select().from(schema.conversation).where(mine(owner, id)).limit(1);
      if (!c || (workspaceId !== undefined && c.workspaceId !== workspaceId)) return null;
      const rows = await db
        .select()
        .from(schema.turn)
        .where(eq(schema.turn.conversationId, id))
        .orderBy(asc(schema.turn.seq));
      const turns = rows.map((r): StoredTurnRow => {
        const claimResults = parseClaims(r.claimsJson);
        return {
          id: r.id,
          seq: r.seq,
          question: r.question,
          answer: r.answer,
          status: r.status,
          claims: claimResults,
          claimResults,
          focus: r.focusJson ? (JSON.parse(r.focusJson) as unknown) : null,
          model: r.model,
          createdAt: r.createdAt,
        };
      });
      return {
        conversation: {
          id: c.id,
          workspaceId: c.workspaceId,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        },
        turns,
      };
    },

    async list(owner: string, workspaceId?: string): Promise<ConversationSummary[]> {
      const where =
        workspaceId === undefined
          ? eq(schema.conversation.owner, owner)
          : and(
              eq(schema.conversation.owner, owner),
              eq(schema.conversation.workspaceId, workspaceId),
            );
      const rows = await db
        .select({
          id: schema.conversation.id,
          workspaceId: schema.conversation.workspaceId,
          title: schema.conversation.title,
          createdAt: schema.conversation.createdAt,
          updatedAt: schema.conversation.updatedAt,
          // Subconsulta correlacionada con el nombre de la tabla en crudo: drizzle quita el
          // prefijo de la columna en un select de una sola tabla y compararía con turn.id.
          turns: sql<number>`(SELECT count(*) FROM turn WHERE turn.conversation_id = conversation.id)`,
        })
        .from(schema.conversation)
        .where(where)
        .orderBy(desc(schema.conversation.updatedAt));
      return rows.map((r) => ({ ...r, turns: Number(r.turns) }));
    },

    /** Añade un turno con el siguiente número; falla si la conversación ya está llena. */
    async append(conversationId: string, turn: NewTurn): Promise<number> {
      return db.transaction((tx) => {
        const [last] = tx
          .select({ seq: sql<number>`coalesce(max(${schema.turn.seq}), 0)` })
          .from(schema.turn)
          .where(eq(schema.turn.conversationId, conversationId))
          .all();
        const seq = Number(last?.seq ?? 0) + 1;
        if (seq > MAX_TURNS_PER_CONVERSATION) throw new ConversationFullError();
        const now = Date.now();
        tx.insert(schema.turn)
          .values({
            id: newId('turn'),
            conversationId,
            seq,
            question: turn.question,
            answer: turn.answer,
            status: turn.status,
            claimsJson: JSON.stringify(turn.claims),
            focusJson: turn.focus === null ? null : JSON.stringify(turn.focus),
            model: turn.model,
            createdAt: now,
          })
          .run();
        tx.update(schema.conversation)
          .set({ updatedAt: now })
          .where(eq(schema.conversation.id, conversationId))
          .run();
        return seq;
      });
    },

    /** Cuántos turnos lleva (para rechazar antes de gastar una consulta al modelo). */
    async turnCount(conversationId: string): Promise<number> {
      const [r] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.turn)
        .where(eq(schema.turn.conversationId, conversationId));
      return Number(r?.n ?? 0);
    },

    async remove(owner: string, id: string): Promise<boolean> {
      const [c] = await db.select().from(schema.conversation).where(mine(owner, id)).limit(1);
      if (!c) return false;
      await db.delete(schema.turn).where(eq(schema.turn.conversationId, id));
      await db.delete(schema.conversation).where(eq(schema.conversation.id, id));
      return true;
    },
  };
}

export type ConversationStore = ReturnType<typeof createConversationStore>;
