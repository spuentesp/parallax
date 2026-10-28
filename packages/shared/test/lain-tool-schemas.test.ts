// Pruebas de contrato contra la versión fijada del motor: cada schema zod de
// argumentos debe aceptar lo que docs/lain-tool-schemas.json (capturado con
// tools/list de lain 0.9.1) documenta y rechazar los requeridos ausentes. Si
// el archivo y los zod divergen, estos tests fallan.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import docsJson from '../../../docs/lain-tool-schemas.json';
import {
  CheckBindingArgs,
  DiffContractsArgs,
  GetContractArgs,
  GetCoverageArgs,
  GetServiceArgs,
  GetSnapshotArgs,
  ListContractsArgs,
  ListServicesArgs,
  ListUnresolvedArgs,
  PrepareSnapshotArgs,
  ReadSourceArgs,
  ResolveEvidenceArgs,
  TraceImpactArgs,
} from '../src/lain/tools.js';

interface JsonSchemaNode {
  type?: string;
  enum?: string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  minimum?: number;
  maximum?: number;
}

interface ToolDoc {
  description?: string;
  inputSchema: JsonSchemaNode;
}

const docs = docsJson as unknown as Record<string, ToolDoc>;

const argsSchemas: Record<string, z.ZodType> = {
  list_services: ListServicesArgs,
  get_service: GetServiceArgs,
  prepare_snapshot: PrepareSnapshotArgs,
  get_snapshot: GetSnapshotArgs,
  list_contracts: ListContractsArgs,
  get_contract: GetContractArgs,
  list_unresolved: ListUnresolvedArgs,
  check_binding: CheckBindingArgs,
  diff_contracts: DiffContractsArgs,
  trace_impact: TraceImpactArgs,
  get_coverage: GetCoverageArgs,
  resolve_evidence: ResolveEvidenceArgs,
  read_source: ReadSourceArgs,
};

// configHash sí es parte del contrato de prepare_snapshot (idempotencia) aunque
// el tools/list capturado no lo enumera: prepare_snapshot no declara
// additionalProperties:false y el motor lo acepta.
const allowedExtras: Record<string, readonly string[]> = {
  prepare_snapshot: ['configHash'],
};

function docFor(tool: string): ToolDoc {
  const doc = docs[tool];
  if (!doc) throw new Error(`missing docs entry for tool: ${tool}`);
  return doc;
}

function schemaFor(tool: string): z.ZodType {
  const schema = argsSchemas[tool];
  if (!schema) throw new Error(`missing zod args schema for tool: ${tool}`);
  return schema;
}

// Valor de muestra conforme al JSON Schema documentado; los nombres con regex
// propio del motor (snapshot/base/head/from) reciben valores que lo cumplen.
function sampleValue(propName: string, schema: JsonSchemaNode): unknown {
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'object') return sampleObject(schema);
  if (schema.type === 'array') return schema.items ? [sampleValue(propName, schema.items)] : [];
  if (schema.type === 'integer') return schema.minimum ?? 1;
  if (schema.type === 'number') return schema.minimum ?? 0;
  if (propName === 'snapshot') return 'live';
  if (propName === 'base' || propName === 'head' || propName === 'from') {
    return 'snap_0123456789abcdef';
  }
  return `${propName}-sample`;
}

function sampleObject(schema: JsonSchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, sub] of Object.entries(schema.properties ?? {})) {
    out[name] = sampleValue(name, sub);
  }
  return out;
}

function buildSample(tool: string, mode: 'required' | 'all'): Record<string, unknown> {
  const inputSchema = docFor(tool).inputSchema;
  const required = new Set(inputSchema.required ?? []);
  const out: Record<string, unknown> = {};
  for (const [name, sub] of Object.entries(inputSchema.properties ?? {})) {
    if (mode === 'required' && !required.has(name)) continue;
    out[name] = sampleValue(name, sub);
  }
  return out;
}

function zodArgNames(tool: string): string[] {
  const schema = schemaFor(tool) as unknown as { shape: Record<string, unknown> };
  return Object.keys(schema.shape).sort();
}

describe('lain tool args contracts (docs/lain-tool-schemas.json)', () => {
  it('has a zod args schema for exactly the 13 documented tools', () => {
    expect(Object.keys(argsSchemas).sort()).toEqual(Object.keys(docs).sort());
    expect(Object.keys(docs)).toHaveLength(13);
  });

  it('arg names match the documented properties (plus declared product extras)', () => {
    for (const tool of Object.keys(docs)) {
      const documented = Object.keys(docFor(tool).inputSchema.properties ?? {});
      const expected = [...new Set([...documented, ...(allowedExtras[tool] ?? [])])].sort();
      expect(zodArgNames(tool), `${tool}: zod args drifted from docs`).toEqual(expected);
    }
  });

  it('accepts the full set of documented arguments', () => {
    for (const tool of Object.keys(docs)) {
      const sample = buildSample(tool, 'all');
      expect(
        () => schemaFor(tool).parse(sample),
        `${tool} rejected documented args: ${JSON.stringify(sample)}`,
      ).not.toThrow();
    }
  });

  it('accepts the documented required arguments', () => {
    for (const tool of Object.keys(docs)) {
      const sample = buildSample(tool, 'required');
      expect(
        () => schemaFor(tool).parse(sample),
        `${tool} rejected required args: ${JSON.stringify(sample)}`,
      ).not.toThrow();
    }
  });

  it('rejects input when a documented required argument is missing', () => {
    for (const tool of Object.keys(docs)) {
      const required = docFor(tool).inputSchema.required ?? [];
      if (required.length === 0) {
        expect(() => schemaFor(tool).parse({}), `${tool} has no required args`).not.toThrow();
        continue;
      }
      for (const prop of required) {
        const sample = buildSample(tool, 'required');
        delete sample[prop];
        expect(
          () => schemaFor(tool).parse(sample),
          `${tool} accepted input without required "${prop}"`,
        ).toThrow();
      }
    }
  });
});
