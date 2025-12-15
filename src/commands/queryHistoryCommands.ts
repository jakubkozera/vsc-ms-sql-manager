import * as vscode from 'vscode';
import * as path from 'path';
import { QueryHistoryManager, QueryHistoryEntry } from '../queryHistory';
import { QueryHistoryTreeProvider } from '../queryHistoryTreeProvider';
import { ConnectionProvider } from '../connectionProvider';
import { UnifiedTreeProvider } from '../unifiedTreeProvider';
import { openSqlInCustomEditor } from '../utils/sqlDocumentHelper';
import { SqlEditorProvider } from '../sqlEditorProvider';

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

// Helper function to find and update existing history.sql editor
function tryUpdateExistingHistoryEditor(
    entry: QueryHistoryEntry,
    sqlEditorProvider: SqlEditorProvider | undefined,
    outputChannel: vscode.OutputChannel
): boolean {
    if (!sqlEditorProvider) {
        outputChannel.appendLine(`[QueryHistory] SqlEditorProvider not available, cannot update existing editor`);
        return false;
    }

    // Check if we have an open history.sql file (could be either custom tab or regular file)
    const openEditors = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    outputChannel.appendLine(`[QueryHistory] Found ${openEditors.length} open tabs, searching for history.sql`);
    
    // Log all tabs for debugging
    openEditors.forEach((tab, index) => {
        let path = 'unknown';
        if (tab.input instanceof vscode.TabInputCustom) {
            path = tab.input.uri.path;
            outputChannel.appendLine(`[QueryHistory] Tab ${index}: Custom - ${path}`);
        } else if (tab.input instanceof vscode.TabInputText) {
            path = tab.input.uri.path;
            outputChannel.appendLine(`[QueryHistory] Tab ${index}: Text - ${path}`);
        } else {
            outputChannel.appendLine(`[QueryHistory] Tab ${index}: ${tab.input?.constructor.name || 'unknown'}`);
        }
    });

    const historyTab = openEditors.find(tab => {
        if (tab.input instanceof vscode.TabInputCustom) {
            return tab.input.uri.path.endsWith('history.sql');
        }
        if (tab.input instanceof vscode.TabInputText) {
            return tab.input.uri.path.endsWith('history.sql');
        }
        return false;
    });

    if (historyTab) {
        outputChannel.appendLine(`[QueryHistory] Found existing history.sql tab`);
        try {
            let uri: vscode.Uri;
            if (historyTab.input instanceof vscode.TabInputCustom) {
                uri = historyTab.input.uri;
                outputChannel.appendLine(`[QueryHistory] Using Custom tab URI: ${uri.toString()}`);
            } else if (historyTab.input instanceof vscode.TabInputText) {
                uri = historyTab.input.uri;
                outputChannel.appendLine(`[QueryHistory] Using Text tab URI: ${uri.toString()}`);
            } else {
                outputChannel.appendLine(`[QueryHistory] Tab input type not supported`);
                return false;
            }

            // Force update the connection for this editor
            const targetDatabase = entry.database;
            outputChannel.appendLine(`[QueryHistory] Entry details: connectionId=${entry.connectionId}, database=${entry.database}, server=${entry.server}`);
            sqlEditorProvider.forceConnectionUpdate(uri, entry.connectionId, targetDatabase);
            outputChannel.appendLine(`[QueryHistory] Updated existing history.sql editor connection to ${entry.connectionId} -> ${targetDatabase}`);
            return true;
        } catch (err) {
            outputChannel.appendLine(`[QueryHistory] Failed to update existing history.sql editor: ${err}`);
            return false;
        }
    } else {
        outputChannel.appendLine(`[QueryHistory] No existing history.sql tab found`);
    }

    return false;
}

export function registerQueryHistoryCommands(
    context: vscode.ExtensionContext,
    historyManager: QueryHistoryManager,
    historyTreeProvider: QueryHistoryTreeProvider,
    connectionProvider: ConnectionProvider,
    outputChannel: vscode.OutputChannel,
    unifiedTreeProvider?: UnifiedTreeProvider,
    sqlEditorProvider?: SqlEditorProvider
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
                
                // Remove existing execution summary comments before adding new ones
                const cleanQuery = removeExistingExecutionComments(entry.query);
                
                // Combine query with header at the end
                const fullContent = cleanQuery + header;

                // First, try to update existing history.sql editor if it exists
                const updatedExistingEditor = sqlEditorProvider ? 
                    tryUpdateExistingHistoryEditor(entry, sqlEditorProvider, outputChannel) : false;

                if (!updatedExistingEditor) {
                    outputChannel.appendLine(`[QueryHistory] No existing editor found, creating/opening history.sql`);
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

                    // Open in custom SQL editor - this will now reuse the same history.sql file
                    await openSqlInCustomEditor(fullContent, 'history.sql', context);
                } else {
                    // Update the content in the existing editor
                    outputChannel.appendLine(`[QueryHistory] Updating existing editor, found ${vscode.workspace.textDocuments.length} open documents`);
                    const historyDoc = vscode.workspace.textDocuments.find(doc => 
                        doc.uri.path.endsWith('history.sql')
                    );
                    
                    if (historyDoc) {
                        outputChannel.appendLine(`[QueryHistory] Found existing history document: ${historyDoc.uri.toString()}`);
                        const edit = new vscode.WorkspaceEdit();
                        edit.replace(
                            historyDoc.uri,
                            new vscode.Range(0, 0, historyDoc.lineCount, 0),
                            fullContent
                        );
                        await vscode.workspace.applyEdit(edit);
                        outputChannel.appendLine(`[QueryHistory] Updated content in existing history.sql editor`);
                        
                        // Focus the existing history.sql tab
                        outputChannel.appendLine(`[QueryHistory] Focusing existing history.sql document`);
                        await vscode.window.showTextDocument(historyDoc, { 
                            viewColumn: vscode.ViewColumn.Active,
                            preview: false,
                            preserveFocus: false
                        });
                        outputChannel.appendLine(`[QueryHistory] Successfully focused history.sql`);
                    } else {
                        outputChannel.appendLine(`[QueryHistory] Warning: Could not find existing history document despite successful tab update`);
                    }
                }

                // Try to connect to the same connection if it exists
                try {
                    outputChannel.appendLine(`[QueryHistory] Attempting to connect to: ${entry.connectionId}`);
                    
                    // Check if already connected to this connection
                    if (!connectionProvider.isConnectionActive(entry.connectionId)) {
                        await connectionProvider.connectToSavedById(entry.connectionId);
                        vscode.window.showInformationMessage(`Connected to ${entry.connectionName}`);

                        // Refresh the database explorer tree view on successful connection
                        if (unifiedTreeProvider) {
                            outputChannel.appendLine('[QueryHistory] Refreshing database explorer tree view');
                            unifiedTreeProvider.refresh();
                        }
                    } else {
                        outputChannel.appendLine(`[QueryHistory] Already connected to ${entry.connectionId}`);
                    }

                    // Always set this connection as active and ensure correct database context
                    connectionProvider.setActiveConnection(entry.connectionId);
                    
                    // For server connections, we need to ensure we're working with the correct database
                    const connectionConfig = connectionProvider.getConnectionConfig(entry.connectionId);
                    if (connectionConfig && connectionConfig.connectionType === 'server') {
                        // This is a server connection, we need to ensure the correct database context
                        outputChannel.appendLine(`[QueryHistory] Server connection detected, ensuring database context: ${entry.database}`);
                        
                        // Create or ensure DB pool for the specific database from history
                        try {
                            await connectionProvider.ensureConnectionAndGetDbPool(entry.connectionId, entry.database);
                            outputChannel.appendLine(`[QueryHistory] Database context established for ${entry.connectionId} -> ${entry.database}`);
                        } catch (err) {
                            outputChannel.appendLine(`[QueryHistory] Warning: Could not establish database context ${entry.connectionId} -> ${entry.database}: ${err}`);
                        }
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
