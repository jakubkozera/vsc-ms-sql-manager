import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider } from '../unifiedTreeProvider';
import { QueryExecutor } from '../queryExecutor';
import { QueryHistoryManager } from '../queryHistory';
import { QueryHistoryTreeProvider } from '../queryHistoryTreeProvider';
import { registerConnectionCommands } from './connectionCommands';
import { registerQueryCommands } from './queryCommands';
import { registerTableCommands } from './tableCommands';
import { registerStoredProcedureCommands } from './storedProcedureCommands';
import { registerQueryHistoryCommands } from './queryHistoryCommands';
import { registerDatabaseCommands } from './databaseCommands';
import { registerScriptGenerationCommands } from './scriptGenerationCommands';
import { registerSchemaCacheCommands } from './schemaCacheCommands';
import { SqlEditorProvider } from '../sqlEditorProvider';
import { SchemaContextBuilder } from '../schemaContextBuilder';
import { DatabaseInstructionsManager } from '../databaseInstructions';

export function registerAllCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    unifiedTreeProvider: UnifiedTreeProvider,
    queryExecutor: QueryExecutor,
    outputChannel: vscode.OutputChannel,
    treeView?: vscode.TreeView<any>,
    historyManager?: QueryHistoryManager,
    historyTreeProvider?: QueryHistoryTreeProvider,
    sqlEditorProvider?: SqlEditorProvider,
    schemaContextBuilder?: SchemaContextBuilder,
    databaseInstructionsManager?: DatabaseInstructionsManager
): void {
    const refreshCommand = vscode.commands.registerCommand('mssqlManager.refresh', () => {
        outputChannel.appendLine('[Extension] Refreshing tree view');
        unifiedTreeProvider.refresh();
    });

    const refreshNodeCommand = vscode.commands.registerCommand('mssqlManager.refreshNode', (node?: any) => {
        outputChannel.appendLine(`[Extension] Refreshing node: ${node?.label || 'root'}`);
        unifiedTreeProvider.refreshNode(node);
    });

    const connectionCommands = registerConnectionCommands(
        context,
        connectionProvider,
        unifiedTreeProvider,
        outputChannel,
        treeView,
        sqlEditorProvider,
        schemaContextBuilder,
        databaseInstructionsManager
    );

    const queryCommands = registerQueryCommands(
        context,
        connectionProvider,
        queryExecutor,
        outputChannel
    );

    const tableCommands = registerTableCommands(
        context,
        connectionProvider,
        unifiedTreeProvider,
        outputChannel
    );

    const storedProcedureCommands = registerStoredProcedureCommands(
        context,
        connectionProvider,
        outputChannel
    );

    const databaseCommands = registerDatabaseCommands(
        context,
        connectionProvider,
        outputChannel,
        unifiedTreeProvider
    );

    const scriptGenerationCommands = registerScriptGenerationCommands(
        context,
        connectionProvider,
        outputChannel
    );

    // Register schema cache management commands
    registerSchemaCacheCommands(context, connectionProvider, outputChannel);

    const allCommands = [
        refreshCommand,
        refreshNodeCommand,
        ...connectionCommands,
        ...queryCommands,
        ...tableCommands,
        ...storedProcedureCommands,
        ...databaseCommands,
        ...scriptGenerationCommands
    ];

    // Register query history commands if available
    if (historyManager && historyTreeProvider) {
        const historyCommands = registerQueryHistoryCommands(
            context,
            historyManager,
            historyTreeProvider,
            connectionProvider,
            outputChannel,
            unifiedTreeProvider,
            sqlEditorProvider
        );
        allCommands.push(...historyCommands);
    }

    context.subscriptions.push(...allCommands);

    outputChannel.appendLine('MS SQL Manager commands registered successfully');
}
