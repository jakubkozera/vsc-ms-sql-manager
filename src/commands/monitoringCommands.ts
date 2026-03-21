import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { QueryExecutor } from '../queryExecutor';
import { PerformanceDashboardWebview } from '../performanceDashboardWebview';

export function registerMonitoringCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    queryExecutor: QueryExecutor,
    outputChannel: vscode.OutputChannel
): vscode.Disposable[] {
    const performanceDashboard = new PerformanceDashboardWebview(
        context,
        connectionProvider,
        queryExecutor,
        outputChannel
    );

    const openPerformanceDashboardCommand = vscode.commands.registerCommand(
        'mssqlManager.openPerformanceDashboard',
        (node?: { connectionId?: string }) => {
            performanceDashboard.show(node?.connectionId);
        }
    );

    return [openPerformanceDashboardCommand];
}
