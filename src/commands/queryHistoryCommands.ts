import * as vscode from 'vscode';
import { QueryHistoryManager, QueryHistoryEntry } from '../queryHistory';
import { QueryHistoryTreeProvider } from '../queryHistoryTreeProvider';
import { UnifiedTreeProvider } from '../unifiedTreeProvider';
import { openSqlInCustomEditor } from '../utils/sqlDocumentHelper';

/**
 * Removes existing execution summary comments from a query.
 * These comments start with "-- Query from history" and include execution metadata.
 */
function removeExistingExecutionComments(query: string): string {
    // Split the query into lines
    const lines = query.split('\n');
    const resultLines: string[] = [];
    let skipComments = false;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Check if this line starts an execution summary comment block
        if (trimmedLine.startsWith('-- Query from history')) {
            skipComments = true;
            continue;
        }
        
        // If we're in a comment block, skip lines that look like execution metadata
        if (skipComments) {
            if (trimmedLine.startsWith('-- Executed:') || 
                trimmedLine.startsWith('-- Connection:') || 
                trimmedLine.startsWith('-- Result Sets:') ||
                trimmedLine === '') { // Also skip empty lines that are part of the comment block
                continue;
            } else {
                // Found a non-comment line, stop skipping
                skipComments = false;
            }
        }
        
        // If we're not skipping, add the line
        if (!skipComments) {
            resultLines.push(line);
        }
    }
    
    // Join the lines back together and trim any trailing whitespace
    return resultLines.join('\n').trimEnd();
}

export function registerQueryHistoryCommands(
    context: vscode.ExtensionContext,
    historyManager: QueryHistoryManager,
    historyTreeProvider: QueryHistoryTreeProvider,
    outputChannel: vscode.OutputChannel,
    unifiedTreeProvider?: UnifiedTreeProvider
): vscode.Disposable[] {
    
    const openQueryFromHistoryCommand = vscode.commands.registerCommand(
        'mssqlManager.openQueryFromHistory',
        async (entry: QueryHistoryEntry) => {
            try {
                outputChannel.appendLine(`[QueryHistory] Opening query from history: ${entry.id}`);
                console.log('[QueryHistory] Opening query from history:', entry.id, entry.query.substring(0, 100) + '...');
                
                // Remove existing execution summary comments before sending
                const cleanQuery = removeExistingExecutionComments(entry.query);

                // Build metadata for the info panel (no longer appended as SQL comments)
                const rowCountsStr = entry.rowCounts.length > 1 
                    ? `(${entry.rowCounts.join(', ')} rows)` 
                    : entry.rowCounts.length === 1 
                        ? `(${entry.rowCounts[0]} rows)` 
                        : '(0 rows)';

                const historyInfo = {
                    executedAt: entry.executedAt.toLocaleString(),
                    connectionName: entry.connectionName,
                    server: entry.server,
                    database: entry.database,
                    resultSetCount: entry.resultSetCount,
                    rowCountsStr,
                    duration: entry.duration,
                };

                await openSqlInCustomEditor(
                    cleanQuery,
                    undefined,
                    context,
                    entry.connectionId,
                    entry.database,
                    undefined,
                    historyInfo
                );

                if (unifiedTreeProvider) {
                    unifiedTreeProvider.refresh();
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
