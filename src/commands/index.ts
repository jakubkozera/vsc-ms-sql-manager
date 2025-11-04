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

export function registerAllCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    unifiedTreeProvider: UnifiedTreeProvider,
    queryExecutor: QueryExecutor,
    outputChannel: vscode.OutputChannel,
    treeView?: vscode.TreeView<any>,
    historyManager?: QueryHistoryManager,
    historyTreeProvider?: QueryHistoryTreeProvider
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
        treeView
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

    const allCommands = [
        refreshCommand,
        refreshNodeCommand,
        ...connectionCommands,
        ...queryCommands,
        ...tableCommands,
        ...storedProcedureCommands
    ];

    // Register query history commands if available
    if (historyManager && historyTreeProvider) {
        const historyCommands = registerQueryHistoryCommands(
            context,
            historyManager,
            historyTreeProvider,
            connectionProvider,
            outputChannel,
            unifiedTreeProvider
        );
        allCommands.push(...historyCommands);
    }

    context.subscriptions.push(...allCommands);

    outputChannel.appendLine('MS SQL Manager commands registered successfully');
}
