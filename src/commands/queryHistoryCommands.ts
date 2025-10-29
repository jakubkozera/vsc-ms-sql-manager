import * as vscode from 'vscode';
import * as path from 'path';
import { QueryHistoryManager, QueryHistoryEntry } from '../queryHistory';
import { QueryHistoryTreeProvider } from '../queryHistoryTreeProvider';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider } from '../unifiedTreeProvider';
import { openSqlInCustomEditor } from '../utils/sqlDocumentHelper';

export function registerQueryHistoryCommands(
    context: vscode.ExtensionContext,
    historyManager: QueryHistoryManager,
    historyTreeProvider: QueryHistoryTreeProvider,
    connectionProvider: ConnectionProvider,
    outputChannel: vscode.OutputChannel,
    unifiedTreeProvider?: UnifiedTreeProvider
): vscode.Disposable[] {
    
    const openQueryFromHistoryCommand = vscode.commands.registerCommand(
        'mssqlManager.openQueryFromHistory',
        async (entry: QueryHistoryEntry) => {
            try {
                outputChannel.appendLine(`[QueryHistory] Opening query from history: ${entry.id}`);
                
                // Create header with metadata
                const rowCountsStr = entry.rowCounts.length > 1 
                    ? `(${entry.rowCounts.join(', ')} rows)` 
                    : entry.rowCounts.length === 1 
                        ? `(${entry.rowCounts[0]} rows)` 
                        : '(0 rows)';
                const header = `\n\n-- Query from history\n-- Executed: ${entry.executedAt.toLocaleString()}\n-- Connection: ${entry.connectionName} (${entry.server}/${entry.database})\n-- Result Sets: ${entry.resultSetCount} ${rowCountsStr}`;
                
                // Combine query with header at the end
                const fullContent = entry.query + header;

                // Set preferred database for next editor so the SQL editor will initialize
                // with the same connection+database that the query was executed on.
                try {
                    if (entry.connectionId && entry.database) {
                        connectionProvider.setNextEditorPreferredDatabase(entry.connectionId, entry.database);
                        outputChannel.appendLine(`[QueryHistory] Preferred DB set for next editor: ${entry.connectionId} -> ${entry.database}`);
                    }
                } catch (err) {
                    outputChannel.appendLine(`[QueryHistory] Failed to set preferred DB for next editor: ${err}`);
                }

                // Open in custom SQL editor
                await openSqlInCustomEditor(fullContent, 'history.sql', context);

                // Try to connect to the same connection if it exists
                try {
                    outputChannel.appendLine(`[QueryHistory] Attempting to connect to: ${entry.connectionId}`);
                    
                    // Check if already connected to this connection
                    if (!connectionProvider.isConnectionActive(entry.connectionId)) {
                        await connectionProvider.connectToSavedById(entry.connectionId);
                        // Ensure this connection is set as the active connection
                        connectionProvider.setActiveConnection(entry.connectionId);
                        vscode.window.showInformationMessage(`Connected to ${entry.connectionName}`);

                        // Refresh the database explorer tree view on successful connection
                        if (unifiedTreeProvider) {
                            outputChannel.appendLine('[QueryHistory] Refreshing database explorer tree view');
                            unifiedTreeProvider.refresh();
                        }
                    } else {
                        // If already connected, make it active so editor/schema requests target it
                        connectionProvider.setActiveConnection(entry.connectionId);
                        outputChannel.appendLine(`[QueryHistory] Already connected to ${entry.connectionId}, set as active`);
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    vscode.window.showWarningMessage(
                        `Query loaded, but could not connect to ${entry.connectionName}: ${errorMsg}`
                    );
                    outputChannel.appendLine(`[QueryHistory] Connection failed: ${errorMsg}`);
                }

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                vscode.window.showErrorMessage(`Failed to open query from history: ${errorMessage}`);
                outputChannel.appendLine(`[QueryHistory] Open query failed: ${errorMessage}`);
            }
        }
    );

    const clearQueryHistoryCommand = vscode.commands.registerCommand(
        'mssqlManager.clearQueryHistory',
        async () => {
            try {
                const confirm = await vscode.window.showWarningMessage(
                    'Are you sure you want to clear all query history?',
                    { modal: true },
                    'Clear All'
                );

                if (confirm === 'Clear All') {
                    historyManager.clearHistory();
                    vscode.window.showInformationMessage('Query history cleared');
                    outputChannel.appendLine('[QueryHistory] History cleared');
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                vscode.window.showErrorMessage(`Failed to clear history: ${errorMessage}`);
                outputChannel.appendLine(`[QueryHistory] Clear history failed: ${errorMessage}`);
            }
        }
    );

    const deleteQueryHistoryItemCommand = vscode.commands.registerCommand(
        'mssqlManager.deleteQueryHistoryItem',
        async (item: any) => {
            try {
                if (!item || !item.entry) {
                    vscode.window.showErrorMessage('Invalid history item');
                    return;
                }

                // Prevent deleting a pinned entry directly - require unpin first
                const entry = historyManager.getEntry ? historyManager.getEntry(item.entry.id) : undefined;
                if (entry && entry.pinned) {
                    const confirm = await vscode.window.showWarningMessage(
                        'This entry is pinned. Unpin it before deleting. Unpin now?',
                        { modal: false },
                        'Unpin'
                    );
                    if (confirm === 'Unpin') {
                        historyManager.setPinned(item.entry.id, false);
                        outputChannel.appendLine(`[QueryHistory] Unpinned history item before delete: ${item.entry.id}`);
                        // now delete
                        historyManager.deleteEntry(item.entry.id);
                        outputChannel.appendLine(`[QueryHistory] Deleted history item: ${item.entry.id}`);
                    } else {
                        return;
                    }
                } else {
                    historyManager.deleteEntry(item.entry.id);
                    outputChannel.appendLine(`[QueryHistory] Deleted history item: ${item.entry.id}`);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                vscode.window.showErrorMessage(`Failed to delete history item: ${errorMessage}`);
                outputChannel.appendLine(`[QueryHistory] Delete item failed: ${errorMessage}`);
            }
        }
    );

    const pinQueryHistoryItemCommand = vscode.commands.registerCommand(
        'mssqlManager.pinQueryHistoryItem',
        async (item: any) => {
            try {
                if (!item || !item.entry) {
                    vscode.window.showErrorMessage('Invalid history item');
                    return;
                }
                historyManager.setPinned(item.entry.id, true);
                outputChannel.appendLine(`[QueryHistory] Pinned history item: ${item.entry.id}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                vscode.window.showErrorMessage(`Failed to pin history item: ${errorMessage}`);
                outputChannel.appendLine(`[QueryHistory] Pin item failed: ${errorMessage}`);
            }
        }
    );

    const unpinQueryHistoryItemCommand = vscode.commands.registerCommand(
        'mssqlManager.unpinQueryHistoryItem',
        async (item: any) => {
            try {
                if (!item || !item.entry) {
                    vscode.window.showErrorMessage('Invalid history item');
                    return;
                }
                historyManager.setPinned(item.entry.id, false);
                outputChannel.appendLine(`[QueryHistory] Unpinned history item: ${item.entry.id}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                vscode.window.showErrorMessage(`Failed to unpin history item: ${errorMessage}`);
                outputChannel.appendLine(`[QueryHistory] Unpin item failed: ${errorMessage}`);
            }
        }
    );

    const renameQueryHistoryItemCommand = vscode.commands.registerCommand(
        'mssqlManager.renameQueryHistoryItem',
        async (item: any) => {
            try {
                if (!item || !item.entry) {
                    vscode.window.showErrorMessage('Invalid history item');
                    return;
                }

                const currentTitle = historyManager.getEntry ? historyManager.getEntry(item.entry.id)?.title : undefined;
                const placeHolder = currentTitle || item.entry.query.split('\n')[0].substring(0, 100);

                const newTitle = await vscode.window.showInputBox({
                    prompt: 'Enter new title for this history entry (leave empty to clear)',
                    placeHolder,
                    value: currentTitle || ''
                });

                // If user cancelled, newTitle will be undefined
                if (typeof newTitle === 'undefined') return;

                // Update title (allow empty to clear)
                historyManager.renameEntry(item.entry.id, newTitle && newTitle.trim().length > 0 ? newTitle.trim() : undefined);
                outputChannel.appendLine(`[QueryHistory] Renamed history item: ${item.entry.id} -> ${newTitle}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                vscode.window.showErrorMessage(`Failed to rename history item: ${errorMessage}`);
                outputChannel.appendLine(`[QueryHistory] Rename item failed: ${errorMessage}`);
            }
        }
    );

    const refreshQueryHistoryCommand = vscode.commands.registerCommand(
        'mssqlManager.refreshQueryHistory',
        () => {
            historyTreeProvider.refresh();
            outputChannel.appendLine('[QueryHistory] History refreshed');
        }
    );

    const toggleQueryHistoryGroupingCommand = vscode.commands.registerCommand(
        'mssqlManager.toggleQueryHistoryGrouping',
        async () => {
            const currentMode = historyTreeProvider.getGroupingMode();
            
            const options = [
                { label: 'No Grouping', value: 'none' as const, description: currentMode === 'none' ? '✓ Currently selected' : '' },
                { label: 'Group by Database', value: 'database' as const, description: currentMode === 'database' ? '✓ Currently selected' : '' }
            ];

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: 'Select query history grouping mode'
            });

            if (selected) {
                historyTreeProvider.setGroupingMode(selected.value);
                outputChannel.appendLine(`[QueryHistory] Grouping mode changed to: ${selected.value}`);
            }
        }
    );

    return [
        openQueryFromHistoryCommand,
        clearQueryHistoryCommand,
        deleteQueryHistoryItemCommand,
        pinQueryHistoryItemCommand,
        unpinQueryHistoryItemCommand,
        renameQueryHistoryItemCommand,
        refreshQueryHistoryCommand,
        toggleQueryHistoryGroupingCommand
    ];
}
