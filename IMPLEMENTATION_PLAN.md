# Parallax Lain 0.13.0 Integration Plan

## Overview
This plan outlines the implementation of Lain 0.13.0's enhanced capabilities in Parallax, focusing on:
1. Agent stack contract detection
2. Live RPC identity resolution
3. Cross-boundary tracing
4. Interactive remediations
5. Operator performance controls

## 1. Cross-Boundary Tracing Implementation
### Context
Replace manual call chain stitching with `trace_flow` for complete visibility from UI to DB.

### Approach
- Integrate `trace_flow` tool into the MCP toolchain
- Replace existing `get_call_chain` + `trace_impact` implementations
- Implement BFS/DFS selection based on use case
- Add gap detection visualization

### Key Changes
- `packages/gates/src/tools/trace.ts`: Replace manual chain stitching with `trace_flow` calls
- `packages/web/src/components/TraceVisualizer.tsx`: Add gap visualization
- `packages/api/src/routes/trace.ts`: Update API endpoints

### Verification
- Test with complex flows (UI → API → DB → RPC → DB)
- Verify gap detection accuracy
- Performance test with large codebases

## 2. Interactive Contract Remediation
### Context
Enable runtime contract updates with dry-run validation.

### Approach
- Implement `apply_contract_context` tool wrapper
- Add dry-run preview UI
- Create atomic write/rollback mechanism
- Integrate with existing contract validation

### Key Changes
- `packages/gates/src/tools/contract.ts`: Add `apply_contract_context` implementation
- `packages/web/src/components/ContractEditor.tsx`: Add dry-run preview
- `packages/api/src/routes/contract.ts`: Add new endpoints
- `deploy/gen-tokens.mjs`: Update token generation for new tool

### Verification
- Test contract application with rollback scenarios
- Verify dry-run accuracy
- Test concurrent contract updates

## 3. Live RPC Identity Resolution
### Context
Implement OpenShell gRPC and Rust RPC identity detection.

### Approach
- Integrate Python gRPC sensor for OpenShell
- Add Rust/Tonic identity resolution
- Implement semantic route matching
- Update service reference listing

### Key Changes
- `packages/mcp/src/sensors/grpc.ts`: Add OpenShell gRPC sensor
- `packages/mcp/src/sensors/rust.ts`: Add Rust/Tonic identity resolution
- `packages/mcp/src/tools/service_refs.ts`: Update service reference listing
- `packages/shared/src/types/rpc.ts`: Add new RPC identity types

### Verification
- Test with OpenShell SDK → Gateway flows
- Verify Rust tonic client resolution
- Test semantic route matching accuracy

## 4. Next.js HTTP Stack Analysis
### Context
Enhance agent-toolkit HTTP sensor for Next.js applications.

### Approach
- Add Pages API support
- Implement App Router route detection
- Filter non-route methods
- Integrate with existing Fastify/Express support

### Key Changes
- `packages/mcp/src/sensors/http.ts`: Add Next.js support
- `packages/mcp/src/parsers/nextjs.ts`: Add Next.js route parser
- `packages/shared/src/types/http.ts`: Update HTTP sensor types

### Verification
- Test with mixed Next.js/Express applications
- Verify route detection accuracy
- Test with complex middleware chains

## 5. Operator Performance Controls
### Context
Implement performance switches for resource-constrained environments.

### Approach
- Add LSP disable/enable controls
- Implement memory-saving LSP profile
- Add per-repo indexing timeout
- Update configuration management

### Key Changes
- `packages/mcp/src/config.ts`: Add performance control flags
- `packages/api/src/routes/config.ts`: Add config endpoints
- `deploy/.env.demo.example`: Add new environment variables
- `docs/lain-tooling-inventory.md`: Document new controls

### Verification
- Test LSP disabled mode
- Verify memory savings with LSP lean mode
- Test per-repo timeout behavior

## Implementation Roadmap
| Phase | Task | Effort | Owner | Status |
|-------|------|--------|-------|--------|
| 1 | Cross-Boundary Tracing | 3 days | | |
| 2 | Interactive Contracts | 4 days | | |
| 3 | RPC Identity Resolution | 3 days | | |
| 4 | Next.js HTTP Analysis | 2 days | | |
| 5 | Performance Controls | 1 day | | |
| 6 | Integration Testing | 3 days | | |
| 7 | Documentation | 2 days | | |

## Handoff Plan
1. **Development Phase** (13 days)
   - Assign owners to each phase
   - Daily standups for blocking issues
   - PR reviews within 4 hours

2. **Testing Phase** (3 days)
   - Integration test suite
   - Performance benchmarking
   - User acceptance testing

3. **Deployment Phase** (2 days)
   - Staged rollout
   - Monitoring setup
   - Rollback plan

4. **Documentation Phase** (2 days)
   - Update internal docs
   - Create user guides
   - Update API references

## Risks and Mitigations
| Risk | Mitigation |
|------|------------|
| Tool integration failures | Early prototype testing |
| Performance regressions | Benchmarking before/after |
| RPC identity mismatches | Comprehensive test cases |
| Contract application conflicts | Atomic write/rollback |

## Verification Checklist
- [ ] All new tools respond correctly
- [ ] Cross-boundary traces complete without gaps
- [ ] Contract updates apply atomically
- [ ] RPC identities resolve accurately
- [ ] Next.js routes detected correctly
- [ ] Performance controls work as expected
- [ ] Documentation is complete and accurate