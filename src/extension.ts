import * as vscode from 'vscode';
import { ConnectionProvider } from './connectionProvider';
import { UnifiedTreeProvider } from './unifiedTreeProvider';
import { QueryExecutor } from './queryExecutor';
import { SqlEditorProvider } from './sqlEditorProvider';
import { registerAllCommands } from './commands';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('MS SQL Manager');
    outputChannel.appendLine('MS SQL Manager extension activated');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = "$(database) Not Connected";
    statusBarItem.tooltip = "MS SQL Manager - No active connection";
    statusBarItem.show();

    // Initialize providers
    const connectionProvider = new ConnectionProvider(context, outputChannel, statusBarItem);
    const unifiedTreeProvider = new UnifiedTreeProvider(connectionProvider, outputChannel);
    const queryExecutor = new QueryExecutor(connectionProvider, outputChannel);
    
    // Register SQL custom editor provider
    const sqlEditorProvider = new SqlEditorProvider(context, queryExecutor, connectionProvider, outputChannel);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            SqlEditorProvider.viewType,
            sqlEditorProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // Set up connection change callback
    connectionProvider.setConnectionChangeCallback(() => {
        outputChannel.appendLine('[Extension] Connection changed, refreshing tree view');
        unifiedTreeProvider.refresh();
    });

    // Register tree data provider
    vscode.window.registerTreeDataProvider('mssqlManager.explorer', unifiedTreeProvider);

    // Register file decoration provider
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(unifiedTreeProvider)
    );

    // Register all commands
    registerAllCommands(
        context,
        connectionProvider,
        unifiedTreeProvider,
        queryExecutor,
        outputChannel
    );

    // Add output channel and status bar to subscriptions
    context.subscriptions.push(outputChannel, statusBarItem);
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.appendLine('MS SQL Manager extension deactivated');
        outputChannel.dispose();
    }
    
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
