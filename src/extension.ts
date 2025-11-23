import * as vscode from 'vscode';
import { ConnectionProvider } from './connectionProvider';
import { UnifiedTreeProvider } from './unifiedTreeProvider';
import { QueryExecutor } from './queryExecutor';
import { SqlEditorProvider } from './sqlEditorProvider';
import { QueryHistoryManager } from './queryHistory';
import { QueryHistoryTreeProvider } from './queryHistoryTreeProvider';
import { registerAllCommands } from './commands';
import { initializeAzureFirewallHelper } from './utils/azureFirewallHelper';

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('MS SQL Manager');
    outputChannel.appendLine('MS SQL Manager extension activated');

    // Initialize Azure firewall helper with extension context
    initializeAzureFirewallHelper(context);


    // Initialize providers
    const connectionProvider = new ConnectionProvider(context, outputChannel);
    const unifiedTreeProvider = new UnifiedTreeProvider(connectionProvider, outputChannel);

    // Run one-time local server discovery for Windows users
    try {
        await connectionProvider.discoverLocalServersOnce();
    } catch (err) {
        outputChannel.appendLine(`[Extension] Local discovery error: ${err}`);
    }
    
    // Run one-time Azure SQL server discovery
    try {
        await connectionProvider.discoverAzureServersOnce();
    } catch (err) {
        outputChannel.appendLine(`[Extension] Azure discovery error: ${err}`);
    }
    
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
    connectionProvider.addConnectionChangeCallback(() => {
        outputChannel.appendLine('[Extension] Connection changed, refreshing tree view');
        unifiedTreeProvider.refresh();
    });

    // Register tree data provider and create tree view with drag and drop support
    const treeView = vscode.window.createTreeView('mssqlManager.explorer', {
        treeDataProvider: unifiedTreeProvider,
        dragAndDropController: unifiedTreeProvider
    });
    context.subscriptions.push(treeView);

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
        historyTreeProvider,
        sqlEditorProvider
    );

    // Add output channel to subscriptions
    context.subscriptions.push(outputChannel);
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.appendLine('MS SQL Manager extension deactivated');
        outputChannel.dispose();
    }
    
}
