import * as vscode from 'vscode';
import { ConnectionProvider } from './connectionProvider';
import { UnifiedTreeProvider } from './unifiedTreeProvider';
import { QueryExecutor } from './queryExecutor';
import { SqlEditorProvider } from './sqlEditorProvider';
import { QueryHistoryManager } from './queryHistory';
import { QueryHistoryTreeProvider } from './queryHistoryTreeProvider';
import { registerAllCommands } from './commands';
import { initializeAzureFirewallHelper } from './utils/azureFirewallHelper';
import { SqlChatHandler } from './sqlChatHandler';
import { SchemaContextBuilder } from './schemaContextBuilder';
import { DatabaseInstructionsManager } from './databaseInstructions';

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('MS SQL Manager');
    
    // Check if extension should activate immediately or wait for SQL files
    const config = vscode.workspace.getConfiguration('mssqlManager');
    const immediateActive = config.get<boolean>('immediateActive', true);
    
    // If immediateActive is false, check if we have any SQL files open
    if (!immediateActive) {
        const hasSqlFiles = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .some(tab => tab.input instanceof vscode.TabInputText && 
                        tab.input.uri.fsPath.toLowerCase().endsWith('.sql'));
        
        if (!hasSqlFiles) {
            outputChannel.appendLine('MS SQL Manager: Waiting for SQL files to be opened (immediateActive = false)');
            
            // Register a listener for when SQL files are opened
            const disposable = vscode.workspace.onDidOpenTextDocument((document) => {
                if (document.languageId === 'sql') {
                    outputChannel.appendLine('SQL file opened, activating MS SQL Manager');
                    disposable.dispose();
                    initializeExtension(context);
                }
            });
            
            context.subscriptions.push(disposable);
            return;
        }
    }
    
    outputChannel.appendLine('MS SQL Manager extension activated');
    await initializeExtension(context);
}

async function initializeExtension(context: vscode.ExtensionContext) {
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
    
    // Initialize schema context builder for chat and background schema generation
    const schemaContextBuilder = new SchemaContextBuilder(connectionProvider, outputChannel, context);
    outputChannel.appendLine('[Extension] Schema context builder initialized');
    
    // Initialize database instructions manager
    const databaseInstructionsManager = new DatabaseInstructionsManager(context, outputChannel);
    outputChannel.appendLine('[Extension] Database instructions manager initialized');
    context.subscriptions.push(databaseInstructionsManager);
    
    // Pass database instructions manager to tree provider
    unifiedTreeProvider.setDatabaseInstructionsManager(databaseInstructionsManager);
    
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
        sqlEditorProvider,
        schemaContextBuilder,
        databaseInstructionsManager
    );

    // Register developer command to refresh SQL snippets
    context.subscriptions.push(
        vscode.commands.registerCommand('mssqlManager.refreshSnippets', () => {
            outputChannel.appendLine('[Extension] Refreshing SQL snippets manually...');
            sqlEditorProvider.refreshSnippets();
            vscode.window.showInformationMessage('SQL snippets refreshed successfully!');
        })
    );

    // Add output channel to subscriptions
    context.subscriptions.push(outputChannel);

    // Register chat participant
    try {
        const sqlChatHandler = new SqlChatHandler(context, connectionProvider, outputChannel, databaseInstructionsManager);
        
        // Create chat participant with proper ID from package.json
        const chatParticipant = vscode.chat.createChatParticipant('ms-sql-manager.sql', sqlChatHandler.handleChatRequest.bind(sqlChatHandler));
        chatParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'database-dark.svg');
        
        // Set up follow-up provider
        chatParticipant.followupProvider = {
            provideFollowups(result: vscode.ChatResult, context: vscode.ChatContext, token: vscode.CancellationToken) {
                return [
                    {
                        prompt: 'explain this query in detail',
                        label: '📖 Explain Query'
                    },
                    {
                        prompt: 'optimize this query for better performance',
                        label: '⚡ Optimize Query'
                    },
                    {
                        prompt: 'suggest indexes for this query',
                        label: '🗂️ Suggest Index'
                    },
                    {
                        prompt: 'show me the table schema',
                        label: '🏗️ Show Schema'
                    }
                ];
            }
        };
        
        context.subscriptions.push(chatParticipant);
        
        // Register chat-related commands
        const executeChatQueryCommand = vscode.commands.registerCommand(
            'mssqlManager.executeChatGeneratedQuery',
            async (sql: string, connectionContext: any, request?: any, stream?: any) => {
                try {
                    // Execute query in SQL editor (opens editor and runs query)
                    await sqlChatHandler.executeQueryInEditorFromChat(sql, connectionContext);
                } catch (error) {
                    const errorMsg = `Failed to execute query: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    vscode.window.showErrorMessage(errorMsg);
                }
            }
        );
        
        const insertChatQueryCommand = vscode.commands.registerCommand(
            'mssqlManager.insertChatGeneratedQuery',
            async (sql: string, connectionContext?: any) => {
                try {
                    await sqlChatHandler.insertQueryToEditor(sql, connectionContext);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to insert query: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        );
        
        const openChatCommand = vscode.commands.registerCommand(
            'mssqlManager.openSqlChat',
            async (connectionId?: string, database?: string) => {
                // Open chat and set context if provided
                await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                if (connectionId) {
                    // We could enhance this to pre-set connection context
                    vscode.window.showInformationMessage('Chat opened. Use @sql to interact with your database.');
                }
            }
        );
        
        context.subscriptions.push(executeChatQueryCommand, insertChatQueryCommand, openChatCommand);
        
        outputChannel.appendLine('SQL Chat participant registered successfully');
    } catch (error) {
        outputChannel.appendLine(`Failed to register chat participant: ${error}`);
        // Don't fail the extension if chat isn't available
    }
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.appendLine('MS SQL Manager extension deactivated');
        outputChannel.dispose();
    }
    
}
