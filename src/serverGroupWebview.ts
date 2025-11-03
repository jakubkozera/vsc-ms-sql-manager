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

    private sendCustomIconsToWebview(): void {
        // Get custom icons from ConnectionProvider via context
        const connectionProvider = (this.context.globalState as any).connectionProvider;
        if (!connectionProvider) {
            // If connection provider not available, get directly from global state
            const customIcons = this.context.globalState.get('mssqlManager.customIcons', []);
            this.panel?.webview.postMessage({
                command: 'customIconsLoaded',
                icons: customIcons
            });
        } else {
            const customIcons = connectionProvider.getCustomIcons();
            this.panel?.webview.postMessage({
                command: 'customIconsLoaded',
                icons: customIcons
            });
        }
    }

    private async handleAddCustomIcon(icon: any): Promise<void> {
        try {
            // Save to global state directly
            const customIcons = this.context.globalState.get<any[]>('mssqlManager.customIcons', []);
            customIcons.push(icon);
            await this.context.globalState.update('mssqlManager.customIcons', customIcons);
            
            this.panel?.webview.postMessage({
                command: 'customIconAdded',
                icons: customIcons
            });
            
            vscode.window.showInformationMessage(`Custom icon "${icon.name}" added successfully`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add custom icon: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleConfirmDeleteCustomIcon(iconId: string): Promise<void> {
        const result = await vscode.window.showWarningMessage(
            'Are you sure you want to delete this custom icon?',
            { modal: true },
            'Delete'
        );
        
        if (result === 'Delete') {
            await this.handleDeleteCustomIcon(iconId);
        }
    }

    private async handleDeleteCustomIcon(iconId: string): Promise<void> {
        try {
            // Get custom icons
            const customIcons = this.context.globalState.get<any[]>('mssqlManager.customIcons', []);
            const iconIndex = customIcons.findIndex(i => i.id === iconId);
            
            if (iconIndex === -1) {
                throw new Error('Custom icon not found');
            }
            
            // Remove the icon
            customIcons.splice(iconIndex, 1);
            await this.context.globalState.update('mssqlManager.customIcons', customIcons);
            
            // Check if any server groups use this icon and reset them
            const serverGroups = this.context.globalState.get<ServerGroup[]>('mssqlManager.serverGroups', []);
            let updatedGroups = false;
            for (const group of serverGroups) {
                if (group.customIconId === iconId) {
                    group.iconType = 'folder';
                    group.color = group.color || '#0078D4';
                    delete group.customIconId;
                    updatedGroups = true;
                }
            }
            
            if (updatedGroups) {
                await this.context.globalState.update('mssqlManager.serverGroups', serverGroups);
            }
            
            this.panel?.webview.postMessage({
                command: 'customIconDeleted',
                icons: customIcons,
                deletedIconId: iconId
            });
            
            vscode.window.showInformationMessage('Custom icon deleted successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete custom icon: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

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
                case 'loadCustomIcons':
                    this.sendCustomIconsToWebview();
                    break;
                case 'addCustomIcon':
                    await this.handleAddCustomIcon(message.icon);
                    break;
                case 'confirmDeleteCustomIcon':
                    await this.handleConfirmDeleteCustomIcon(message.iconId);
                    break;
                case 'showError':
                    vscode.window.showErrorMessage(message.message);
                    break;
            }
        });
    }

    private validateGroup(group: ServerGroup): boolean {
        if (!group.name?.trim()) {
            vscode.window.showErrorMessage('Server group name is required');
            return false;
        }
        
        if (!group.iconType) {
            vscode.window.showErrorMessage('Please select an icon type for the server group');
            return false;
        }
        
        // If using custom icon, customIconId is required
        if (group.iconType === 'custom' && !group.customIconId) {
            vscode.window.showErrorMessage('Please select a custom icon');
            return false;
        }
        
        // If not using custom icon, color is required
        if (group.iconType !== 'custom' && !group.color) {
            vscode.window.showErrorMessage('Please select a color for the server group');
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
