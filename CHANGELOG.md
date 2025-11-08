# Changelog

All notable changes to the MS SQL Manager extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2024-11-08

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

## [0.2.1] - 2024-11-08

### Fixed
- Initial attempt to fix Windows Authentication - incomplete (did not address platform-specific build issue)

## [0.2.0] - 2024-11-07

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