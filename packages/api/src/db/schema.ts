import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  lainUrl: text('lain_url'),
  createdAt: integer('created_at').notNull(),
});

export const repo = sqliteTable(
  'repo',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    uri: text('uri').notNull(),
    sha: text('sha'),
    local: text('local'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    workspaceIdx: index('idx_repo_workspace').on(t.workspaceId),
    uriIdx: uniqueIndex('idx_repo_uri').on(t.workspaceId, t.uri),
  }),
);

export const assessment = sqliteTable(
  'assessment',
  {
    id: text('id').primaryKey(),
    inputDigest: text('input_digest').notNull(),
    status: text('status').notNull(),
    baseId: text('base_id'),
    headId: text('head_id'),
    manifestJson: text('manifest_json').notNull(),
    engineJson: text('engine_json'),
    coverageJson: text('coverage_json'),
    orgId: text('org_id')
      .notNull()
      .references(() => workspace.id),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => ({
    digestIdx: uniqueIndex('idx_assessment_digest').on(t.inputDigest),
    statusIdx: index('idx_assessment_status').on(t.status),
    orgIdx: index('idx_assessment_org').on(t.orgId),
  }),
);

export const explanation = sqliteTable('explanation', {
  id: text('id').primaryKey(),
  assessmentId: text('assessment_id')
    .notNull()
    .references(() => assessment.id),
  revision: integer('revision').notNull(),
  model: text('model').notNull(),
  status: text('status').notNull(),
  payload: text('payload'),
  createdAt: integer('created_at').notNull(),
});

export const evidence = sqliteTable(
  'evidence',
  {
    id: text('id').primaryKey(),
    assessmentId: text('assessment_id')
      .notNull()
      .references(() => assessment.id),
    viewId: text('view_id').notNull(),
    repo: text('repo').notNull(),
    sha: text('sha').notNull(),
    path: text('path').notNull(),
    rangeJson: text('range_json'),
    hash: text('hash').notNull(),
  },
  (t) => ({
    assessmentIdx: index('idx_evidence_assessment').on(t.assessmentId),
  }),
);

export const jobStep = sqliteTable('job_step', {
  assessmentId: text('assessment_id')
    .notNull()
    .references(() => assessment.id),
  step: text('step').notNull(),
  attempt: integer('attempt').notNull(),
  state: text('state').notNull(),
  artifactHash: text('artifact_hash'),
  updatedAt: integer('updated_at').notNull(),
});

export const event = sqliteTable('event', {
  assessmentId: text('assessment_id')
    .notNull()
    .references(() => assessment.id),
  seq: integer('seq').notNull(),
  type: text('type').notNull(),
  payload: text('payload'),
  createdAt: integer('created_at').notNull(),
});

export const publication = sqliteTable('publication', {
  assessmentId: text('assessment_id')
    .notNull()
    .references(() => assessment.id),
  target: text('target').notNull(),
  state: text('state').notNull(),
  marker: text('marker').notNull(),
  remoteId: text('remote_id'),
  updatedAt: integer('updated_at').notNull(),
});
