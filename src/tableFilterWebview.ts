import * as vscode from 'vscode';

export interface TableFilter {
    name?: {
        operator: string;
        value: string;
    };
    schema?: {
        operator: string;
        value: string;
    };
    owner?: {
        operator: string;
        value: string;
    };
}

export class TableFilterWebview {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private onFiltersApplied: (filters: TableFilter | null) => void,
        private path: string,
        private existingFilters?: TableFilter
    ) {}

    async show(): Promise<void> {
        this.panel = vscode.window.createWebviewPanel(
            'tableFilter',
            'Table Filter Settings',
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
            path: this.path,
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
        const htmlPath = path.join(this.context.extensionPath, 'webview', 'tableFilter', 'tableFilter.html');
        return fs.readFileSync(htmlPath, 'utf8');
    }
}
