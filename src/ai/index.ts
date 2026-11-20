import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { SchemaContextBuilder } from '../schemaContextBuilder';
import { DatabaseInstructionsManager } from '../databaseInstructions';
import { DatabaseToolsService } from './databaseToolsService';
import { registerLanguageModelTools } from './languageModelTools';
import { McpConnectWebview } from './mcpConnectWebview';
import { MCP_DEFAULT_PORT, SqlMcpHttpServer } from './mcpServer';
import { TargetHint } from './sqlAgentCore';

interface AiIntegrationDeps {
    connectionProvider: ConnectionProvider;
    schemaContextBuilder: SchemaContextBuilder;
    databaseInstructionsManager: DatabaseInstructionsManager;
    outputChannel: vscode.OutputChannel;
    getEditorHint: () => TargetHint | undefined;
}

const getMcpSettings = () => {
    const config = vscode.workspace.getConfiguration('mssqlManager.mcp');
    return {
        enabled: config.get<boolean>('enabled', false),
        port: config.get<number>('port', MCP_DEFAULT_PORT)
    };
};

/**
 * Registers the Copilot language model tools (VS Code only) and the local MCP server
 * (any MCP client). Both share {@link DatabaseToolsService}.
 */
export function registerAiIntegrations(context: vscode.ExtensionContext, deps: AiIntegrationDeps): DatabaseToolsService {
    const { outputChannel } = deps;
    const service = new DatabaseToolsService(
        deps.connectionProvider,
        deps.schemaContextBuilder,
        deps.databaseInstructionsManager,
        outputChannel,
        deps.getEditorHint
    );

    try {
        registerLanguageModelTools(context, service);
        outputChannel.appendLine('[AI] Language model tools registered');
    } catch (error) {
        outputChannel.appendLine(`[AI] Language model tools unavailable: ${error}`);
    }

    const version = (context.extension?.packageJSON as { version?: string } | undefined)?.version ?? '0.0.0';
    const mcpServer = new SqlMcpHttpServer(context.secrets, service, outputChannel, version);
    const mcpConnectWebview = new McpConnectWebview(context.extensionUri, outputChannel);
    context.subscriptions.push(mcpServer, mcpConnectWebview);

    let activePort: number | undefined;
    let pendingSettings = Promise.resolve();
    const applyMcpSettings = (): Promise<void> => {
        // Enabling MCP from the copy action also triggers the settings listener.
        pendingSettings = pendingSettings.then(syncMcpSettings);
        return pendingSettings;
    };

    async function syncMcpSettings(): Promise<void> {
        const { enabled, port } = getMcpSettings();
        if (enabled && mcpServer.isRunning && activePort === port) {
            return;
        }
        try {
            await mcpServer.stop();
            activePort = undefined;
            if (enabled) {
                await mcpServer.start(port);
                activePort = port;
            }
        } catch (error) {
            const message = enabled
                ? `MS SQL Manager MCP server could not start on port ${port}: ${error instanceof Error ? error.message : error}. Change "mssqlManager.mcp.port" and try again.`
                : `MS SQL Manager MCP server could not stop: ${error instanceof Error ? error.message : error}.`;
            outputChannel.appendLine(`[MCP] ${message}`);
            vscode.window.showErrorMessage(message);
        }
    }

    void applyMcpSettings();

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('mssqlManager.mcp')) {
                void applyMcpSettings();
            }
        }),

        vscode.commands.registerCommand('mssqlManager.connectMcp', () => mcpConnectWebview.show()),

        vscode.commands.registerCommand('mssqlManager.copyMcpConfig', async () => {
            if (!getMcpSettings().enabled) {
                const choice = await vscode.window.showInformationMessage(
                    'The MS SQL Manager MCP server is disabled. Enable it so MCP clients (Claude, Cursor, Copilot CLI, ...) can use your connections?',
                    { modal: true },
                    'Enable'
                );
                if (choice !== 'Enable') {
                    return;
                }
                await vscode.workspace.getConfiguration('mssqlManager.mcp').update('enabled', true, vscode.ConfigurationTarget.Global);
            }
            if (!getMcpSettings().enabled) {
                vscode.window.showErrorMessage('MCP is still disabled. Check for an override in your workspace settings.');
                return;
            }
            await applyMcpSettings();
            if (!mcpServer.isRunning) {
                return;
            }
            await vscode.env.clipboard.writeText(await mcpServer.getClientConfig());
            vscode.window.showInformationMessage(
                `MCP server configuration copied to clipboard (${mcpServer.url}). It contains an access token — do not share it. The server runs while VS Code is open.`
            );
        }),

        vscode.commands.registerCommand('mssqlManager.openSqlChat', async (node?: { connectionId?: string; database?: string }) => {
            let query = '';
            if (node?.connectionId) {
                service.setPreferredTarget({ connectionId: node.connectionId, database: node.database });
                const config = deps.connectionProvider.getConnectionConfig(node.connectionId);
                const database = node.database ?? (config?.connectionType === 'database' ? config.database : undefined);
                query = database ? `#mssqlSchema (database: ${database}) ` : '#mssqlSchema ';
            }
            try {
                await vscode.commands.executeCommand('workbench.action.chat.open', { query, isPartialQuery: true, mode: 'agent' });
            } catch {
                await vscode.commands.executeCommand('workbench.action.chat.open');
            }
        })
    );

    return service;
}
