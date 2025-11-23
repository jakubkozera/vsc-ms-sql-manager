# MS SQL Manager for VS Code

A comprehensive VS Code extension for managing Microsoft SQL Server databases with connection management, schema browsing, and query execution capabilities.

## Features

### 🔌 MS SQL Server Connection
Comprehensive connection management system for Microsoft SQL Server databases with support for multiple authentication methods and connection profiles.

![Connection Management](https://raw.githubusercontent.com/jakubkozera/vsc-ms-sql-manager/master/docs/sql-server-connection.png)

**Key Features:**
- **Interactive Connection Form**: Dedicated webview form for creating and testing connections
- **Multiple Authentication Types**: SQL Server Authentication, Windows Authentication, and Azure AD
- **Connection Profiles**: Save and reuse connection configurations securely  
- **Server Groups**: Organize connections into logical groups for better management
- **Connection Testing**: Validate connections before saving them
- **Secure Credential Storage**: Passwords handled securely without permanent storage

### ☁️ Azure SQL Discovery
Automated discovery and connection setup for Azure SQL databases with intelligent authentication guidance.

**Key Features:**
- **Automatic Discovery**: Scans all accessible Azure subscriptions for SQL servers and databases
- **Smart Authentication**: Detects available authentication methods (SQL Auth vs Azure AD)
- **Credential Guidance**: Provides specific instructions for each authentication type
- **Startup Integration**: Automatically discovers Azure resources when extension loads
- **Manual Discovery**: On-demand discovery via "Azure: Discover SQL Servers" command
- **Rich Metadata**: Includes subscription, resource group, and location information



### ⚡ SQL Runner
Advanced SQL query execution engine with comprehensive T-SQL support and real-time results display.

![SQL Runner](https://raw.githubusercontent.com/jakubkozera/vsc-ms-sql-manager/master/docs/sql-runner.png)

**Key Features:**
- **Enhanced SQL Editor**: Custom editor with syntax highlighting for `.sql` files
- **Flexible Execution**: Run selected text, current statement, or entire file
- **GO Statement Support**: Proper handling of batch separators
- **Query History**: Track, organize, and rerun previous queries with pin/unpin functionality
- **Real-time Progress**: Live execution progress and performance metrics
- **Results Export**: Export query results to CSV format
- **Keyboard Shortcuts**: Execute with F5 or Ctrl+Shift+E

### 🔍 Schema Compare
Professional schema comparison tool for analyzing differences between database structures and generating synchronization scripts.

![Schema Compare](https://raw.githubusercontent.com/jakubkozera/vsc-ms-sql-manager/master/docs/schema-compare.png)

**Key Features:**
- **Side-by-side Comparison**: Visual comparison of database schemas
- **Object-level Analysis**: Compare tables, views, stored procedures, and functions
- **Difference Highlighting**: Clear visualization of schema differences
- **Synchronization Scripts**: Generate T-SQL scripts to synchronize schemas
- **Selective Sync**: Choose which objects to include in synchronization
- **Cross-database Support**: Compare schemas across different databases

### 📊 Database Diagrams
Interactive database visualization tool for understanding table relationships and database structure.

![Database Diagrams](https://raw.githubusercontent.com/jakubkozera/vsc-ms-sql-manager/master/docs/database-diagrams.png)

**Key Features:**
- **Interactive Diagrams**: Visual representation of database tables and relationships
- **Relationship Mapping**: Automatic detection and display of foreign key relationships
- **Zoom and Pan**: Navigate large database schemas with ease
- **Table Details**: View column information, data types, and constraints
- **Export Options**: Save diagrams for documentation purposes
- **Real-time Updates**: Diagrams reflect current database structure

### 📝 Generate SQL Scripts
Comprehensive script generation system for creating T-SQL scripts for various database operations.

![Generate SQL Scripts](https://raw.githubusercontent.com/jakubkozera/vsc-ms-sql-manager/master/docs/generate-scripts.png)

**Key Features:**
- **Object Scripting**: Generate CREATE, ALTER, and DROP scripts for database objects
- **Stored Procedure Management**: Complete lifecycle management with script generation
- **Data Export Scripts**: Generate INSERT scripts with data
- **Batch Operations**: Script multiple objects simultaneously
- **Flexible Output**: Send scripts to new editor, file, or clipboard
- **Template Support**: Customizable script templates for consistent formatting


## Usage

### Connecting to SQL Server

1. Open the MS SQL Manager panel in the sidebar (database icon)
2. Click the "Connect" button (plug icon) in the Schema Explorer
3. This opens a dedicated connection form with the following features:
   - **Server Configuration**: Enter server name, database, and port
   - **Authentication Options**: Choose between SQL Server, Windows, or Azure AD authentication
   - **Security Settings**: Configure encryption and certificate trust options
   - **Connection Testing**: Test your connection before saving
   - **Save for Reuse**: Optionally save the connection profile for future use

4. **Test Connection**: Click "Test Connection" to verify your settings work
5. **Save Connection**: Once tested successfully, save the connection
6. The form will close and your connection will be active

### Managing Saved Connections

- Click the **gear icon** (⚙️) in the Schema Explorer to manage connections
- **Quick Connect**: Select from previously saved connections
- **Create New**: Add new connection profiles
- **Password Prompts**: For SQL authentication, passwords are requested each time

### Browsing Schema

Once connected, the Schema Explorer will show:
- 📂 Your server instance
- 📂 Connected database
- 📁 Object type folders (Tables, Views, Stored Procedures, Functions)
- 📄 Individual database objects

### Executing Queries

1. Create or open a `.sql` file
2. Write your T-SQL query
3. Execute using one of these methods:
   - Click the "Execute Query" button (play icon) in the editor toolbar
   - Use the command palette: `MS SQL Manager: Execute Query`
   - Select text and execute only the selection

### Viewing Results

Query results appear in a dedicated webview panel with features:
- **Sortable columns**: Click column headers to sort
- **Data type handling**: Numbers right-aligned, NULL values styled
- **Export capability**: Export results to CSV format
- **Performance metrics**: View execution time and row counts

### Managing Connections

- **Save connections**: Choose to save connection profiles for reuse
- **Quick connect**: Select from previously saved connections
- **Disconnect**: Use the disconnect button to close active connections
- **Status monitoring**: Check connection status in the status bar

## Extension Commands

| Command | Description |
|---------|-------------|
| `MS SQL Manager: Connect to Database` | Open connection form in webview |
| `MS SQL Manager: Execute Query` | Execute SQL query from active editor |
| `MS SQL Manager: Manage Connections` | Manage saved connection profiles |
| `MS SQL Manager: Refresh` | Refresh schema explorer |
| `Generate SELECT Script` | Create SELECT statement for selected table |



## Architecture

The extension is built with a modular architecture:

- **`extension.ts`**: Main entry point and command registration
- **`connectionProvider.ts`**: Handles SQL Server connections and authentication
- **`schemaTreeProvider.ts`**: Implements the tree view for database schema
- **`queryExecutor.ts`**: Manages T-SQL query execution and error handling
- **`resultWebview.ts`**: Custom webview for displaying query results
- **`webview/resultView.html`**: HTML/CSS/JS for the results interface

## Requirements

- VS Code 1.105.0 or higher
- Node.js and npm for development
- Access to Microsoft SQL Server instance

### For Azure SQL Discovery
- **Azure CLI**: Install and configure Azure CLI (`az login`)
- **Azure Access**: Valid Azure subscription with SQL Server resources
- **Permissions**: Read access to Azure SQL resources in your subscriptions

## Dependencies

- **mssql**: Microsoft SQL Server client for Node.js
- **@types/mssql**: TypeScript definitions for mssql package

## Development

To develop and extend this extension:

1. Clone the repository
2. Install dependencies: `npm install`
3. Start the watch compiler: `npm run watch`
4. Press `F5` to launch the Extension Development Host
5. Make changes and reload the window to test

## Security Notes

- Passwords are never stored permanently
- Connections use encrypted channels by default
- Credentials are only held in memory during active sessions
- All database operations use parameterized queries where applicable

## Troubleshooting

### Connection Issues
- Verify SQL Server is running and accessible
- Check firewall settings and port availability (default: 1433)
- Ensure proper authentication credentials
- Review VS Code Output panel for detailed error messages

### Query Execution Problems
- Verify you're connected to a database
- Check query syntax in SQL Server Management Studio
- Review timeout settings for long-running queries
- Check the Output channel for detailed error information

## Contributing

This extension is built following VS Code extension best practices:
- TypeScript for type safety
- Modular architecture for maintainability
- Comprehensive error handling
- User-friendly interfaces
- Secure credential management

## License

This project is provided as-is for educational and development purposes.

