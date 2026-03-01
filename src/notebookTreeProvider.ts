import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const STORAGE_KEY = 'mssqlManager.notebookFolders';

export type NotebookItemType = 'notebookFolder' | 'notebookSubfolder' | 'notebookFile';

export class NotebookTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly itemType: NotebookItemType,
        public readonly fsPath: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly rootFolderPath?: string // tracks which root folder this item belongs to
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;
        this.tooltip = fsPath;

        if (itemType === 'notebookFile') {
            this.command = {
                command: 'vscode.openWith',
                title: 'Open Notebook',
                arguments: [vscode.Uri.file(fsPath), 'mssqlManager.notebookEditor']
            };
            this.iconPath = new vscode.ThemeIcon('notebook');
        } else if (itemType === 'notebookFolder') {
            this.iconPath = new vscode.ThemeIcon('folder-library');
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}

export class NotebookTreeProvider implements vscode.TreeDataProvider<NotebookTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NotebookTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    private getSavedFolders(): string[] {
        return this.context.globalState.get<string[]>(STORAGE_KEY, []);
    }

    private saveFolders(folders: string[]): Thenable<void> {
        return this.context.globalState.update(STORAGE_KEY, folders);
    }

    async addFolder(folderUri: vscode.Uri): Promise<void> {
        const folders = this.getSavedFolders();
        const folderPath = folderUri.fsPath;

        if (folders.includes(folderPath)) {
            vscode.window.showInformationMessage('This folder is already in Notebooks.');
            return;
        }

        folders.push(folderPath);
        await this.saveFolders(folders);
        this.refresh();
    }

    async removeEntry(item: NotebookTreeItem): Promise<void> {
        const pathToRemove = item.rootFolderPath || item.fsPath;
        const folders = this.getSavedFolders().filter(f => f !== pathToRemove);
        await this.saveFolders(folders);
        this.refresh();
    }

    getTreeItem(element: NotebookTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: NotebookTreeItem): NotebookTreeItem[] {
        if (!element) {
            // Root level: show saved folders
            const folders = this.getSavedFolders();
            return folders
                .filter(f => fs.existsSync(f))
                .map(f => new NotebookTreeItem(
                    path.basename(f),
                    'notebookFolder',
                    f,
                    vscode.TreeItemCollapsibleState.Expanded,
                    f
                ));
        }

        // Child level: list directory contents
        const dirPath = element.fsPath;
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            return [];
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const rootFolder = element.rootFolderPath || element.fsPath;
        const items: NotebookTreeItem[] = [];

        // Subfolders first (only if they contain .ipynb files somewhere)
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                const subPath = path.join(dirPath, entry.name);
                if (this.containsNotebooks(subPath)) {
                    items.push(new NotebookTreeItem(
                        entry.name,
                        'notebookSubfolder',
                        subPath,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        rootFolder
                    ));
                }
            }
        }

        // Then .ipynb files
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.ipynb')) {
                items.push(new NotebookTreeItem(
                    entry.name,
                    'notebookFile',
                    path.join(dirPath, entry.name),
                    vscode.TreeItemCollapsibleState.None,
                    rootFolder
                ));
            }
        }

        return items;
    }

    private containsNotebooks(dirPath: string, depth: number = 0): boolean {
        if (depth > 5) { return false; }
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.ipynb')) {
                    return true;
                }
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    if (this.containsNotebooks(path.join(dirPath, entry.name), depth + 1)) {
                        return true;
                    }
                }
            }
        } catch {
            // Permission errors, etc.
        }
        return false;
    }
}
