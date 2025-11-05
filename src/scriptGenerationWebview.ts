import * as vscode from 'vscode';

export interface DatabaseObject {
    schema: string;
    name: string;
    rowCount?: number;
}

export interface DatabaseObjects {
    tables: DatabaseObject[];
    views: DatabaseObject[];
    procedures: DatabaseObject[];
    functions: DatabaseObject[];
}

export interface ScriptGenerationOptions {
    scriptType: 'schema' | 'data' | 'schemaAndData';
    destination: 'editor' | 'file' | 'clipboard';
    includeIfExists: boolean;
    includeDropStatements: boolean;
    scriptPermissions: boolean;
    scriptExtendedProperties: boolean;
    sortByDependencies: boolean;
    includeUseDatabase: boolean;
    batchSize: number;
}

export interface ScriptGenerationRequest {
    selectedObjects: DatabaseObjects;
    options: ScriptGenerationOptions;
}

export class ScriptGenerationWebview {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private onGenerate: (request: ScriptGenerationRequest) => void,
        private serverName: string,
        private databaseName: string,
        private databaseObjects: DatabaseObjects
    ) {}

    async show(): Promise<void> {
        const webviewPath = require('path').join(this.context.extensionPath, 'webview', 'scriptGeneration');

        this.panel = vscode.window.createWebviewPanel(
            'scriptGeneration',
            'Generate SQL Scripts',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(webviewPath)]
            }
        );

        this.panel.webview.html = this.getHtmlContent();

        // Set panel icon (use light/dark extension resources)
        try {
            const path = require('path');
            const lightIcon = path.join(this.context.extensionPath, 'resources', 'icons', 'generate-sql-icon.svg');
            const darkIcon = path.join(this.context.extensionPath, 'resources', 'icons', 'generate-sql-icon-dark.svg');

            const setIconForTheme = (themeKind: vscode.ColorThemeKind) => {
                try {
                    if (themeKind === vscode.ColorThemeKind.Light) {
                        this.panel!.iconPath = vscode.Uri.file(lightIcon);
                    } else {
                        this.panel!.iconPath = vscode.Uri.file(darkIcon);
                    }
                } catch (e) {
                    // ignore
                }
            };

            // Set initial icon
            setIconForTheme(vscode.window.activeColorTheme.kind);

            // Listen for theme changes and update icon
            const disposable = vscode.window.onDidChangeActiveColorTheme(e => {
                setIconForTheme(e.kind);
            });
            this.context.subscriptions.push(disposable);
        } catch (e) {
            // ignore if icon cannot be set
        }

        // Send initial data to webview
        this.panel.webview.postMessage({
            command: 'init',
            serverName: this.serverName,
            databaseName: this.databaseName,
            objects: this.databaseObjects
        });

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'generate':
                        this.onGenerate({
                            selectedObjects: message.selectedObjects,
                            options: message.options
                        });
                        this.panel?.dispose();
                        break;
                    case 'cancel':
                        this.panel?.dispose();
                        break;
                    case 'error':
                        vscode.window.showErrorMessage(message.message);
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
        
        const webviewPath = path.join(this.context.extensionPath, 'webview', 'scriptGeneration');
        const htmlPath = path.join(webviewPath, 'scriptGeneration.html');
        const cssUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(path.join(webviewPath, 'scriptGeneration.css')));
        
        let html = fs.readFileSync(htmlPath, 'utf8');
        
        // Replace CSS URI placeholder
        html = html.replace('{{styleUri}}', cssUri.toString());
        
        return html;
    }
}
