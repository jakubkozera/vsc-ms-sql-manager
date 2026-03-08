import * as vscode from 'vscode';

interface FormatOptions {
    tabWidth: number;
    keywordCase: 'upper' | 'lower' | 'preserve';
    dataTypeCase: 'upper' | 'lower' | 'preserve';
    functionCase: 'upper' | 'lower' | 'preserve';
    linesBetweenQueries: number;
    indentStyle: 'standard' | 'tabularLeft' | 'tabularRight';
    logicalOperatorNewline: 'before' | 'after';
    formatBeforeRun: boolean;
}

interface AllSettings {
    // VS Code configuration settings
    showTableStatistics: boolean;
    immediateActive: boolean;
    schemaCacheValiditySeconds: number;
    queryTimeout: number;
    colorPrimaryForeignKeys: boolean;
    useReactWebview: boolean;
    // Formatting options (stored in globalState)
    tabWidth: number;
    keywordCase: 'upper' | 'lower' | 'preserve';
    dataTypeCase: 'upper' | 'lower' | 'preserve';
    functionCase: 'upper' | 'lower' | 'preserve';
    linesBetweenQueries: number;
    indentStyle: 'standard' | 'tabularLeft' | 'tabularRight';
    logicalOperatorNewline: 'before' | 'after';
    formatBeforeRun: boolean;
}

const defaultFormatOptions: FormatOptions = {
    tabWidth: 2,
    keywordCase: 'upper',
    dataTypeCase: 'upper',
    functionCase: 'upper',
    linesBetweenQueries: 1,
    indentStyle: 'standard',
    logicalOperatorNewline: 'before',
    formatBeforeRun: false,
};

export class SettingsWebview {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    public show(): void {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'mssqlManager.settings',
            'MS SQL Manager Settings',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'webview')
                ]
            }
        );

        this.panel.iconPath = {
            light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'settings-light.svg'),
            dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'settings-dark.svg'),
        };

        this.panel.webview.html = this.getHtml(this.panel.webview);

        this.panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'ready':
                    await this.sendCurrentSettings();
                    break;
                case 'saveSettings':
                    await this.saveSettings(message.settings);
                    break;
                case 'resetSettings':
                    await this.resetSettings();
                    break;
            }
        });

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    private async sendCurrentSettings(): Promise<void> {
        const settings = this.loadAllSettings();
        this.panel?.webview.postMessage({
            type: 'settingsLoaded',
            settings,
        });
    }

    private loadAllSettings(): AllSettings {
        const config = vscode.workspace.getConfiguration('mssqlManager');
        const formatOptions = this.context.globalState.get<FormatOptions>(
            'mssqlManager.formatOptions',
            defaultFormatOptions
        );

        return {
            showTableStatistics: config.get<boolean>('showTableStatistics', true),
            immediateActive: config.get<boolean>('immediateActive', true),
            schemaCacheValiditySeconds: config.get<number>('schemaCacheValiditySeconds', 120),
            queryTimeout: config.get<number>('queryTimeout', 0),
            colorPrimaryForeignKeys: config.get<boolean>('colorPrimaryForeignKeys', true),
            useReactWebview: config.get<boolean>('useReactWebview', false),
            tabWidth: config.get<number>('formatting.tabWidth', formatOptions.tabWidth),
            keywordCase: config.get<'upper' | 'lower' | 'preserve'>('formatting.keywordCase', formatOptions.keywordCase),
            dataTypeCase: config.get<'upper' | 'lower' | 'preserve'>('formatting.dataTypeCase', formatOptions.dataTypeCase),
            functionCase: config.get<'upper' | 'lower' | 'preserve'>('formatting.functionCase', formatOptions.functionCase),
            linesBetweenQueries: config.get<number>('formatting.linesBetweenQueries', formatOptions.linesBetweenQueries),
            indentStyle: config.get<'standard' | 'tabularLeft' | 'tabularRight'>('formatting.indentStyle', formatOptions.indentStyle),
            logicalOperatorNewline: config.get<'before' | 'after'>('formatting.logicalOperatorNewline', formatOptions.logicalOperatorNewline),
            formatBeforeRun: config.get<boolean>('formatting.formatBeforeRun', formatOptions.formatBeforeRun),
        };
    }

    private async saveSettings(settings: AllSettings): Promise<void> {
        const config = vscode.workspace.getConfiguration('mssqlManager');

        try {
            // Save VS Code configuration settings
            await config.update('showTableStatistics', settings.showTableStatistics, vscode.ConfigurationTarget.Global);
            await config.update('immediateActive', settings.immediateActive, vscode.ConfigurationTarget.Global);
            await config.update('schemaCacheValiditySeconds', settings.schemaCacheValiditySeconds, vscode.ConfigurationTarget.Global);
            await config.update('queryTimeout', settings.queryTimeout, vscode.ConfigurationTarget.Global);
            await config.update('colorPrimaryForeignKeys', settings.colorPrimaryForeignKeys, vscode.ConfigurationTarget.Global);
            await config.update('useReactWebview', settings.useReactWebview, vscode.ConfigurationTarget.Global);
            await config.update('formatting.tabWidth', settings.tabWidth, vscode.ConfigurationTarget.Global);
            await config.update('formatting.keywordCase', settings.keywordCase, vscode.ConfigurationTarget.Global);
            await config.update('formatting.dataTypeCase', settings.dataTypeCase, vscode.ConfigurationTarget.Global);
            await config.update('formatting.functionCase', settings.functionCase, vscode.ConfigurationTarget.Global);
            await config.update('formatting.linesBetweenQueries', settings.linesBetweenQueries, vscode.ConfigurationTarget.Global);
            await config.update('formatting.indentStyle', settings.indentStyle, vscode.ConfigurationTarget.Global);
            await config.update('formatting.logicalOperatorNewline', settings.logicalOperatorNewline, vscode.ConfigurationTarget.Global);
            await config.update('formatting.formatBeforeRun', settings.formatBeforeRun, vscode.ConfigurationTarget.Global);

            // Save formatting options to globalState
            const formatOptions: FormatOptions = {
                tabWidth: settings.tabWidth,
                keywordCase: settings.keywordCase,
                dataTypeCase: settings.dataTypeCase,
                functionCase: settings.functionCase,
                linesBetweenQueries: settings.linesBetweenQueries,
                indentStyle: settings.indentStyle,
                logicalOperatorNewline: settings.logicalOperatorNewline,
                formatBeforeRun: settings.formatBeforeRun,
            };
            await this.context.globalState.update('mssqlManager.formatOptions', formatOptions);

            this.outputChannel.appendLine('[Settings] Settings saved successfully');

            this.panel?.webview.postMessage({ type: 'settingsSaved' });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`[Settings] Failed to save settings: ${errorMsg}`);
            vscode.window.showErrorMessage(`Failed to save settings: ${errorMsg}`);
        }
    }

    private async resetSettings(): Promise<void> {
        const config = vscode.workspace.getConfiguration('mssqlManager');

        try {
            // Reset to defaults by removing overrides
            await config.update('showTableStatistics', undefined, vscode.ConfigurationTarget.Global);
            await config.update('immediateActive', undefined, vscode.ConfigurationTarget.Global);
            await config.update('schemaCacheValiditySeconds', undefined, vscode.ConfigurationTarget.Global);
            await config.update('queryTimeout', undefined, vscode.ConfigurationTarget.Global);
            await config.update('colorPrimaryForeignKeys', undefined, vscode.ConfigurationTarget.Global);
            await config.update('useReactWebview', undefined, vscode.ConfigurationTarget.Global);
            await config.update('formatting.tabWidth', undefined, vscode.ConfigurationTarget.Global);
            await config.update('formatting.keywordCase', undefined, vscode.ConfigurationTarget.Global);
            await config.update('formatting.dataTypeCase', undefined, vscode.ConfigurationTarget.Global);
            await config.update('formatting.functionCase', undefined, vscode.ConfigurationTarget.Global);
            await config.update('formatting.linesBetweenQueries', undefined, vscode.ConfigurationTarget.Global);
            await config.update('formatting.indentStyle', undefined, vscode.ConfigurationTarget.Global);
            await config.update('formatting.logicalOperatorNewline', undefined, vscode.ConfigurationTarget.Global);
            await config.update('formatting.formatBeforeRun', undefined, vscode.ConfigurationTarget.Global);

            // Reset formatting options
            await this.context.globalState.update('mssqlManager.formatOptions', defaultFormatOptions);

            this.outputChannel.appendLine('[Settings] Settings reset to defaults');

            // Send updated settings to webview
            await this.sendCurrentSettings();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`[Settings] Failed to reset settings: ${errorMsg}`);
            vscode.window.showErrorMessage(`Failed to reset settings: ${errorMsg}`);
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const cacheBuster = Date.now();
        const reactDistPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'sqlEditor-react', 'dist');
        const scriptPath = vscode.Uri.joinPath(reactDistPath, 'settings.js');
        const stylePath = vscode.Uri.joinPath(reactDistPath, 'settings.css');
        const globalScriptPath = vscode.Uri.joinPath(reactDistPath, 'global.js');
        const globalStylePath = vscode.Uri.joinPath(reactDistPath, 'global.css');

        const scriptUri = webview.asWebviewUri(scriptPath).toString() + `?v=${cacheBuster}`;
        const styleUri = webview.asWebviewUri(stylePath).toString() + `?v=${cacheBuster}`;
        const globalScriptUri = webview.asWebviewUri(globalScriptPath).toString() + `?v=${cacheBuster}`;
        const globalStyleUri = webview.asWebviewUri(globalStylePath).toString() + `?v=${cacheBuster}`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; 
        style-src ${webview.cspSource} 'unsafe-inline'; 
        font-src ${webview.cspSource} data:; 
        script-src ${webview.cspSource} https://cdn.jsdelivr.net https://*.jsdelivr.net 'unsafe-inline' 'unsafe-eval'; 
        img-src ${webview.cspSource} data:;">
    <title>MS SQL Manager Settings</title>
    <link rel="stylesheet" href="${globalStyleUri}">
    <link rel="stylesheet" href="${styleUri}">
    <link rel="modulepreload" href="${globalScriptUri}">
    <style>
        html, body, #root {
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
