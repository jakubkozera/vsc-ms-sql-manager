import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider } from '../unifiedTreeProvider';
import { QueryExecutor } from '../queryExecutor';
import { ResultWebviewProvider } from '../resultWebview';
import { registerConnectionCommands } from './connectionCommands';
import { registerQueryCommands } from './queryCommands';
import { registerTableCommands } from './tableCommands';
import { registerStoredProcedureCommands } from './storedProcedureCommands';

export function registerAllCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    unifiedTreeProvider: UnifiedTreeProvider,
    queryExecutor: QueryExecutor,
    resultWebviewProvider: ResultWebviewProvider,
    outputChannel: vscode.OutputChannel
): void {
    const refreshCommand = vscode.commands.registerCommand('mssqlManager.refresh', () => {
        outputChannel.appendLine('[Extension] Refreshing tree view');
        unifiedTreeProvider.refresh();
    });

    const connectionCommands = registerConnectionCommands(
        context,
        connectionProvider,
        unifiedTreeProvider,
        outputChannel
    );

    const queryCommands = registerQueryCommands(
        context,
        connectionProvider,
        queryExecutor,
        resultWebviewProvider,
        outputChannel
    );

    const tableCommands = registerTableCommands(
        context,
        connectionProvider,
        unifiedTreeProvider,
        resultWebviewProvider,
        outputChannel
    );

    const storedProcedureCommands = registerStoredProcedureCommands(
        context,
        connectionProvider,
        resultWebviewProvider,
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
