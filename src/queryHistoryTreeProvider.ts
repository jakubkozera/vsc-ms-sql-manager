import * as vscode from 'vscode';
import { QueryHistoryManager, QueryHistoryEntry } from './queryHistory';

type GroupingMode = 'none' | 'database';

export class QueryHistoryTreeProvider implements vscode.TreeDataProvider<QueryHistoryItem | DatabaseGroupItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<QueryHistoryItem | DatabaseGroupItem | undefined | null | void> = new vscode.EventEmitter<QueryHistoryItem | DatabaseGroupItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<QueryHistoryItem | DatabaseGroupItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private groupingMode: GroupingMode = 'none';

    constructor(
        private historyManager: QueryHistoryManager,
        private outputChannel: vscode.OutputChannel
    ) {
        console.log('[QueryHistoryTreeProvider] Initializing tree provider');
        // Listen to history changes
        historyManager.onDidChangeHistory(() => {
            console.log('[QueryHistoryTreeProvider] History changed, refreshing tree');
            this.refresh();
        });
    }

    setGroupingMode(mode: GroupingMode): void {
        console.log(`[QueryHistoryTreeProvider] Setting grouping mode to: ${mode}`);
        this.groupingMode = mode;
        this.refresh();
    }

    getGroupingMode(): GroupingMode {
        return this.groupingMode;
    }

    refresh(): void {
        console.log('[QueryHistoryTreeProvider] Refresh called');
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: QueryHistoryItem | DatabaseGroupItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: QueryHistoryItem | DatabaseGroupItem): Promise<(QueryHistoryItem | DatabaseGroupItem)[]> {
        if (element instanceof QueryHistoryItem) {
            // Query items have no children
            return [];
        }

        if (element instanceof DatabaseGroupItem) {
            // If this is the synthetic pinned group, return pinned entries
            if (element.contextValue === 'pinnedGroup' || element.database === 'Pinned') {
                const history = this.historyManager.getHistory();
                const pinned = history.filter(entry => entry.pinned === true).map(entry => new QueryHistoryItem(entry));
                // Mark pinned items context so UI shows Unpin option
                pinned.forEach(p => p.contextValue = 'queryHistoryItemPinned');
                console.log(`[QueryHistoryTreeProvider] Returning ${pinned.length} pinned items for pinned group`);
                return pinned;
            }

            // Return queries for this database group
            const history = this.historyManager.getHistory();
            const filteredHistory = history.filter(entry => 
                `${entry.server}/${entry.database}` === element.databaseKey
            );
            const items = filteredHistory.map(entry => new QueryHistoryItem(entry));
            console.log(`[QueryHistoryTreeProvider] Returning ${items.length} items for database: ${element.databaseKey}`);
            return items;
        }

        // Root level
        try {
            const history = this.historyManager.getHistory();
            console.log(`[QueryHistoryTreeProvider] getChildren called, history count: ${history.length}, grouping: ${this.groupingMode}`);
            
            if (history.length === 0) {
                console.log('[QueryHistoryTreeProvider] No history entries to display');
                return [];
            }

            // Always show pinned group at the very top if any pinned entries exist
            const pinnedEntries = history.filter(h => h.pinned === true);
            if (!element && pinnedEntries.length > 0) {
                // Synthetic 'Pinned' group as top-level collapsible item
                const pinnedGroup = new DatabaseGroupItem('Pinned', '', 'Pinned', pinnedEntries.length);
                // Do not show an icon for the pinned aggregate group
                pinnedGroup.iconPath = undefined;
                pinnedGroup.contextValue = 'pinnedGroup';
                console.log(`[QueryHistoryTreeProvider] Returning pinned group with ${pinnedEntries.length} items`);

                // Now build remaining root items depending on grouping mode
                if (this.groupingMode === 'database') {
                    // Group by database
                    const databaseGroups = new Map<string, QueryHistoryEntry[]>();
                    for (const entry of history) {
                        if (entry.pinned) continue; // pinned are shown in pinned group
                        const key = `${entry.server}/${entry.database}`;
                        if (!databaseGroups.has(key)) {
                            databaseGroups.set(key, []);
                        }
                        databaseGroups.get(key)!.push(entry);
                    }
                    const groups = Array.from(databaseGroups.entries()).map(([key, entries]) => 
                        new DatabaseGroupItem(key, entries[0].server, entries[0].database, entries.length)
                    );
                    return [pinnedGroup, ...groups];
                } else {
                    // Flat list but we still expose a pinned group at top as a collapsible container, and below that return other items as individual items
                    const others = history.filter(e => !e.pinned).map(entry => new QueryHistoryItem(entry));
                    others.forEach(o => o.contextValue = 'queryHistoryItem');
                    return [pinnedGroup, ...others];
                }
            }

            if (this.groupingMode === 'database') {
                // Group by database
                const databaseGroups = new Map<string, QueryHistoryEntry[]>();
                
                for (const entry of history) {
                    const key = `${entry.server}/${entry.database}`;
                    if (!databaseGroups.has(key)) {
                        databaseGroups.set(key, []);
                    }
                    databaseGroups.get(key)!.push(entry);
                }

                const items = Array.from(databaseGroups.entries()).map(([key, entries]) => 
                    new DatabaseGroupItem(key, entries[0].server, entries[0].database, entries.length)
                );
                console.log(`[QueryHistoryTreeProvider] Returning ${items.length} database groups`);
                return items;
            } else {
                // No grouping - flat list
                // Ensure pinned entries appear at top of the flat list
                const pinned = history.filter(e => e.pinned === true).map(entry => new QueryHistoryItem(entry));
                const others = history.filter(e => !e.pinned).map(entry => new QueryHistoryItem(entry));
                // Mark contextValue differently for pinned items so commands can show Unpin
                pinned.forEach(p => p.contextValue = 'queryHistoryItemPinned');
                const items = [...pinned, ...others];
                console.log(`[QueryHistoryTreeProvider] Returning ${items.length} history items`);
                return items;
            }
        } catch (error) {
            this.outputChannel.appendLine(`[QueryHistoryTreeProvider] Error loading history: ${error}`);
            return [];
        }
    }
}

export class DatabaseGroupItem extends vscode.TreeItem {
    constructor(
        public readonly databaseKey: string,
        public readonly server: string,
        public readonly database: string,
        public readonly queryCount: number
    ) {
        super(
            `${database}`,
            vscode.TreeItemCollapsibleState.Collapsed
        );

        this.description = `${queryCount} ${queryCount === 1 ? 'query' : 'queries'}`;
        this.tooltip = `${server}/${database}\n${queryCount} ${queryCount === 1 ? 'query' : 'queries'}`;
        this.contextValue = 'databaseGroup';
        this.iconPath = new vscode.ThemeIcon('database');
    }
}

export class QueryHistoryItem extends vscode.TreeItem {
    constructor(public readonly entry: QueryHistoryEntry) {
        super(
            QueryHistoryItem.formatLabel(entry),
            vscode.TreeItemCollapsibleState.None
        );

        this.tooltip = this.createTooltip();
        this.description = this.createDescription();
        this.contextValue = 'queryHistoryItem';
        this.iconPath = new vscode.ThemeIcon('history');

        // Add command to open query when clicked
        this.command = {
            command: 'mssqlManager.openQueryFromHistory',
            title: 'Open Query',
            arguments: [this.entry]
        };
    }

    private static formatLabel(entry: QueryHistoryEntry): string {
        // If a user-provided title exists, show it. Otherwise show first line of query (truncated)
        if (entry.title && entry.title.trim().length > 0) {
            return entry.title.trim();
        }

        const firstLine = entry.query.split('\n')[0].trim();
        const maxLength = 50;
        if (firstLine.length > maxLength) {
            return firstLine.substring(0, maxLength) + '...';
        }
        return firstLine || '(empty query)';
    }

    private createDescription(): string {
        const date = this.entry.executedAt;
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        let timeAgo: string;
        if (diffMins < 1) {
            timeAgo = 'just now';
        } else if (diffMins < 60) {
            timeAgo = `${diffMins}m ago`;
        } else if (diffHours < 24) {
            timeAgo = `${diffHours}h ago`;
        } else if (diffDays < 7) {
            timeAgo = `${diffDays}d ago`;
        } else {
            timeAgo = date.toLocaleDateString();
        }

        // Format row counts
        const totalRows = this.entry.rowCounts.reduce((sum, count) => sum + count, 0);
        const rowCountStr = this.entry.rowCounts.length > 0 ? `${totalRows} rows` : 'no rows';
        
        return `${timeAgo} • ${this.entry.resultSetCount} result${this.entry.resultSetCount !== 1 ? 's' : ''} • ${rowCountStr}`;
    }

    private createTooltip(): string {
        const lines: string[] = [];
        
        // Query preview (first 3 lines)
        const queryLines = this.entry.query.split('\n').slice(0, 3);
        lines.push('Query:');
        queryLines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed) {
                lines.push(`  ${trimmed}`);
            }
        });
        if (this.entry.query.split('\n').length > 3) {
            lines.push('  ...');
        }
        
        lines.push('');
        lines.push(`Connection: ${this.entry.connectionName}`);
        lines.push(`Server: ${this.entry.server}`);
        lines.push(`Database: ${this.entry.database}`);
        lines.push(`Result Sets: ${this.entry.resultSetCount}`);
        
        // Show row counts per result set
        if (this.entry.rowCounts.length > 0) {
            if (this.entry.rowCounts.length === 1) {
                lines.push(`Rows Returned: ${this.entry.rowCounts[0]}`);
            } else {
                lines.push(`Rows Returned:`);
                this.entry.rowCounts.forEach((count, index) => {
                    lines.push(`  Set ${index + 1}: ${count} rows`);
                });
            }
        }
        
        lines.push(`Executed: ${this.entry.executedAt.toLocaleString()}`);
        
        if (this.entry.duration) {
            lines.push(`Duration: ${this.entry.duration}ms`);
        }

        return lines.join('\n');
    }
}
