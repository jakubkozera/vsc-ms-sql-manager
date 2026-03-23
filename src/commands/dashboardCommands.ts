import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { QueryExecutor } from '../queryExecutor';
import { DashboardWebview } from '../dashboardWebview';

export function registerDashboardCommands(
    context: vscode.ExtensionContext,
    connectionProvider: ConnectionProvider,
    queryExecutor: QueryExecutor,
    outputChannel: vscode.OutputChannel
): vscode.Disposable[] {
    const dashboardWebview = new DashboardWebview(context, connectionProvider, queryExecutor, outputChannel);

    const openDashboards = vscode.commands.registerCommand(
        'mssqlManager.openDashboards',
        async (node?: any) => {
            let connectionId: string | undefined;
            let serverName: string | undefined;
            let database: string | undefined;

            if (node?.connectionId) {
                connectionId = node.connectionId as string;
                database = node.database as string | undefined;

                const config = connectionProvider.getConnectionConfig(connectionId);
                if (config) {
                    serverName = config.server ?? config.name ?? connectionId;
                    // For DatabaseNode, database is already set
                    if (!database && config.database) {
                        database = config.database;
                    }
                }
            }

            if (!connectionId) {
                const active = connectionProvider.getActiveConnectionInfo();
                if (active) {
                    connectionId = active.id;
                    const config = connectionProvider.getConnectionConfig(connectionId);
                    serverName = config?.server ?? config?.name ?? connectionId;
                    database = config?.database;
                }
            }

            if (!connectionId) {
                vscode.window.showErrorMessage('Please select an active connection or database from the explorer');
                return;
            }

            dashboardWebview.show(connectionId, serverName ?? connectionId, database);
        }
    );

    return [openDashboards];
}
