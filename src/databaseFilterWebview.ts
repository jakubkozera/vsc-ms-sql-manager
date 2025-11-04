import * as vscode from 'vscode';

export interface DatabaseFilter {
    name?: {
        operator: string;
        value: string;
    };
    state?: {
        operator: string;
        value: string;
    };
    collation?: {
        operator: string;
        value: string;
    };
}

export class DatabaseFilterWebview {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private onFiltersApplied: (filters: DatabaseFilter | null) => void,
        private serverName: string,
        private existingFilters?: DatabaseFilter
    ) {}

    async show(): Promise<void> {
        this.panel = vscode.window.createWebviewPanel(
            'databaseFilter',
            'Database Filter Settings',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getHtmlContent();

        // Send initial data to webview
        this.panel.webview.postMessage({
            command: 'init',
            serverName: this.serverName,
            filters: this.existingFilters
        });

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'applyFilters':
                        this.onFiltersApplied(message.filters);
                        this.panel?.dispose();
                        break;
                    case 'clearFilters':
                        this.onFiltersApplied(null);
                        this.panel?.dispose();
                        break;
                    case 'close':
                        this.panel?.dispose();
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private getHtmlContent(): string {
        const fs = require('fs');
        const path = require('path');
        const htmlPath = path.join(this.context.extensionPath, 'webview', 'databaseFilter', 'databaseFilter.html');
        return fs.readFileSync(htmlPath, 'utf8');
    }
}
