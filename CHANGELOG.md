# Changelog

All notable changes to the MS SQL Manager extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.19.3] - 2026-03-26

### Fixed

- **Stored Procedures — Actionable error when definition cannot be retrieved**
  - "Modify" and all "Script as CREATE/ALTER" actions now distinguish between two failure modes instead of showing a generic error:
    - If the procedure was created `WITH ENCRYPTION`, the message reads: *"Procedure [schema].[name] is encrypted — its definition cannot be retrieved."*
    - If the definition is `NULL` for any other reason (e.g. insufficient permissions), the message reads: *"Could not retrieve definition for [schema].[name]. Ensure the current user has VIEW DEFINITION permission."*
  - The `OBJECT_DEFINITION` query now also fetches `OBJECTPROPERTY(..., 'IsEncrypted')` in the same round-trip to determine the cause without an extra query.

## [0.19.2] - 2026-03-26

### Added

- **Database Explorer — System-versioned (temporal) table support**
  - System-versioned tables now display a distinct sparkle icon (✦) in the database explorer to visually differentiate them from regular tables.
  - The table description now includes a `(system-versioned)` label after the row count and size (e.g. `51 Rows < 1 MB (system-versioned)`).
  - History tables (`temporal_type = 1`) are hidden from the main Tables list — they only appear as a child node when expanding their associated system-versioned table.
  - Expanding a system-versioned table shows a **History** child node (clock icon) pointing to the linked history table with full exploration support: Columns, Indexes, Statistics.
  - Scripting commands (Select Top 1000, Script Table Create, etc.) work on both system-versioned tables and their history child nodes without SQL name escaping issues.
  - Compatible with SQL Server 2008–2014 via automatic fallback query when `temporal_type` column is absent.

## [0.19.1] - 2026-03-23

### Fixed

- **Result Grid — Focus stolen by Monaco editor after query execution**
  - Clicking a row or cell in the result grid now explicitly transfers keyboard focus to the grid container, pulling it away from the Monaco SQL editor.
  - Previously, after executing a query, Monaco retained focus even when the user clicked cells in the result set. This caused `Ctrl+C` to copy the SQL text instead of the selected grid cells, and `Ctrl+A` to select SQL text rather than all grid rows.
  - Root cause: `handleCellMouseDown` calls `e.preventDefault()` to suppress browser text-selection during drag operations. This has a side-effect of preventing the browser from naturally moving DOM focus to the clicked element. The fix explicitly calls `gridContainerRef.current?.focus({ preventScroll: true })` inside both `handleCellMouseDown` and `handleRowClick`.


## [0.19.0] - 2026-03-20

### Changed

- **Result Grid — Restructured export/copy menu with submenus**
  - The row-number column header menu now shows three top-level entries: **Auto-fit all columns**, **Copy →**, and **Export →**.
  - **Copy →** submenu appears on hover and contains: Copy to clipboard, Copy as Table, Copy as JSON, Copy as CSV, Copy as TSV, Copy as SQL INSERT, Copy as Markdown, Copy as XML, Copy as HTML. All copy options write directly to the clipboard.
  - **Export →** submenu appears on hover and contains: Export to JSON, Export to CSV, Export to Excel (TSV), Export to SQL INSERT, Export to Markdown, Export to XML, Export to HTML. All export options open a Save As dialog.

- **Result Grid — "Copy as Table" now copies a rich HTML table to clipboard**
  - Uses the `ClipboardItem` API to write two formats simultaneously: `text/html` (a proper `<table>` element) and `text/plain` (markdown table as fallback).
  - Applications that read `text/html` from the clipboard — Teams, Outlook, Word, Confluence, Google Docs, Slack, Discord — will paste a native rendered table instead of ASCII art or raw text.
  - Falls back to plain-text markdown on browsers/environments that do not support `ClipboardItem`.

- **Result Grid — Column filter popup visual style updated**
  - Filter popup now uses `--vscode-menu-*` CSS variables (same as the cell right-click context menu) instead of `--vscode-dropdown-*`. This makes it visually consistent with the rest of the quick-action popups in the result grid.

### Tests

- Added **25** unit tests for `ExportMenu` (submenus, hover, copy/export dispatches, close handlers).
- Added **7** unit tests for `toTableHtml`: `<thead>`/`<tbody>` structure, header cells, data cells, HTML special-character escaping, null/undefined handling, `&` escaping.
- Added **1** unit test for `copyRichTableToClipboard`: verifies `navigator.clipboard.write` is called with a `ClipboardItem` containing both `text/html` and `text/plain` blobs.
- Added **4** unit tests for the ASCII table format in `exportService`.

## [0.18.0] - 2026-03-20

### Added

- **Interactive Chart Canvas — visualize query results as charts**
  - New **Charts** tab in the Results panel groups all chart widgets on a shared freeform canvas.
  - **Chart configuration dialog**: pick chart type (Bar, Line, Pie, Doughnut, Scatter, Radar), set a title, choose a label column and one or more data columns.
  - Charts can be created directly from the result grid context menu ("Create Chart…").
  - Canvas supports **drag-and-drop** repositioning and **resize handles** (E, S, SE corners) for every widget.
  - **Panning**: drag the canvas background (or use middle-mouse button) to move the viewport.
  - **Zoom controls**: zoom-in / zoom-out / reset buttons in the overlay toolbar plus `Ctrl+Scroll` shortcut.
  - **Text widgets**: add free-form text annotations to the canvas alongside charts.
  - **Widget title editing**: double-click a widget header to rename it inline.
  - **Bring to front**: right-click a widget to raise it above overlapping widgets.
  - **Export**:
    - _HTML_ — self-contained standalone file with embedded Chart.js (no internet required).
    - _SVG_ — vector export of each chart via `canvas.toDataURL`.
    - _PNG_ — raster export of each chart.
  - Full unit-test coverage: `ChartCard`, `ChartConfigDialog`, `ChartPanel`, `ChartPanelNew`, `chartExportService`, `useCanvasWidgets`.

- **Settings — DML Protection tab**
  - The Settings webview now has a dedicated **DML Protection** tab exposing all three protection settings (`warnOnMissingWhere`, `limitAffectedRows`, `maxAffectedRows`) with descriptions.

### Enhanced

- **SQL Validator — improved type inference for SQL functions**
  - `MIN`, `MAX`, `SUM`, `AVG`, `ISNULL`, and `COALESCE` expressions now resolve to the underlying column type of their argument (including aliases), providing accurate column-type metadata for chart axis suggestions and cell validation.
  - `DISTINCT` keyword inside aggregate functions is handled transparently.

- **Query Executor — driver-reported column type fallback**
  - Computed columns (`COUNT(*)`, `MAX(col)`, `SUM(col)`, etc.) that cannot be resolved by schema introspection now fall back to the type declaration reported directly by the SQL driver, improving type accuracy for chart data column selection.

- **SQL Chat Handler — stable conversation IDs**
  - Conversation ID generation now uses a deterministic hash across the session lifetime, preventing ID drift that could break multi-turn SQL chat continuity.

## [0.17.0] - 2026-03-18

### Added

- **DML Protection — Warn on missing WHERE clause**
  - New setting `mssqlManager.dmlProtection.warnOnMissingWhere` (default: `true`).
  - Before executing a batch that contains `UPDATE` or `DELETE` without a `WHERE` clause, a modal confirmation dialog is shown asking the user to confirm execution.

- **DML Protection — Affected-row limit check**
  - New setting `mssqlManager.dmlProtection.limitAffectedRows` (default: `true`).
  - New setting `mssqlManager.dmlProtection.maxAffectedRows` (default: `100`).
  - Before executing `UPDATE` or `DELETE`, the statement is run inside a rolled-back transaction to count affected rows. If the count exceeds `maxAffectedRows`, a confirmation dialog is shown with the exact number.
  - The dry-run transaction is always rolled back and is **not** recorded in query history.

## [0.16.7] - 2026-03-17

### Added

- **Result Grid — Free-range cell selection (Excel-style)**
  - Cells can now be selected by clicking and dragging across any rectangular region, just like Excel.
  - The selection anchor is set on `mousedown`; every subsequent `mouseenter` while the button is held live-extends the selection rectangle without changing the anchor.
  - Releasing the mouse button anywhere (inside or outside the grid) ends the drag.
  - Shift+click on a cell extends the existing selection rectangle from the current anchor to the clicked cell.
  - Ctrl+click on a cell adds or removes individual cells from the selection (non-contiguous multi-select).

### Fixed

- **Result Grid — Browser text-selection highlight during Shift+click / drag**
  - Holding Shift and clicking, or dragging across cells, previously caused the browser to render the native blue text-selection highlight over cell content.
  - `user-select: none` is now always applied to the grid container (instead of only during mouse drag), completely suppressing OS text selection while keeping cell highlight styles intact.

- **Result Grid — "Copy Row" renamed to "Copy Selection"**
  - The context-menu entry that copies the active selection was labelled _Copy Row_, which was misleading when multiple rows or a multi-cell range were selected.
  - It is now labelled **Copy Selection** everywhere it appears (row right-click, cell right-click, and the `buildCellMenuItems` helper).


## [0.16.6] - 2026-03-17

### Fixed

- **SQL Editor React — Mixed-bracket object notation no longer produces false validation errors**
  - Queries using a mix of bracketed and unbracketed schema/table identifiers (e.g. `dbo.[Table]` or `[dbo].Table`) were incorrectly flagged as *"Invalid object name 'db'"* due to a regex backtracking bug.
  - Root cause: the bare-identifier pattern `([a-zA-Z_][a-zA-Z0-9_]*)(?!\s*\.)` could backtrack and match a truncated prefix of the schema name (e.g. `db` from `dbo`) because the negative lookahead passed for the shorter match.
  - Fixed by adding a word-boundary assertion `\b` after the captured identifier token, preventing partial-word matches.
  - Added two new regex patterns to explicitly handle the mixed-bracket forms `schema.[Table]` and `[schema].Table`, so these references are correctly parsed and validated instead of falling through to the bare-identifier pattern.
  - Fix applied to both `findTableReferences` (validation markers) and `extractTableAliasMap` (column validation alias resolution).

### Tests

- Added **7** unit tests covering mixed-bracket notation and the regression:
  - `findTableReferences` — `schema.[Table]`, `[schema].Table`, backtracking regression guard, multi-JOIN mixed-bracket query.
  - `validateSql` — no markers for `dbo.[Table]`, `[dbo].Table`, and a multi-JOIN query that previously produced a spurious `'db'` error.

## [0.16.5] - 2026-03-17

### Fixed

- **SQL variable highlighting — false positives inside string literals**
  - The `@variable` highlighting regex was incorrectly matching `@`-signs inside single-quoted SQL string literals (e.g. `'some@domain.net'`), causing tokens like `@domain` to be highlighted as if they were SQL variables.
  - Added a `getSqlStringRanges` helper that pre-scans the query text for all single-quoted string ranges (including `N'...'` Unicode literals and `''` escaped quotes) before applying decorations. Any `@` match whose position falls inside a quoted string is now skipped.


## [0.16.4] - 2026-03-13

### Changed

- **SQL Editor React — Custom CSS validation tooltips**
  - Replaced native browser `title` attribute with styled CSS tooltip that appears centered above the cell on hover, with a downward-pointing arrow, error border, and smooth opacity transition.

- **SQL Editor React — Validation errors in Pending Changes tab**
  - Per-row and per-cell commit buttons are disabled when their corresponding cells have validation errors.
  - Validation error messages are shown inline in both single-change and expanded multi-change views with a ⚠ icon.
  - "Commit All" button tooltip changes to indicate errors must be fixed first.

### Tests

- Added **8** unit tests for PendingChangesTab validation error display, button disabling, and error message rendering.
- Updated GridCell and InlineEditing tests for custom tooltip span (replacing `title` attribute checks).

## [0.16.3] - 2026-03-13

### Added

- **SQL Editor React — Data-type validation on cell edit**
  - When a cell value is edited and committed (blur / Enter / Tab), the new value is validated against the column’s SQL Server data type (`int`, `bigint`, `smallint`, `tinyint`, `decimal`, `numeric`, `float`, `real`, `money`, `smallmoney`, `bit`, `date`, `datetime`, `datetime2`, `datetimeoffset`, `time`, `uniqueidentifier`).
  - `NULL` values are always accepted; empty strings are treated as `NULL`.
  - If the value is invalid the cell’s outline and corner triangle turn **red** (uses `--vscode-inputValidation-errorBorder`) and the error description is shown as a native tooltip on hover.
  - **Commit All** and per-cell commit buttons are disabled while any validation error exists.
  - Validation logic is extracted into a standalone utility (`utils/cellValidation.ts`) to keep `GridCell.tsx` minimal.

### Changed

- **SQL Editor React — JSON/XML cell colors are now theme-aware by default**
  - Removed the previous fallback (`--vscode-textPreformat-foreground`).
  - Default color is now `#ce9178` (dark theme) / `#a31515` (light theme) when no custom color is configured.

- **SQL Editor React — Modified-cell triangle indicator enlarged**
  - Corner triangle increased from 7×7 px to 10×10 px for better visibility.

### Tests

- Added **37** unit tests for `validateCellValue` covering all SQL types, boundary values, empty-string-as-NULL passthrough, and invalid-format rejection.
- Added **5** unit tests for GridCell validation-error state:
  - `validation-error` class presence/absence depending on `isModified` and `validationError`.
  - Tooltip shows error message on hover.
  - Long-text title still displayed when no validation error.

## [0.16.2] - 2026-03-13

### Fixed

- **SQL Editor React — Modified cell indicator: triangle corner instead of dot**
  - Cells with pending changes no longer have their background color altered.
  - The previous dot (`●`) in the top-right corner is replaced by a small triangle clipped to the top-right corner of the cell (CSS `::after` pseudo-element, same amber color).
  - An amber outline border is drawn around the entire modified cell for additional visibility.

- **SQL Editor React — JSON objects now display correctly in view mode**
  - When a query result column contains a JSON object that has been pre-parsed by the `mssql` driver (i.e. the value arrives as a JavaScript object rather than a string), the cell previously rendered `[object Object]`.
  - The display value is now produced via `JSON.stringify()`, the cell receives the `json` CSS class, and the _Open in editor_ button is shown — matching the behaviour already in place for JSON string values and JSON arrays.


## [0.16.1] - 2026-03-13

### Added

- **SQL Editor React — quick open for JSON/XML cell values in Result Grid**
  - JSON and XML values in result cells now show a hover action icon in the top-right corner of the cell.
  - Clicking the icon opens the full cell content in a new VS Code editor tab next to the SQL editor.
  - JSON payloads are formatted before opening for better readability.

### Tests

- Added unit tests for JSON/XML quick-open action in `GridCell`:
  - button visibility for JSON and XML values,
  - no button for plain text values,
  - `openInNewEditor` message payload verification for both JSON and XML.

## [0.16.0]

### Added

- **SQL Editor React — Data-type-aware column filters**
  - Filter popup now adapts to the SQL column type, showing only relevant filter options per category.
  - **Text** (varchar, nvarchar, char, text, …): Contains, Does not contain, Equals, Not equals, Starts with, Ends with, Regex, In (select values), Is NULL / Is not NULL. Includes a case-sensitive toggle.
  - **Number** (int, bigint, decimal, float, money, …): Equals, Not equals, Greater than, Less than, Between, Is NULL / Is not NULL.
  - **Date** (datetime, datetime2, date, datetimeoffset, …): Equals, Before, After, Between, Is NULL / Is not NULL with native datetime-local inputs.
  - **Boolean** (bit): Radio-button selection for True / False / NULL.
  - **GUID** (uniqueidentifier): Equals, Not equals, Contains, In (select values), Is NULL / Is not NULL.
  - **Binary / spatial** (varbinary, image, geography, geometry, hierarchyid): Is NULL / Is not NULL only.
  - **XML / JSON**: Is NULL / Is not NULL only.
  - **IN filter**: Checkbox-based multi-select with search, Select all / Deselect all, and selected-count display. Available for text and GUID columns (up to 500 distinct values).

### Tests

- Added 87 unit tests covering all filter categories, IN filter interactions, filter state restore, and `getColumnFilterCategory()` type mapping.

## [0.15.6] - 2026-03-12

### Fixed

- **SQL Editor React — `@@ROWCOUNT` / `@@TRANCOUNT` no longer highlighted as local variables**
  - Variable decorations now ignore T-SQL system variables prefixed with `@@`, so only real local variables such as `@ProjectToolsInserted` receive the configured variable color.

- **SQL Editor React — `Ctrl+V` / `Ctrl+X` only handled when text focus is in the editor**
  - Clipboard shortcuts are now restricted to Monaco's text-focus context.
  - This prevents the editor from intercepting paste/cut while the Find widget input is focused.

- **SQL Editor React — autocomplete resets correctly after `;`**
  - Context analysis now evaluates only the current SQL statement fragment after the last statement terminator.
  - When the cursor is after a completed statement and there is no active clause yet, autocomplete shows the expected global suggestions again, including table quick snippets such as `Users100` / `Users*`.

- **SQL Editor React — Go to Definition for SQL variables**
  - Added Monaco definition provider support for local SQL variables.
  - `F12` / `Ctrl+Click` on usages like `@ProjectToolsInserted` now navigates to the `DECLARE @ProjectToolsInserted ...` definition.

### Tests

- Added unit coverage for skipping `@@system` variable highlights.
- Added unit coverage for clipboard shortcut focus gating in Monaco actions.
- Added unit coverage for autocomplete suggestions after a semicolon-terminated statement.
- Added unit coverage for SQL variable go-to-definition resolution and provider registration.

## [0.15.5] - 2026-03-12

### Added

- **SQL Editor — "Show Multiple Result Sets" setting**
  - New `mssqlManager.multipleResultSetsDisplay` VS Code setting and corresponding **Show Multiple Result Sets** dropdown in the Query Editor tab of the Settings webview.
  - **Single view** (default): all result sets are rendered stacked, exactly as before.
  - **Separately**: when a query returns 2 or more result sets, a compact tab bar (_Set 1_, _Set 2_, …) appears above the grid. Only the selected result set is shown. If there is only one result set, the tab bar is hidden automatically.

### Fixed

- **SQL Editor — `@variable` highlight now uses foreground (text) color**
  - Previously, enabling the _Highlight Variables Color_ setting applied a semi-transparent background to `@variable` tokens. It now sets the **text color**, making variables readable against any editor background.

- **SQL Editor — T-SQL type keywords correctly colorized**
  - `NVARCHAR`, `NCHAR`, `NTEXT`, `DATETIME`, `DATETIME2`, `DATETIMEOFFSET`, `SMALLDATETIME`, `UNIQUEIDENTIFIER`, `ROWVERSION`, `TINYINT`, `BIGINT`, `VARBINARY`, `IMAGE`, `XML`, `SQL_VARIANT`, `HIERARCHYID`, `GEOGRAPHY`, `GEOMETRY`, `MONEY`, `SMALLMONEY` now receive the same blue keyword color as `INT` and `VARCHAR`.
  - Root cause: Monaco's SQL language has no `typeKeywords` array — all data-type identifiers live in the flat `keywords` list. Our previous extension was targeting a non-existent property.

### Tests

- Added 5 unit tests for the _separately_ result-sets display mode in `ResultsPanel.test.tsx`.
- Updated 2 `useVariableHighlight` tests to check `color:` (foreground) instead of `background:`.

## [0.15.4] - 2026-03-12

### Added

- **SQL Editor — "Highlight Variables Color" setting**
  - New `mssqlManager.variableHighlightColor` VS Code setting and corresponding **Highlight Variables Color** control in the Query Editor tab of the Settings webview.
  - When enabled, all `@variable` tokens in the SQL editor are highlighted with a configurable background color (default `#6adc7a`).
  - Color picker includes a native color input, hex text field, and live preview swatch.

### Fixed

- **SQL Editor — T-SQL type keywords colorization**
  - `NVARCHAR`, `NCHAR`, `NTEXT`, `DATETIME2`, `DATETIMEOFFSET`, `SMALLDATETIME`, `UNIQUEIDENTIFIER`, `HIERARCHYID`, `GEOGRAPHY`, `GEOMETRY`, `ROWVERSION`, `TIMESTAMP`, `SQL_VARIANT`, `XML`, `TINYINT`, `SMALLINT`, `BIGINT`, `MONEY`, `SMALLMONEY`, `REAL`, `IMAGE`, `BINARY`, `VARBINARY` and others now receive the correct `type` token color in the Monaco SQL editor, matching the behavior of `INT` and `VARCHAR`.

- **SQL Editor — `COUNT(*)` no longer triggers wildcard expansion**
  - `COUNT(*)`, `SUM(*)`, and any `func(*)` pattern no longer show the "Expand `*` → N columns" CodeLens action, and pressing TAB after `*` inside parentheses no longer attempts a column expansion.

- **Results panel — auto-navigate to Query Plan tab after "Get Estimated Execution Plan"**
  - After running "Get Estimated Execution Plan," the Results panel now automatically switches to the **Query Plan** tab so the plan is immediately visible without a manual click.

- **Results panel — scrolling with 5+ result sets**
  - When a query returns more than ~3 result sets, the outer results container now scrolls vertically, making all result grids accessible.

### Tests

- Added 6 unit tests for `COUNT(*)`/function-wildcard suppression in `sqlWildcardService.test.ts`.
- Added 3 unit tests for Query Plan tab auto-navigation in `ResultsPanel.test.tsx`.
- Added 9 unit tests for `useVariableHighlight` hook in `useVariableHighlight.test.ts`.

## [0.15.3] - 2026-03-11

### Added

- **Result Grid — Color Primary / Foreign Keys setting now working in React editor**
  - Fixed: the "Color Primary / Foreign Keys" toggle in Settings was saved but had no effect on the React-based SQL Editor result grid.
  - `GridCell` now reads `colorPrimaryForeignKeys` from the editor config and conditionally applies `pk-cell` (gold) / `fk-cell` (blue) CSS classes and the expand chevron.

- **Result Grid — Number Format setting**
  - New `mssqlManager.numberFormat` VS Code setting and corresponding **Number Format** dropdown in the Query Editor tab of the Settings webview.
  - Options: **Plain** (default, raw `toString()`), **Locale** (locale-aware thousand separators), **2 decimal places**, **4 decimal places**.
  - Setting is applied live to all numeric cells in query results without reloading the editor.

### Tests

- Added 16 unit tests in `GridCell.config.test.tsx` covering:
  - `colorPrimaryForeignKeys: true/false` — pk-cell / fk-cell class presence and expand chevron visibility for both PK and FK columns.
  - All four `numberFormat` values — plain, locale, fixed-2, fixed-4 — including integer padding and decimal rounding.

## [0.15.2] - 2026-03-11

### Fixed

- **SQL Editor React — Monaco Theme Color Format (Cursor Compatibility)**
  - Fixed "Illegal value for token color: rgba(...)" error when opening SQL Editor in Cursor and other VS Code forks.
  - Root cause: Cursor's VS Code CSS variables like `--vscode-editor-foreground` return `rgba()` format instead of hex. Monaco's `defineTheme` `colors` map only accepts hex format (`#RRGGBB` / `#RRGGBBAA`).
  - Solution: Added `cssColorToHex()` utility that converts any CSS color format (hex, rgb, rgba, named colors) to Monaco-compatible hex using browser-native color parsing.
  - All 4 SQL theme definitions now use `cssVarHex()` for reading editor colors, ensuring compatibility across VS Code, VS Code Insiders, and Cursor.

## [0.15.1] - 2026-03-11

### Fixed

- **New Connection — Parse Connection String: Auto-detect Windows Authentication**
  - When parsing a connection string that contains no username (e.g. `Server=(localdb)\MSSQLLocalDB;Database=master;Trusted_Connection=Yes;`), the Authentication Type field is now automatically set to **Windows Authentication** instead of remaining on the SQL Server Authentication default.
  - Added support for the `Trusted_Connection=Yes/True` key in the connection string parser (previously only `Integrated Security=True/SSPI` was recognised).
  - Fallback rule: if the parsed connection string contains neither a `User ID` nor an explicit auth-type flag, the form now defaults to Windows Authentication.

## [0.15.0] - 2026-03-09

### Added

- **SQL Notebook — Clear Results**
  - Added per-cell "Clear results" icon button (✕) on the right side of result sets, visible on hover over the output area.
  - Added "Clear All Results" button in the main notebook toolbar, visible only when at least one cell has results.
  - Clearing results removes both successful result sets and error messages.

- **SQL Notebook — Delayed Markdown Toolbar**
  - Markdown cell edit/preview toolbar now appears with a 500ms hover delay instead of instantly, reducing visual noise when scrolling.

- **Notebooks Tree — Section Management**
  - Added "New Section..." context action on notebook root folders to create subfolders for organizing notebooks.
  - Empty sections (folders) are now shown in the Notebooks tree view, enabling folder-first organization workflows.
  - "Add notebook" (➕) inline action available on both root folders and sections.
  - Hidden directories (dot-prefixed) remain filtered out.

- **Notebooks Tree — Root Notebook Creation**
  - The "+" button in the Notebooks view title now creates a root notebook as a folder with a `_config.yml` file defining the notebook name.
  - The created folder is automatically registered and displayed in the Notebooks tree view.
  - Inline "+" on folders/sections still creates `.ipynb` files as before.

### Changed

- **Notebooks Tree — Subfolder Visibility**
  - All non-hidden subfolders are now displayed in the tree view regardless of whether they contain notebooks, supporting the new section-based organization.

## [0.14.3] - 2026-03-08

### Added

- **Formatting Options Live Preview**
  - Added Monaco Editor live preview in the Formatting tab of Settings webview showing formatted SQL in real time.
  - Preview updates automatically as formatting options are changed.
  - Sample SQL query exercises keywords, data types, functions, JOINs, and AND/OR logic to showcase all formatting styles.
  - Responsive layout: side-by-side on larger screens (≥1100px), stacked vertically on smaller screens.

## [0.14.2] - 2026-03-07

### Fixed

- **Schema Compare - SQL Session Kill State Recovery**
  - Fixed issue where Schema Compare could fail with SQL Server error: "Cannot continue the execution because the session is in the kill state".
  - Added automatic retry flow for kill-state failures by resetting database-scoped pools and retrying comparison.
  - Added safe-mode fallback for metadata loading (sequential queries instead of aggressive parallel loading) to improve resilience on unstable sessions.

## [0.14.1] - 2026-03-07

### Added

- **Settings Webview Command Integration**
  - Added **Open settings** action to Database Explorer **More Actions** menu (three-dot menu), placed at the top.
  - Added gear icon for the `MS SQL Manager: Settings` command and dedicated light/dark gear icon for the settings panel.

- **Formatting Configuration in VS Code Settings**
  - Added new `mssqlManager.formatting.*` configuration entries:
    - `tabWidth`
    - `keywordCase`
    - `dataTypeCase`
    - `functionCase`
    - `linesBetweenQueries`
    - `indentStyle`
    - `logicalOperatorNewline`
    - `formatBeforeRun`

### Changed

- **React Settings Webview UI**
  - Reworked settings UI to use a **vertical tab column** (left navigation + right content panel).
  - Replaced boolean checkboxes with **switch controls**.
  - Updated boolean setting layout to use separate columns: switch column + name/description column.
  - Removed explicit Save/Reset buttons and introduced **auto-save on change**.
  - Added subtle visual indication for values changed from defaults.

- **Settings Architecture**
  - Refactored settings form fields into dedicated components:
    - `BooleanSetting`
    - `NumberSetting`
    - `SelectSetting`
  - Moved shared settings contracts/defaults to a separate `types` module.

## [0.14.0] - 2026-03-07

### Added

- **Microsoft Entra ID (Azure AD) Authentication**: Full support for Azure SQL authentication via OAuth
  - **Interactive Browser Flow**: Launches browser for interactive login when selecting Entra ID auth
  - **Device Code Flow**: Alternative login method displaying device code in VS Code for environments without browser access
  - **Tenant ID Support**: Required field for specifying Azure AD tenant (GUID, domain, or 'organizations')
  - **Token Caching**: Credential instances cached to prevent double authentication prompts during connection test and save workflow
  - **Auto-encrypt**: Azure SQL connections automatically enforce encryption (required by Azure)

### Enhanced

- **Authentication Options**: Added "Microsoft Entra ID" as third auth type alongside SQL Server and Windows Authentication
- **Connection Configuration**: Extended ConnectionConfig interface with `azureAuthMethod` and `tenantId` fields
- **Connection UI Labels**: Auth type display now shows user-friendly names ("SQL Server", "Windows", "Microsoft Entra ID") in tree tooltips and quick-pick menus
- **Token Acquisition**: Cache-based credential management ensures tokens are reused within the same session, eliminating redundant authentication prompts

### Technical Details

- Integrated `@azure/identity` v4.x library with InteractiveBrowserCredential and DeviceCodeCredential support
- Token scope: `https://database.windows.net/.default` (Azure SQL scope)
- Credential cache key: `"method:tenantId"` for proper session management
- Tenant ID validation: Required field when Entra ID auth is selected; empty field defaults to `'organizations'` scope
- MSSQL config uses `authentication.type: 'azure-active-directory-access-token'` with acquired OAuth token

## [0.13.0] - 2026-03-07

### Added

- **React-based SQL Editor**: Complete refactor of SQL Editor from JavaScript to React + TypeScript
  - Modern React architecture with TypeScript for improved type safety and maintainability
  - Enhanced performance with optimized rendering and component management
  - Improved state management for better user experience
  - Global keyboard shortcuts for grid operations (copy, paste, save, new query)

- **Advanced SQL Completion & Context Analysis**: Intelligent SQL autocompletion with context awareness
  - FROM clause context suggestions for table discovery
  - AFTER_FROM context suggestions for improved workflow
  - ORDER BY completion with ASC/DESC suggestions
  - Support for table extraction including comma-separated tables
  - UPDATE target table extraction for better context
  - Alias support in SQL context analysis

- **Common Table Expression (CTE) Support**: Full CTE recognition and handling
  - CTE parsing and rendering with inferred column types
  - CTE column hover support and rename functionality
  - CTE rename support directly in query editor
  - CTE detection preventing false positives in validation

- **Query Plan Enhancements**: Improved query plan visualization
  - Zoom handling with cursor position maintenance
  - Enhanced UI with icons and improved layout
  - TopOperations component for detailed operation display

- **Dynamic Theme Customization**: VS Code theme integration
  - Dynamic theme detection with automatic updates
  - SQL-specific token color overrides for better visibility
  - Dynamic VS Code CSS variables for editor customization
  - Theme-aware styling for all UI components

- **Enhanced SQL Validation & Analysis**: Comprehensive query validation
  - Column reference detection and validation in SQL statements
  - Alias column detection and validation with hover support
  - Support for bracketed identifiers in analysis
  - CTE column rendering and hover support

- **SQL Wildcard Expansion**: Expand wildcard queries automatically
  - Convert SELECT * to explicit column lists
  - Support for schema-aware expansion
  - Maintains formatting and aliases

- **Advanced DataGrid Features**: Enhanced result grid interactions
  - Selection-aware copy functionality with context menu
  - Insert statement generation from selected rows
  - Cell commit functionality with pending changes tracking
  - Optimistic database selection updates

- **UI Improvements**: Multiple UI/UX enhancements
  - Fixed z-index values for sticky elements (DataGrid, GridRow)
  - Enhanced overflow widgets for improved layout stability
  - Message display filtering to reduce error clutter
  - Connect button in toolbar for connection management
  - Improved toolbar and format button styles

- **SQL Editor Provider Enhancements**: Better connection context handling
  - Support for connection context in SQL editor opening
  - Improved command registration with connectionId and database parameters
  - Better foreign key rendering and hover support
  - Enhanced metadata processing for accurate result set information

### Changed

- **SQL Editor Default Setting**: React-based SQL Editor UI is now enabled by default
  - Users can disable via settings if needed
  - Vanilla editor remains available as fallback option

- **Error Message Display**: Filters out error messages in results panel for cleaner interface

### Enhanced

- **Query Execution**: Improved SQL context and table extraction with better alias support
- **SQL Completion**: Context-aware suggestions for improved development workflow
- **Grid Performance**: Diagnostic logging and optimized rendering for large datasets
- **Connection Handling**: Better handling of connection switching and database selection

### Fixed

- **Sticky Element Layering**: Resolved z-index issues affecting DataGrid and GridRow visibility
- **Overflow Widget Layout**: Fixed layout stability with fixed overflow widgets in SQL editor

## [0.12.4] - 2026-03-04

### Added

- **SQL Notebook - Copy Cell Code Button**: Replaced the `SQL` label in code-cell toolbar with an icon-only "Copy cell code" button.
  - Copies the full code-cell source to clipboard.
  - Includes fallback copy path for environments where Clipboard API is unavailable.

### Fixed

- **SQL Notebook - Monaco Scrollbars for Long Scripts**: Restored visible scrolling behavior for long SQL scripts in notebook code cells.
  - Enabled Monaco vertical scrollbar (`vertical: auto`) and horizontal scrollbar (`horizontal: auto`).
  - Enabled mouse-wheel handling in Monaco scrollbar configuration.
  - Disabled line wrapping to preserve horizontal scrolling for long lines.
  - Updated cell source container CSS to allow scrolling (`overflow: auto`).

## [0.12.3] - 2026-03-03

### Fixed

- **Backup Import — Suggest New Name**: The "Suggest New Name" button now derives the base name from the selected `.bak` filename when the backup has not yet been analyzed (or analysis returned no metadata), instead of falling back to the generic `MyDatabase` placeholder.
- **Backup Import — Target Database auto-fill**: Selecting a `.bak` file now automatically populates the Target Database field with the filename (without extension) when the field is empty.
- **Backup Import — SQL Server accessible staging path**: Backup files copied for SQL Server access are now staged under `<SYSTEMDRIVE>\Temp\sql-backup-restore` (e.g. `D:\Temp\...`) instead of the hardcoded `C:\Temp\...`, ensuring compatibility on systems where the OS is not installed on `C:`.

## [0.12.2] - 2026-03-01

### Changed

- **New Query (Untitled Mode)**: "New Query" no longer creates temporary `.sql` files on disk. Instead, it opens a lightweight untitled SQL editor webview with full query execution support. Press `Ctrl+S` to save the query to a `.sql` file via Save As dialog, which then re-opens it in the standard custom SQL editor.

### Fixed

- **Open VSX Publish**: Fixed `.vsix` glob not resolving on Windows runners in GitHub Actions CI/CD pipeline

## [0.12.1] - 2026-03-01

### Added

- **Create Database**: New "Create Database..." context menu option on active server connections in the Database Explorer
  - Prompts for database name with input validation (length, invalid characters)
  - Creates the database on the server and refreshes the tree view automatically

- **Delete Database**: New "Delete Database" context menu option on database instances under server connections
  - **Close Connection**: Closes the connection pool to the specific database without dropping it
  - **Drop Database**: Permanently drops the database with double confirmation to prevent accidental data loss
  - Automatically sets database to single-user mode before dropping to force-close active connections

### Fixed

- **Duplicate Refresh in Database Context Menu**: Fixed duplicate "Refresh" entries appearing in the right-click context menu for database instances under server connections
  - Removed redundant `refreshNode` menu entry for database nodes — only the more comprehensive `refreshDatabaseSchema` entry is now shown

## [0.12.0] - 2026-03-01

### Added

- **SQL Notebook Editor**: New custom editor for `.ipynb` files enabling interactive SQL notebooks within VS Code
  - **React-based webview UI**: Modern notebook interface built with React + Vite featuring code and markdown cells
  - **SQL cell execution**: Execute individual SQL cells against any active connection with results displayed inline as a scrollable data grid
  - **Collapsible code cells**: Cells can be collapsed/expanded to keep the notebook tidy
  - **Markdown cells**: Full markdown cell support for annotating notebooks with formatted text
  - **Connection selector**: Per-notebook connection picker — choose any active MS SQL connection directly from the toolbar
  - **Database selector**: When a server-level connection is selected, a second dropdown appears for choosing the target database
  - **Notebook navigation**: Previous / next buttons in the toolbar to jump between `.ipynb` files in the same directory tree
  - **Auto-refresh connections**: The connection list updates automatically whenever connections change in the Database Explorer
  - **Manage connections shortcut**: Quick-access button to open the connection management dialog from within the notebook

- **Notebooks Tree View**: Dedicated "Notebooks" panel in the MS SQL Manager sidebar for browsing and managing notebook files
  - **Add folder**: Open any folder containing `.ipynb` files and browse its structure in the tree
  - **Folder persistence**: Added notebook folders are remembered across VS Code sessions via global state
  - **Subfolder support**: Nested subfolders are shown when they contain `.ipynb` files
  - **One-click open**: Clicking a notebook file opens it directly in the new SQL Notebook Editor
  - **Remove folder**: Right-click context menu to remove a folder from the notebooks panel
  - **Refresh**: Manual refresh command to rescan folders for new or removed files

## [0.11.4] - 2026-02-28

### Fixed

- **Related Tables Expansion with Windows Authentication**: Fixed "No related data found" when expanding related tables on connections using Windows Auth (e.g. SQL Express / LocalDB)
  - Root cause: the expansion query was prefixed with `USE [database];` even though the connection pool was already scoped to the correct database. The `msnodesqlv8` driver (used for Windows Auth) materialises `USE` as a separate empty result set, causing the UI to read `resultSets[0]` (empty) instead of `resultSets[1]` (actual data).
  - Backend fix: removed the redundant `USE [database];` prefix from relation expansion queries — the pool created by `createDbPool` already targets the correct database.
  - Frontend fix: `handleRelationResults` now picks the **first non-empty** result set rather than always using index 0, providing a safety net for any driver that may still emit auxiliary result sets.


## [0.11.3] - 2026-01-28

### Fixed

- **Local Server Discovery Check**: Re-enabled the check to skip local server discovery if it has already been executed, preventing unnecessary repeated discovery attempts on Windows systems.

## [0.11.2] - 2026-01-22

### Fixed

- **NULL Value Handling in Result Grid Updates**: Fixed issue where typing "null" in a cell would generate `SET column = 'NULL'` instead of `SET column = NULL`
  - Typing "null" (case-insensitive) in a cell now correctly generates SQL NULL value
  - Typing "'null'" (with quotes) also generates SQL NULL value
  - Prevents incorrect string literal 'NULL' from being inserted into database columns
  - Affects all UPDATE statements generated from editable result grids

## [0.11.1] - 2026-01-21

### Added

- **Font Customization Support**: Comprehensive font configuration for SQL editor and result grids
  - **CSS Variables Integration**: Added support for VS Code font variables (--vscode-font-family, --vscode-font-size, --vscode-editor-font-family, --vscode-editor-font-size)
  - **Monaco Editor Font Configuration**: SQL editor now respects VS Code's editor font settings for consistent typography
  - **Result Grid Font Enforcement**: Query result tables now properly apply font settings through multiple enforcement mechanisms
  - **GUID Column Width Optimization**: Automatic minimum 300px width for GUID columns to ensure readability
  - **Font-Aware Column Sizing**: Column width calculations now account for actual font metrics for optimal display
  - **Inline Font Styling**: JavaScript-created table elements use inline styles to ensure font application
  - **CSS Specificity Handling**: Added !important declarations for table font rules to override competing styles

## [0.11.0] - 2026-01-03

### Added

- **SQL Object Validation**: Real-time validation of SQL object names in FROM/JOIN clauses with error highlighting
  - **Invalid object detection**: Automatically detects and marks invalid table/view names with red error squiggles
  - **CTE support**: Recognizes Common Table Expressions (CTEs) defined within the same statement scope
  - **Temp table support**: Properly handles temporary tables (starting with #) as valid objects
  - **Schema-aware validation**: Validates objects against cached database schema including both tables and views
  - **Statement scope handling**: Correctly scopes CTEs to individual statements, preventing cross-statement validation errors
  - **Bracket notation support**: Handles both bracketed `[schema].[table]` and unbracketed `schema.table` formats
  - **Overlapping match resolution**: Prevents false positives by prioritizing longer, more complete object references

## [0.10.1] - 2025-12-30

### Fixed

- **Schema Cache for Server Connections**: Fixed schema cache not being used for server-level connections where `activeConnection.database` is empty
  - Schema cache now properly retrieves current database name from connection provider for server connections
  - Ensures PK/FK metadata is always available from cache regardless of connection type (database vs server connections)
  - Improved logging for cache retrieval operations to aid troubleshooting

## [0.10.0] - 2025-12-23

### Added

- **Script ROW Commands**: Added "Script ROW as" context menu on tables with INSERT, UPDATE, and DELETE options
  - **INSERT**: Generates INSERT script with type-appropriate placeholders (excludes identity/computed/generated columns)
  - **UPDATE**: Generates UPDATE script with first column active, rest commented (excludes primary keys)
  - **DELETE**: Generates cascading DELETE script with transaction wrapper and recursive foreign key dependency detection
- **Delete Row with References**: Added context menu option in query results to generate cascading DELETE script with actual row values
  - Automatically fills in primary key values from selected row
  - Handles composite primary keys
  - Supports multi-table cascade deletion with proper ordering
  - Excludes self-referencing foreign keys to prevent infinite loops
- **Comprehensive Test Coverage**: Added 20+ test cases for Script ROW commands covering:
  - INSERT script generation with various data types
  - UPDATE script with composite PKs
  - DELETE script with cascading dependencies and self-references
  - Row data formatting (strings, numbers, dates, booleans, NULLs)
  - Circular reference prevention

## [0.9.1] - 2025-12-20

### Fixed

- **GO Statement Support**: Added proper support for SQL Server's GO batch separator
  - GO statements are now correctly handled and do not throw SQL syntax errors
  - Queries are automatically split into batches at GO statements
  - Each batch is executed separately, similar to Azure Data Studio and SSMS
  - GO is case-insensitive and whitespace-tolerant
  - Works with both Windows Authentication (msnodesqlv8) and SQL Authentication (mssql) drivers
  - Enhanced regex pattern to detect GO statements reliably with or without semicolons
  - Results from all batches are aggregated and displayed
  - Progress reporting for multi-batch queries
  - Comprehensive logging for troubleshooting GO statement detection


## [0.9.0] - 2025-12-15

### Added

- **SQL Code Formatting**: Integrated T-SQL code formatter with customizable options
  - **sql-formatter library**: Integrated sql-formatter v15.0.2 from CDN for professional SQL formatting
  - **Format button**: Icon-only format button in SQL Editor toolbar (after Connect button)
  - **Formatting options**: Hover-activated options button with configurable formatting settings
    - Language selection: T-SQL, SQL, PL/SQL, MySQL
    - Indentation control: Configurable tab width (1-8 spaces)
    - Case options: Keyword, data type, and function case (UPPER, lower, Preserve)
    - Lines between queries: Adjustable spacing (0-5 lines)
  - **Format before run**: Optional auto-formatting before query execution
  - **Persistent preferences**: Formatting options saved to localStorage for consistency across sessions
  - **Clean UI design**: Icon-only buttons without backgrounds, integrated seamlessly into toolbar
  - **Popup configuration**: Modal popup for detailed formatting configuration with Apply & Format action

## [0.8.1] - 2025-12-15

### Enhanced

- **SQL Editor Results - Pending Changes UI/UX Improvements**: Major redesign of pending changes interface for better usability
  - **Aggregated row changes**: Multiple column changes in the same row now displayed as single UPDATE with multiple SET clauses
  - **Icon-only action buttons**: Cleaner interface with icon-only buttons (Commit, Revert, Preview) without text labels
  - **Reorganized layout**: Action buttons moved before title in header with new order (Commit All, Revert All, Preview SQL)
  - **Expandable change details**: Multi-column changes now expandable with chevron icon showing individual column modifications
  - **Per-column actions**: Commit or revert individual columns within expanded details for granular control
  - **Optimized DELETE display**: DELETE operations now show 2 icons instead of 3 (trash icon commits delete, arrow reverts)
  - **Theme-aware styling**: Chevron icons and buttons properly adapt to light/dark themes
  - **Removed hover effects**: Cleaner visual experience without distracting hover backgrounds on change items

- **SQL Code Generation - Bracket Notation**: Comprehensive SQL formatting improvements with proper identifier escaping
  - **Consistent bracket notation**: All SQL snippets now use `[schema].[table] [alias]` format for maximum compatibility
  - **Dynamic autocomplete**: Table, schema, and alias names properly wrapped in square brackets `[]`
  - **Built-in snippets**: All 33+ built-in SQL snippets updated to use bracket notation
  - **Backend commands**: "Generate SELECT Script" and "Select Top 1000" commands updated with bracket notation
  - **JOIN autocomplete**: Fixed to work correctly with bracketed aliases (e.g., `[alias]` and `alias` formats)

- **Connection Management Improvements**: Enhanced connection workflow and user experience
  - **Last connection tracking**: Automatically saves and displays last connection time for each saved connection
  - **Smart connection sorting**: Quick pick now sorts connections by most recently used (newest first)
  - **Friendly time display**: Shows connection age as "5m ago", "2h ago", "yesterday", etc. in connection selector
  - **Quick connect from empty state**: Clicking "Not Connected" dropdown now opens connection selector instead of showing empty menu
  - **Connection metadata**: Added `lastConnected` field to connection configuration with ISO date string

### Fixed

- **DELETE operation data transmission**: Fixed unnecessary data being sent to backend during row deletion
  - Removed `rowData` from DELETE messages to backend (only sends primary keys and metadata)
  - Applies to `commitSingleChange`, `commitRowChanges`, and `commitAllChanges` functions
  - Significantly reduces message payload size for DELETE operations

- **DELETE UnknownTable display**: Fixed "UnknownTable" appearing for DELETE operations in pending changes
  - DELETE operations now correctly use `sourceTable` and `sourceSchema` from change object
  - Proper table name resolution for both DELETE and UPDATE operations

- **Pending changes UI positioning**: Improved button and text positioning in change items
  - Action buttons now consistently placed before text labels for better visual flow
  - Expanded detail buttons positioned before column names for easier access

## [0.8.0] - 2025-12-07

### Added

- **Related Tables Expansion**: Interactive exploration of related data directly within query results
  - **Expandable Foreign Keys**: Click on foreign key values to instantly view related records from the referenced table
  - **Reverse Relationship Discovery**: Expand primary key values to find related records in other tables that reference the selected row
  - **Nested Result Grids**: Related data appears in inline nested grids without losing context of the main query
  - **Recursive Exploration**: Drill down through multiple levels of relationships (e.g., Order -> Customer -> Address)
  - **Smart Context**: Automatically detects relationships based on database schema metadata

## [0.7.1] - 2025-11-30

### Added

- **Enhanced Query Results Table**: Comprehensive improvements to SQL query results display and interaction
  - **Quick Save Button**: Added quick save button with tooltip functionality for editable result sets
  - **Primary and Foreign Key Styling**: Visual distinction for PK/FK columns with dedicated icons (🔑 for primary keys, 🔗 for foreign keys)
  - **Advanced Statistics**: Real-time statistical analysis for numeric, date, and string data types
    - Numeric columns: Sum, average, min, max, range calculations
    - DateTime columns: Date range display with secondary minimum for readability
    - String columns: Character length statistics and unique value counts
  - **Improved Metadata Extraction**: Enhanced query execution to properly handle SET statements and extract accurate metadata
  - **Smart PK/FK Detection**: Optimized primary and foreign key lookup logic for better performance
  - **Tooltip Positioning**: Adjusted tooltip positioning for better user experience with quick save button

### Enhanced

- **Query Executor**: Improved handling of SET statements and metadata extraction for more accurate result set information
- **SQL Editor Provider**: Enhanced metadata processing to support new statistics and key column detection
- **Result Set Display**: Better formatting and readability for DateTime statistics with range-based display

## [0.7.0] - 2025-11-30

### Added

- **Docker SQL Server Support**: Complete Docker integration for containerized SQL Server management
  - **Automatic Docker Discovery**: Discovers running Docker SQL Server containers and adds them to a dedicated Docker group
  - **Deploy Docker MS SQL**: Interactive webview to deploy new SQL Server containers with customizable configuration
  - **Container Configuration**: Support for custom container names, ports, memory limits, and Docker networks
  - **SQL Server Versions**: Deploy SQL Server 2017, 2019, 2022, or Azure SQL Edge with various editions (Developer, Express, Standard, Enterprise)
  - **Security Configuration**: Strong password generation with complexity requirements and EULA acceptance
  - **Connection Testing**: Built-in connection testing to verify deployed containers are ready
  - **Docker Group Management**: Specialized Docker server group with custom icon and deploy options
  - **SA Password Management**: Secure storage and retrieval of SA passwords for Docker containers
  - **Local Server Discovery**: Windows-only discovery of local SQL Server instances (LocalDB, SQL Express)
  - **More Actions Menu**: Redesigned Database Explorer toolbar with collapsible "More Actions" submenu
  - **Collapse All**: Quick collapse functionality for the entire database explorer tree

### Enhanced

- **Server Group Icons**: Added custom icons for Docker and Local server groups with theme-aware styling
- **Context Menu Refinement**: Restricted "Filter Databases" option to only active server connections
- **Menu Organization**: Improved context menu organization with better grouping and discovery options
- **Docker Detection**: Automatic Docker runtime detection with conditional menu availability
- **Connection Provider**: Enhanced connection handling for Docker containers with specialized prompts

### Fixed

- **Context Menu Bug**: Fixed missing context menu options for inactive connections (regression from v0.6.0)
  - Restored proper contextValue assignment for inactive connections
  - Fixed "Connect", "Edit Connection", "Delete Connection" options for inactive connections
  - Added comprehensive regression tests to prevent future contextValue issues

### Technical Improvements

- Added comprehensive Docker discovery utilities with container filtering and environment variable extraction
- Implemented deploy Docker MS SQL webview with real-time validation and progress tracking
- Enhanced UnifiedTreeProvider with better contextValue handling for instructions integration
- Improved server group management with dynamic contextValue assignment

## [0.6.0] - 2025-11-27

### Added

- **AI-Powered SQL Chat Assistant (@sql)**: Integrated chat participant for intelligent SQL query generation and database assistance
  - **Natural language to SQL**: Convert plain English questions into optimized SQL queries (e.g., "show me all customers from New York")
  - **Context-aware assistance**: Automatically detects active database connection and loads full schema context for accurate query generation
  - **Direct query execution**: Generated SQL queries execute directly in the SQL Editor with results displayed in real-time
  - **Database schema integration**: Chat assistant understands your database structure including tables, columns, relationships, and data types
  - **Database-specific instructions**: Link custom .md instruction files to databases/connections for specialized context (e.g., business rules, naming conventions)
  - **Instruction management**: Add, edit, and unlink instruction files through context menus with automatic file watching
  - **Smart command system**: Built-in commands like `/explain`, `/optimize`, and `/schema` for specialized assistance
  - **Conversation memory**: Maintains context throughout the chat session for follow-up questions and refinements
  - **Multi-connection support**: Works seamlessly with both database-level and server-level connections
  - **Accessibility**: Available via "Open SQL Chat" in connection context menus or through VS Code's chat interface
  - **Real-time schema caching**: Background schema generation ensures fast response times with automatic cache updates

### Enhanced

- **Server Group Management**: Improved server group workflow with streamlined connection creation
  - **Quick add connection**: New inline "+" button on server groups opens connection dialog with pre-selected group
  - **Context menu integration**: "Add Connection" option in server group right-click menu
  - **Auto-group assignment**: New connections automatically assigned to selected server group
  - **Reorganized toolbar**: Cleaner Database Explorer toolbar with optimized button layout (removed redundant refresh button)

## [0.5.0] - 2025-11-25

### Added

- **Built-in SQL Snippets**: Comprehensive collection of 33+ built-in SQL code snippets for enhanced productivity
  - **Stored Procedures**: `proc`, `procedure`, `usp` - Generate CREATE OR ALTER PROCEDURE templates with parameters
  - **Views**: `vw`, `view`, `v_` - Create views with proper formatting and GO statements
  - **Functions**: `funcs`/`scalar` for scalar functions, `func`/`tvf`/`uf` for table-valued functions
  - **Database Objects**: `ct`/`table` for CREATE TABLE, `trig`/`trigger` for triggers
  - **Basic Queries**: `sel` for SELECT, `self`/`nolock` for SELECT WITH (NOLOCK), `top` for TOP queries
  - **Data Manipulation**: `ins` for INSERT, `insel` for INSERT SELECT, `upd` for UPDATE, `del` for DELETE
  - **Advanced SQL**: `merge` for MERGE statements, `cte` for CTEs, `tran` for transactions, `try` for error handling
  - **Utilities**: `exists` for IF EXISTS, `#t` for temp tables, `@t` for table variables, `offset` for pagination
  - **Administration**: `missing` for missing indexes query, `plan` for execution plans, `reindex`, `stats`, `spwho`
  - **Modern SQL**: `json` for FOR JSON PATH, `openjson` for JSON parsing, `dyn` for dynamic SQL
  - **Cloud Features**: `elastic` for Azure Elastic Query, `cetas` for Synapse/Fabric external tables
  - **Documentation**: `header` for script headers, `printlong` for printing long strings
  - **Smart Integration**: Built-in snippets work alongside user-defined snippets with priority handling
  - **Visual Distinction**: Built-in snippets display with ⚡ icon, user snippets with 📝 icon
  - **Create Custom Snippets**: Right-click context menu "Create Snippet..." to convert selected SQL code into reusable snippets

## [0.4.4] - 2025-11-25

### Added

- **Configurable Extension Activation**: Added `mssqlManager.immediateActive` setting for controlling extension activation behavior
  - **Default behavior (immediateActive = true)**: Extension activates immediately when VS Code starts, providing instant access to database management features
  - **SQL-only activation (immediateActive = false)**: Extension activates only when SQL files are opened, reducing startup overhead for non-SQL workflows
  - **Dynamic activation detection**: When set to false, extension intelligently detects existing SQL files and activates accordingly
  - **Seamless transition**: Extension activates automatically when first SQL file is opened, maintaining full functionality
  - **User preference support**: Setting can be configured in VS Code settings (File > Preferences > Settings > search "mssqlManager.immediateActive")
## [0.4.3] - 2025-11-24

### Fixed

- **Query History Execution Comments**: Fixed issue where execution summary comments accumulated when re-running queries from history
  - **Clean execution**: Execution summary comments ("-- Query from history", "-- Executed:", "-- Connection:", "-- Result Sets:") are now properly replaced instead of appended
  - **Smart comment detection**: Added intelligent detection and removal of existing execution metadata before adding new comments
  - **History preservation**: Query history now stores clean SQL without execution comments, preventing comment accumulation
  - **Consistent behavior**: Both regular query execution and history replay now handle execution summaries consistently
  - Previously, re-executing queries from history would append new execution comments to existing ones, creating cluttered SQL with duplicate metadata

## [0.4.2] - 2025-11-24

### Added

- **Dynamic Column Width Adjustment**: Enhanced SQL query results table with intelligent column sizing
  - **Automatic width calculation**: Column widths now automatically adjust based on header text and content length
  - **Manual column resizing**: Double-click column borders to auto-fit individual columns to optimal width
  - **Bulk auto-fit functionality**: "Auto-fit all columns" option in export menu for one-click optimization
  - **Canvas-based measurement**: Uses Canvas API for precise text measurement ensuring accurate width calculations
  - **Performance optimized**: Samples up to 100 rows for width calculation to maintain responsive performance
  - **Configurable bounds**: Columns maintain reasonable min (80px) and max (450px) width limits

ion for all interactive elements

## [0.4.1] - 2025-11-23

### Added

- **XML Export Functionality**: Added XML export option to SQL query results table export menu
  - **New XML export format**: Export query results as structured XML with proper escaping and formatting
  - **XML file type support**: Integrated XML file filters and save dialog support
  - **Enhanced export menu**: Added XML option with dedicated XML file icon to export dropdown
  - **Proper XML structure**: Results exported with root `<results>` element containing `<row>` elements for each data row
  - **Safe element naming**: Column names automatically sanitized to create valid XML element names
  - **XML character escaping**: Proper escaping of special characters (&, <, >, ", ') for valid XML output
  - **Open file integration**: XML files can be opened directly in VS Code after export via popup action button

## [0.4.0] - 2025-11-23

### Added

- **Auto Azure Database Discovery & Registration**: Automated discovery and registration of Azure SQL databases
  - **Azure subscription scanning**: Automatically discovers Azure SQL servers across all accessible subscriptions
  - **Intelligent database detection**: Identifies all databases within discovered Azure SQL servers
  - **One-click registration**: Seamlessly adds discovered databases to the Database Explorer with proper connection configuration
  - **Authentication integration**: Leverages existing Azure CLI authentication for secure server access
  - **Bulk operations support**: Register multiple databases and servers simultaneously with batch processing
  - **Connection validation**: Automatically validates connectivity and firewall rules during registration process
  - **Smart naming**: Generates meaningful connection names based on server and database information
  - **Progress tracking**: Real-time feedback during discovery and registration operations with detailed logging
  - **Error handling**: Graceful handling of authentication failures, network issues, and permission problems
  - **Cache integration**: Utilizes Azure server cache for faster subsequent discovery operations

## [0.3.2] - 2025-11-23

### Added

- **Azure SQL Firewall Integration**: Intelligent Azure SQL firewall error detection and automated resolution
  - **Automatic error detection**: Recognizes Azure SQL firewall errors and extracts server name and client IP
  - **Smart resolution options**: Shows "Add IP with Azure CLI" and "Open Azure Portal" buttons for failed connections
  - **Azure CLI automation**: Automatically installs Azure CLI, handles authentication, and adds firewall rules
  - **Multi-subscription support**: Searches across all Azure subscriptions to find SQL servers
  - **Intelligent caching**: Caches server location information for faster subsequent operations
  - **Auto-reconnect**: Automatically attempts reconnection after successful firewall rule creation
  - **Context menu integration**: Azure firewall options available in failed connection context menus
  - **Cache management**: Commands to view and clear Azure server cache for troubleshooting

## [0.3.1] - 2025-11-23

### Fixed

- **Connection Loop Bug**: Fixed infinite connection retry loop when database connections fail
  - **Failed connection tracking**: Added mechanism to track and prevent repeated connection attempts after failure
  - **Single error notifications**: Connection errors now show only once as VS Code notifications instead of repeatedly
  - **UI state indicators**: Failed connections display with warning icons and appropriate context menu options
  - **Manual retry support**: Users can manually retry failed connections through "Connect" context menu option
  - Previously, failed connections (e.g., Azure SQL firewall blocks) would cause endless retry loops consuming resources

## [0.3.0] - 2025-11-23

### Added

- **Database Backup Import/Export Features**: Comprehensive backup management functionality
  - **Backup Import Webview**: Interactive interface for restoring database backups (.bak files)
    - File selection dialog with .bak file filtering
    - Database name configuration with automatic suggestions
    - Advanced options for backup verification and recovery settings
    - Real-time import progress tracking with detailed logging
    - Support for overwriting existing databases with confirmation prompts
  - **Backup Export Webview**: Streamlined database backup creation interface
    - Database selection dropdown with active connection integration
    - Custom backup file naming and location selection
    - Backup type options (Full, Differential, Transaction Log)
    - Compression settings and backup verification options
    - Progress monitoring with success/failure notifications
  - **Context Menu Integration**: Right-click backup operations directly from database tree
    - "Import Database" option for connection-level backup restoration
    - "Export Database" option for individual database backup creation
    - Seamless integration with existing connection management


## [0.2.6] - 2025-11-12

### Added

- **Enhanced SQL Result Table Copy Functionality**: Comprehensive copy-to-clipboard features for SQL query results
  - **CTRL+C keyboard shortcut**: Copy selected cells, rows, or columns to clipboard with TSV formatting
  - **Smart context detection**: Copy only works when Monaco editor is not focused, preventing interference with code editing
  - **Multi-selection support**: Copy multiple selected rows, columns, or individual cells seamlessly
  - **Select all columns**: Click on "#" header to automatically select all table columns for bulk operations
  - **Enhanced aggregation statistics**: Added NULL value count display when selecting columns with null data
  - **Fixed duplication issues**: Resolved bug where single row/column selections were duplicated during copy operations
  - **Improved context menus**: Corrected menu labels to show accurate row/column counts (e.g., "Copy 1 row" instead of "Copy 5 rows")
  - **TSV format support**: Copied data uses Tab-Separated Values format for easy pasting into Excel and other applications

### Technical Improvements

- Enhanced global keyboard event handling with Monaco Editor focus detection
- Improved selection state management using Set operations for unique row/column counting
- Added comprehensive null value tracking in statistical calculations
- Optimized clipboard operations with proper error handling and user feedback

## [0.2.5] - 2025-11-12

### Improved

- **New Query File Management**: Enhanced "New Query" functionality to reuse empty SQL files
  - System now checks for existing empty .sql files before creating new ones
  - **Automatic connection update**: When reusing empty files, SQL Editor connection dropdown automatically switches to the selected connection
  - Reduces file clutter by preventing creation of multiple empty query files
  - Improved user experience with seamless connection switching

## [0.2.4] - 2025-11-12

### Added

- **Query Execution Timeout Configuration**: Added configurable query timeout setting
  - New setting `mssqlManager.queryTimeout` (default: 0 seconds = infinite timeout)
  - Resolves 15-second timeout limitation - queries can now run indefinitely
  - Users can set custom timeout values in VS Code settings (File > Preferences > Settings > search "mssqlManager.queryTimeout")
  - Set to 0 for infinite timeout, or specify timeout in seconds

### Enhanced

- **Query Execution UI**: Improved query execution feedback in Results panel
  - **Added animated loading spinner during query execution**
  - **Added real-time execution timer showing elapsed time (MM:SS.T format)**
  - Better visual indication that query is running with enhanced loading state
  - Timer updates every 100ms for smooth progress indication

## [0.2.3] - 2025-11-11

### Fixed

- **Editable Result Sets**: Fixed critical issue with "Revert" and "Revert All" functionality in pending changes
  - Fixed infinite loop between `updatePendingChangesCount()` and `renderPendingChanges()` functions
  - **Revert operations now properly restore original values in the data and refresh table display**
  - Removed recursive function calls that caused "Maximum call stack size exceeded" errors
  - Pending changes UI now correctly hides when all changes are reverted
  - Cell modifications are properly cleared and original formatting restored
  - Row deletion markings are correctly removed on revert


## [0.2.2] - 2025-11-08

### Fixed

- **Windows Authentication Support**: Fixed critical issue where Windows Authentication connections failed after installing from marketplace
  - **Changed GitHub Actions workflow to build on `windows-latest` instead of `ubuntu-latest`** (CRITICAL FIX!)
    - msnodesqlv8 contains platform-specific native binaries
    - Building on Linux resulted in Linux binaries being packaged, which don't work on Windows
    - Now building on Windows ensures Windows binaries are included
  - Added `msnodesqlv8` to webpack externals to prevent bundling of native binary modules
  - Updated `.vscodeignore` to include `msnodesqlv8` package with native binaries in published extension
  - The extension now correctly includes the Windows-compatible `sqlserver.node` binary required for Windows Authentication

### Technical Details

- Native modules like `msnodesqlv8` cannot be bundled by webpack and must be distributed with the extension
- Native binaries are platform-specific and must be built on the target platform
- See `WINDOWS_AUTH_FIX.md` for detailed information about the fix

## [0.2.1] - 2025-11-08

### Fixed

- Initial attempt to fix Windows Authentication - incomplete (did not address platform-specific build issue)

## [0.2.0] - 2025-11-07

### Added

- Initial release of MS SQL Manager extension
- MS SQL Server connection management with support for multiple connections
- Advanced SQL query runner with syntax highlighting and results display
- Schema comparison tool for comparing database structures
- Interactive database diagrams for visualizing table relationships
- SQL script generation for database objects (tables, stored procedures, etc.)
- Query history tracking with pin/unpin and grouping functionality
- Server group management for organizing connections
- Database and table filtering capabilities
- Custom SQL editor with enhanced features for .sql files
- Comprehensive context menus for database operations
- Support for stored procedure management (create, modify, execute, script)

### Features

- **Connection Management**: Connect to multiple SQL Server instances with secure credential storage
- **Query Execution**: Execute SQL queries with F5 or Ctrl+Shift+E keyboard shortcuts
- **Database Explorer**: Browse databases, tables, views, and stored procedures in a tree view
- **Schema Tools**: Compare schemas between databases and generate difference scripts
- **Visual Diagrams**: Generate and view database relationship diagrams
- **Script Generation**: Generate CREATE, ALTER, DROP, and EXECUTE scripts for database objects
- **Query History**: Track and manage previously executed queries with search and organization features
 
 