# ms-sql-manager README

This is the README for your extension "ms-sql-manager". After writing up a brief description, we recommend including the following sections.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

# MS SQL Manager for VS Code

A comprehensive VS Code extension for managing Microsoft SQL Server databases with connection management, schema browsing, and query execution capabilities.

## Features

### 🔌 Connection Management
- **Interactive Connection Form**: Dedicated webview form for creating connections
- **Connection Testing**: Test connections before saving them
- **Multiple Authentication Types**: SQL Server Auth, Windows Auth, Azure AD support
- **Connection Profiles**: Save and reuse connection configurations
- **Secure Credentials**: Passwords not stored, prompted when needed
- **Status Indicator**: Real-time connection status in VS Code status bar
- **Quick Connect**: Manage and connect to saved connections

### 🌳 Schema Explorer
- Browse connected SQL Server instances
- Navigate databases, tables, views, stored procedures, and functions
- Tree view in VS Code sidebar
- Right-click context menus for quick actions

### ⚡ Query Execution
- Execute T-SQL queries from `.sql` files
- Run selected text or entire file
- Support for multiple statement execution (GO statements)
- Real-time query progress indication

### 📊 Results Viewer
- Custom webview for displaying query results
- Sortable columns with visual indicators
- Support for NULL values and different data types
- Export results to CSV
- Execution time and row count statistics

### 🛠️ Additional Features
- Generate SELECT scripts for tables
- Comprehensive error handling and logging
- Output channel for debugging and monitoring
- TypeScript implementation with full type safety

## Installation

1. Clone or download this extension
2. Install dependencies: `pnpm install`
3. Compile the extension: `pnpm run compile`
4. Press `F5` to launch a new VS Code window with the extension loaded

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

## Configuration

The extension supports these VS Code settings:

```json
{
  "mssqlManager.connections": [],
  "mssqlManager.queryTimeout": 30000
}
```

- `connections`: Array of saved connection profiles (managed automatically)
- `queryTimeout`: Query execution timeout in milliseconds (default: 30 seconds)

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
- Node.js and npm/pnpm for development
- Access to Microsoft SQL Server instance

## Dependencies

- **mssql**: Microsoft SQL Server client for Node.js
- **@types/mssql**: TypeScript definitions for mssql package

## Development

To develop and extend this extension:

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Start the watch compiler: `pnpm run watch`
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

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
