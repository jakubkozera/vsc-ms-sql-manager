import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ServerGroup } from './connectionProvider';

export class ServerGroupWebview {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private onGroupCreated: (group: ServerGroup) => void
    ) {}

    async show(editGroup?: ServerGroup): Promise<void> {
        const title = editGroup ? `Edit Server Group: ${editGroup.name}` : 'Create Server Group';
        
        const iconsRoot = path.join(this.context.extensionPath, 'resources', 'icons');
        const iconPath = {
            light: vscode.Uri.file(path.join(iconsRoot, 'server-group-light.svg')),
            dark: vscode.Uri.file(path.join(iconsRoot, 'server-group-dark.svg'))
        };

        this.panel = vscode.window.createWebviewPanel(
            'serverGroupForm',
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'webview'))
                ]
            }
        );

        // Apply themed icon after creation
        this.panel.iconPath = iconPath;

        this.panel.webview.html = this.getWebviewContent(editGroup);
        
        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'submit':
                    if (this.validateGroup(message.data)) {
                        this.onGroupCreated(message.data);
                        this.panel?.dispose();
                    }
                    break;
                case 'cancel':
                    this.panel?.dispose();
                    break;
            }
        });
    }

    private validateGroup(group: ServerGroup): boolean {
        if (!group.name?.trim()) {
            vscode.window.showErrorMessage('Server group name is required');
            return false;
        }
        
        if (!group.color) {
            vscode.window.showErrorMessage('Please select a color for the server group');
            return false;
        }
        
        if (!group.iconType) {
            vscode.window.showErrorMessage('Please select an icon type for the server group');
            return false;
        }
        
        return true;
    }

    private getWebviewContent(editGroup?: ServerGroup): string {
        const webviewPath = path.join(this.context.extensionPath, 'webview', 'serverGroup');
        
        // Read HTML template
        const htmlPath = path.join(webviewPath, 'serverGroup.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        
        // Get URIs for CSS and JS
        const styleUri = this.panel!.webview.asWebviewUri(
            vscode.Uri.file(path.join(webviewPath, 'serverGroup.css'))
        );
        const scriptUri = this.panel!.webview.asWebviewUri(
            vscode.Uri.file(path.join(webviewPath, 'serverGroup.js'))
        );
        
        // Replace placeholders
        const title = editGroup ? 'Edit Server Group' : 'Add Server Group';
        const buttonText = editGroup ? 'Update' : 'Create';
        const groupData = editGroup ? JSON.stringify(editGroup) : 'null';
        
        html = html.replace('{{styleUri}}', styleUri.toString());
        html = html.replace('{{scriptUri}}', scriptUri.toString());
        html = html.replace('{{title}}', title);
        html = html.replace('{{buttonText}}', buttonText);
        html = html.replace('{{groupData}}', groupData);
        
        return html;
    }
}
