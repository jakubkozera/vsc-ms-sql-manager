# Project Guidelines — MS SQL Manager (VS Code Extension)

## Architecture

VS Code extension for managing Microsoft SQL Server databases. Three-layer architecture:

1. **Extension host** (`src/`) — TypeScript, bundled via **Webpack 5** (`ts-loader`), target Node/ES2022.
2. **React webviews** (`webview/sqlEditor-react/`, `webview/sqlNotebook/`) — React 18 + Vite, Monaco Editor, virtual scrolling via `@tanstack/react-virtual`.
3. **Vanilla webviews** (`webview/backupExport/`, `webview/backupImport/`, `webview/compareSchema/`, `webview/databaseDiagram/`, `webview/databaseFilter/`, `webview/serverGroup/`, `webview/sqlEditor/`, `webview/tableFilter/`) — plain HTML + JS, no bundler, copied as-is by webpack.

Extension ↔ webview communication uses `postMessage` / `onDidReceiveMessage` with typed message objects (see `webview/sqlEditor-react/src/types/messages.ts`).

### Key source files

| File | Role |
|------|------|
| `src/extension.ts` | Activation, provider registration, discovery orchestration |
| `src/dbClient.ts` | Dual SQL strategy: `mssql` (SQL auth) / `msnodesqlv8` (Windows auth via ODBC) |
| `src/connectionProvider.ts` | Connection pool management, server groups, discovery (local/Azure/Docker) |
| `src/unifiedTreeProvider.ts` | Tree view: servers → databases → tables/views/procs/functions |
| `src/commands/index.ts` | Central command registration — delegates to `register*Commands()` modules |
| `src/utils/schemaCache.ts` | Schema caching singleton |

### Command registration pattern

Each `src/commands/*Commands.ts` exports a `register*Commands(context, connectionProvider, ...)` function. All are wired in `src/commands/index.ts` via `registerAllCommands()`.

## Build & Test

| Task | Command |
|------|---------|
| **Compile** | `npm run compile` (builds sqlEditor-react first, then webpack) |
| **Compile extension only** | `npm run compile:ext` (webpack only, skips React rebuild) |
| **Watch** | `npm run watch` |
| **Lint** | `npm run lint` (ESLint on `src/`) |
| **Test** | `npm run test` (runs `compile-tests` + `compile` + `lint`, then `@vscode/test-cli`) |
| **Package** | `npm run package` (production webpack with minification) |
| **Build notebook** | `npm run build:notebook` |

React webview tests (Vitest + React Testing Library): run inside `webview/sqlEditor-react/`.

## Conventions

- **TypeScript strict mode** — `strict: true` in tsconfig.json. Do not weaken.
- **Module system** — `Node16` modules, `ES2022` target.
- **Naming** — `camelCase` for variables/functions, `PascalCase` for types/classes (enforced by `@typescript-eslint/naming-convention`).
- **SQL compatibility** — Avoid `STRING_AGG()` and other SQL Server 2017+ built-in functions. Use `STUFF(... FOR XML PATH(''))` pattern instead for compatibility with SQL Server 2008+. See `/memories/repo/STRING_AGG_usage.md` for details.
- **Webview development** — New webviews should follow the React + Vite pattern (`sqlEditor-react`). Existing vanilla webviews are maintained as-is.
- **Testing** — Extension tests use `@vscode/test-cli` + Sinon + JSDOM. React webview tests use Vitest + Testing Library. Always use `sinon.createSandbox()` for test isolation.
- **Connection pooling** — Never create raw `mssql.ConnectionPool` directly. Use `dbClient.createPool()` which handles driver selection and ODBC fallback.
- **Webpack externals** — `vscode` and `msnodesqlv8` are external (not bundled). Native binaries are handled separately.