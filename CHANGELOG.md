# Changelog

All notable changes to the MS SQL Manager extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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