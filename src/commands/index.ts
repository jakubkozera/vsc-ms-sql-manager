import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider } from '../unifiedTreeProvider';
import { QueryExecutor } from '../queryExecutor';
import { registerConnectionCommands } from './connectionCommands';
import { registerQueryCommands } from './queryCommands';
import { registerTableCommands } from './tableCommands';
import { registerStoredProcedureCommands } from './storedProcedureCommands';

export function registerAllCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    unifiedTreeProvider: UnifiedTreeProvider,
    queryExecutor: QueryExecutor,
    outputChannel: vscode.OutputChannel,
    treeView?: vscode.TreeView<any>
): void {
    const refreshCommand = vscode.commands.registerCommand('mssqlManager.refresh', () => {
        outputChannel.appendLine('[Extension] Refreshing tree view');
        unifiedTreeProvider.refresh();
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

    context.subscriptions.push(
        refreshCommand,
        ...connectionCommands,
        ...queryCommands,
        ...tableCommands,
        ...storedProcedureCommands
    );

    outputChannel.appendLine('MS SQL Manager commands registered successfully');
}
