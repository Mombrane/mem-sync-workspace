# REQ-015 Design

## Architecture

### Golden Corpus Structure

```
tests/fixtures/
├── recall-golden.jsonl          # ~20 records covering 6 scenarios
└── recall-golden-manifest.json  # query → expected results mapping
```

### Test File
```
tests/recall-regression.test.js  # ~15 test cases loading golden corpus
```

## Data Flow

1. Test setup: Copy `recall-golden.jsonl` to temp MEM_SYNC_HOME as `memories.jsonl`
2. Rebuild index via CLI: `node src/cli.js index rebuild`
3. For each query: `node src/cli.js recall "<query>" --format json`
4. Parse JSON output, extract IDs, assert against manifest expectations

## Golden Corpus Design (20 records)

### Scenario 1: New vs Old (2 records)
- `mem_newer`: updatedAt=2026-06-01, content="项目使用 pnpm 作为默认包管理器"
- `mem_older`: updatedAt=2026-01-15, content="项目使用 npm 作为默认包管理器"
- Query: "默认包管理器" → expectedTopK: [mem_newer]

### Scenario 2: Veracity Conflict (4 records)
- `mem_stated`: veracity=stated, content="PostgreSQL 是生产数据库"
- `mem_tool`: veracity=tool, content="PostgreSQL 是生产数据库"
- `mem_inferred`: veracity=inferred, content="PostgreSQL 是生产数据库"
- `mem_unknown`: veracity=unknown, content="PostgreSQL 是生产数据库"
- Query: "生产数据库" → expectedOrder: [mem_stated, mem_tool, mem_inferred, mem_unknown]

### Scenario 3: Cross-Project (3 records)
- `mem_proj_a`: projectId=alpha, content="部署命令是 npm run deploy"
- `mem_proj_b`: projectId=beta, content="部署命令是 make deploy"
- `mem_global`: projectId=null, content="部署命令是 npm run deploy"
- Query: "部署命令" → expectedContains: all 3
- Query with --project-id alpha → expectedTopK: [mem_proj_a]

### Scenario 4: Similar Text (3 records)
- `mem_react`: content="选择 React 18 作为前端框架"
- `mem_vue`: content="选择 Vue 3 作为前端框架"
- `mem_angular`: content="Angular 不适合小型项目"
- Query: "前端框架" → expectedContains: all 3

### Scenario 5: Team vs Personal (3 records)
- `mem_personal`: scope=personal, content="个人偏好 2 空格缩进"
- `mem_project`: scope=project, content="项目 eslint 配置 tab 缩进"
- `mem_team`: scope=team, content="团队约定使用 4 空格缩进"
- Query: "缩进风格" → expectedOrder: [mem_personal, mem_project, mem_team]

### Scenario 6: Deleted/Expired/Superseded (4 records)
- `mem_active`: content="CI 必须在 PR 通过后才合并"
- `mem_deleted`: deletedAt=2026-01-01, content="CI 可以在 PR 通过前合并"
- `mem_expired`: validUntil=2023-01-01, content="旧 CI 规则已过期"
- `mem_superseded`: supersedes=[mem_active], content="被替代的 CI 规则"
- Query: "CI 合并规则" → expectedTopK: [mem_active], expectedNotContains: [mem_deleted, mem_expired]

### Scenario 7: Chain Supersedes (3 records)
- `mem_c`: content="部署使用 Docker Compose"
- `mem_b`: supersedes=[mem_c], content="部署迁移到 Kubernetes"
- `mem_a`: supersedes=[mem_b], content="部署最终使用 Helm Charts"
- Query: "部署方式" → expectedTopK: [mem_a]

## Assertion Types

| Type | Semantics | Use Case |
|------|-----------|----------|
| expectedTopK | First K results must exactly match [ids] | Strict regression |
| expectedOrder | Relative ordering [A,B,C] means A before B before C | Flexible ranking |
| expectedContains | Results must include [ids] | Recall completeness |
| expectedNotContains | Results must not include [ids] | Exclusion correctness |
| expectedCount | Result count must equal N | Filter regression |

## Existing Patterns
- Tests use `spawnSync` with `MEM_SYNC_HOME` env var for isolation
- `makeRecord()` helper in recall-quality.test.js creates v1 records
- `rebuildIndex` called via `node src/cli.js index rebuild`
- Recall via `node src/cli.js recall "<query>" --format json`
