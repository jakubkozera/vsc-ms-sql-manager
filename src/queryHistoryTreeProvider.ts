import * as vscode from 'vscode';
import { QueryHistoryManager, QueryHistoryEntry } from './queryHistory';

export class QueryHistoryTreeProvider implements vscode.TreeDataProvider<QueryHistoryItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<QueryHistoryItem | undefined | null | void> = new vscode.EventEmitter<QueryHistoryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<QueryHistoryItem | undefined | null | void> = this._onDidChangeTreeData.event;

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

    refresh(): void {
        console.log('[QueryHistoryTreeProvider] Refresh called');
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: QueryHistoryItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: QueryHistoryItem): Promise<QueryHistoryItem[]> {
        if (element) {
            // No nested items for now
            return [];
        }

        try {
            const history = this.historyManager.getHistory();
            console.log(`[QueryHistoryTreeProvider] getChildren called, history count: ${history.length}`);
            
            if (history.length === 0) {
                console.log('[QueryHistoryTreeProvider] No history entries to display');
                return [];
            }

            const items = history.map(entry => new QueryHistoryItem(entry));
            console.log(`[QueryHistoryTreeProvider] Returning ${items.length} history items`);
            return items;
        } catch (error) {
            this.outputChannel.appendLine(`[QueryHistoryTreeProvider] Error loading history: ${error}`);
            return [];
        }
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
        // Get first line of query (truncated)
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
