import * as vscode from 'vscode';

export interface QueryHistoryEntry {
    id: string;
    query: string;
    connectionId: string;
    connectionName: string;
    database: string;
    server: string;
    resultSetCount: number;
    rowCounts: number[]; // Number of rows in each result set
    executedAt: Date;
    duration?: number; // in milliseconds
    pinned?: boolean; // whether the entry is pinned in the UI
}

export class QueryHistoryManager {
    private history: QueryHistoryEntry[] = [];
    private maxHistorySize: number = 100; // Keep last 100 queries
    
    private _onDidChangeHistory: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeHistory: vscode.Event<void> = this._onDidChangeHistory.event;

    constructor(private context: vscode.ExtensionContext) {
        console.log('[QueryHistory] Initializing QueryHistoryManager');
        this.loadHistory();
        console.log(`[QueryHistory] Loaded ${this.history.length} entries from storage`);
    }

    addEntry(entry: Omit<QueryHistoryEntry, 'id' | 'executedAt'>): void {
        const historyEntry: QueryHistoryEntry = {
            ...entry,
            id: this.generateId(),
            executedAt: new Date(),
            pinned: entry.pinned === true // preserve if provided, otherwise default false
        };

        console.log(`[QueryHistory] Adding entry: ${historyEntry.id}, query: ${entry.query.substring(0, 50)}...`);

        // Add to beginning of array (most recent first)
        this.history.unshift(historyEntry);

        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history = this.history.slice(0, this.maxHistorySize);
        }

        this.saveHistory();
        console.log(`[QueryHistory] Entry saved, total entries: ${this.history.length}`);
        this._onDidChangeHistory.fire();
        console.log('[QueryHistory] Change event fired');
    }

    getHistory(): QueryHistoryEntry[] {
        return [...this.history];
    }

    getEntry(id: string): QueryHistoryEntry | undefined {
        return this.history.find(entry => entry.id === id);
    }

    clearHistory(): void {
        // Preserve pinned entries when clearing history
        this.history = this.history.filter(entry => entry.pinned === true);
        this.saveHistory();
        this._onDidChangeHistory.fire();
    }

    deleteEntry(id: string): void {
        this.history = this.history.filter(entry => entry.id !== id);
        this.saveHistory();
        this._onDidChangeHistory.fire();
    }

    setPinned(id: string, pinned: boolean): void {
        const idx = this.history.findIndex(e => e.id === id);
        if (idx === -1) return;
        const [entry] = this.history.splice(idx, 1);
        entry.pinned = pinned;
        if (pinned) {
            // Insert after existing pinned entries (keep pinned block at start)
            const firstNonPinned = this.history.findIndex(e => !e.pinned);
            if (firstNonPinned === -1) {
                // all remaining are pinned, append to end
                this.history.push(entry);
            } else {
                this.history.splice(firstNonPinned, 0, entry);
            }
        } else {
            // Unpinned - place after the last pinned entry (i.e., at first non-pinned position)
            const firstNonPinned = this.history.findIndex(e => !e.pinned);
            if (firstNonPinned === -1) {
                // no non-pinned found - append to end
                this.history.push(entry);
            } else {
                // insert at firstNonPinned index (before first non-pinned), which effectively places after pinned block
                this.history.splice(firstNonPinned, 0, entry);
            }
        }
        this.saveHistory();
        this._onDidChangeHistory.fire();
    }

    private generateId(): string {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private loadHistory(): void {
        try {
            const stored = this.context.globalState.get<any[]>('mssqlManager.queryHistory', []);
            console.log(`[QueryHistory] Loading history from storage, found ${stored.length} entries`);
            // Convert date strings back to Date objects
            this.history = stored.map(entry => ({
                ...entry,
                executedAt: new Date(entry.executedAt)
            }));
            console.log('[QueryHistory] History loaded successfully');
        } catch (error) {
            console.error('[QueryHistory] Failed to load query history:', error);
            this.history = [];
        }
    }

    private saveHistory(): void {
        try {
            console.log(`[QueryHistory] Saving ${this.history.length} entries to storage`);
            this.context.globalState.update('mssqlManager.queryHistory', this.history);
            console.log('[QueryHistory] History saved successfully');
        } catch (error) {
            console.error('[QueryHistory] Failed to save query history:', error);
        }
    }
}
