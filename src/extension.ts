import * as vscode from 'vscode';
import { ConnectionProvider } from './connectionProvider';
import { UnifiedTreeProvider } from './unifiedTreeProvider';
import { QueryExecutor } from './queryExecutor';
import { SqlEditorProvider } from './sqlEditorProvider';
import { QueryHistoryManager } from './queryHistory';
import { QueryHistoryTreeProvider } from './queryHistoryTreeProvider';
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
    
    // Initialize query history
    outputChannel.appendLine('[Extension] Initializing query history...');
    const historyManager = new QueryHistoryManager(context);
    const historyTreeProvider = new QueryHistoryTreeProvider(historyManager, outputChannel);
    outputChannel.appendLine('[Extension] Query history initialized');
    
    // Initialize query executor with history manager
    const queryExecutor = new QueryExecutor(connectionProvider, outputChannel, historyManager);
    outputChannel.appendLine('[Extension] Query executor initialized with history manager');
    
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

    // Register tree data provider and create tree view
    const treeView = vscode.window.createTreeView('mssqlManager.explorer', {
        treeDataProvider: unifiedTreeProvider
    });
    context.subscriptions.push(treeView);
    
    // Set tree view reference in provider for collapse operations
    unifiedTreeProvider.setTreeView(treeView);

    // Register query history tree view
    const historyTreeView = vscode.window.createTreeView('mssqlManager.queryHistory', {
        treeDataProvider: historyTreeProvider
    });
    context.subscriptions.push(historyTreeView);
    outputChannel.appendLine('[Extension] Query history tree view registered');

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
        outputChannel,
        treeView,
        historyManager,
        historyTreeProvider
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
