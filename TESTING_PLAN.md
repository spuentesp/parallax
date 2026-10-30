# Parallax Lain 0.13.0 Integration Testing Plan

## Testing Status
**Implementation:** ✅ Complete
**Unit Testing:** ❌ Not Started
**Integration Testing:** ❌ Not Started
**End-to-End Testing:** ❌ Not Started

## Test Strategy

### 1. Unit Tests
**Objective:** Verify individual components work correctly in isolation

| Component | Test File | Test Cases |
|-----------|-----------|------------|
| trace_flow tool | `packages/mcp/src/tools/trace_flow.test.ts` | 15 |
| Contract tools | `packages/gates/src/tools/contract.test.ts` | 12 |
| RPC sensors | `packages/mcp/src/sensors/grpc.test.ts`, `rust.test.ts` | 18 |
| Next.js parser | `packages/mcp/src/parsers/nextjs.test.ts` | 10 |
| Performance controls | `packages/mcp/src/config.test.ts` | 8 |

### 2. Integration Tests
**Objective:** Verify components work together correctly

| Integration | Test File | Test Cases |
|-------------|-----------|------------|
| Cross-boundary tracing | `packages/api/src/trace/tracer.integration.test.ts` | 8 |
| Contract remediation | `packages/api/src/routes/contract.integration.test.ts` | 6 |
| RPC identity resolution | `packages/mcp/src/tools/service_refs.integration.test.ts` | 7 |
| HTTP stack analysis | `packages/mcp/src/sensors/http.integration.test.ts` | 5 |

### 3. End-to-End Tests
**Objective:** Verify complete workflows from UI to backend

| Workflow | Test Scenario | Test File |
|----------|---------------|-----------|
| Cross-boundary tracing | UI → API → DB → RPC → DB flow | `e2e/trace_flow.e2e.test.ts` |
| Contract remediation | Dry-run → Apply → Rollback cycle | `e2e/contract_remediation.e2e.test.ts` |
| RPC identity resolution | Cross-repo service mapping | `e2e/rpc_identity.e2e.test.ts` |
| Next.js analysis | Mixed Next.js/Express app | `e2e/http_stack.e2e.test.ts` |
| Performance controls | LSP disable/enable cycle | `e2e/performance.e2e.test.ts` |

### 4. Performance Tests
**Objective:** Verify system performance under load

| Test | Metric | Target |
|------|--------|--------|
| Trace flow performance | Traces/second | 10+ traces/minute |
| Memory usage | RSS with LSP lean mode | <800MB |
| Indexing timeout | Per-repo indexing | Configurable timeout |
| Concurrent operations | Max concurrent traces | 5+ |

## Test Data Requirements

1. **Test Repositories:**
   - Simple monorepo with 3 services
   - Complex polyrepo with 8+ services
   - Mixed Next.js/Express application
   - gRPC and Rust RPC services

2. **Test Scenarios:**
   - Complete cross-boundary flows (UI → API → DB → RPC)
   - Contract with multiple consumers
   - Ambiguous RPC identities
   - Mixed HTTP stack (Next.js + Express)

## Test Environment

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | 20.x | LTS version |
| TypeScript | 5.4+ | Project requirement |
| Lain | 0.13.0 | Target version |
| Next.js | 14.x | App Router support |
| React | 18.x | UI components |

## Test Schedule

| Phase | Duration | Start Date | End Date |
|-------|----------|------------|----------|
| Unit Testing | 3 days | 2026-10-30 | 2026-11-01 |
| Integration Testing | 2 days | 2026-11-02 | 2026-11-03 |
| End-to-End Testing | 3 days | 2026-11-04 | 2026-11-06 |
| Performance Testing | 2 days | 2026-11-07 | 2026-11-08 |
| Bug Fixes | 2 days | 2026-11-09 | 2026-11-10 |

## Entry Criteria
- ✅ All code implemented
- ✅ Test repositories created
- ✅ Test environment configured
- ✅ CI pipeline updated

## Exit Criteria
- ✅ 100% unit test coverage for new components
- ✅ All integration tests passing
- ✅ All end-to-end tests passing
- ✅ Performance targets met
- ✅ No critical bugs outstanding
- ✅ Documentation updated

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Test environment issues | Pre-configured Docker containers |
| Complex trace failures | Simplified test cases first |
| RPC identity mismatches | Mock services for testing |
| Performance regressions | Baseline measurements before testing |

## Next Steps
1. Create test repositories with required scenarios
2. Implement unit test suite
3. Set up test environment
4. Begin integration testing
5. Execute end-to-end tests