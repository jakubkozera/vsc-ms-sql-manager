import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { ConnectionProvider } from './connectionProvider';

export class DeployDockerMssqlWebview {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private connectionProvider: ConnectionProvider,
        private outputChannel: vscode.OutputChannel,
        private context: vscode.ExtensionContext
    ) {}

    /**
     * Check if Docker is running
     */
    private async isDockerRunning(): Promise<boolean> {
        try {
            const result = childProcess.execSync('docker info', { 
                encoding: 'utf8', 
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'ignore']
            });
            return result.includes('Server Version');
        } catch (error) {
            return false;
        }
    }

    /**
     * Get list of Docker networks
     */
    private async getDockerNetworks(): Promise<string[]> {
        try {
            const result = childProcess.execSync('docker network ls --format "{{.Name}}"', {
                encoding: 'utf8',
                timeout: 5000
            });
            return result.trim().split('\n').filter(n => n.length > 0);
        } catch (error) {
            this.outputChannel.appendLine(`[DeployDockerMssql] Error getting Docker networks: ${error}`);
            return ['bridge', 'host', 'none'];
        }
    }

    /**
     * Deploy MS SQL Server container
     */
    private async deployMssqlContainer(options: {
        containerName: string;
        saPassword: string;
        port: number;
        image: string;
        edition: string;
        collation?: string;
        network?: string;
        memory?: string;
        acceptEula: boolean;
    }): Promise<{ success: boolean; containerId?: string; containerName?: string; port?: number; saPassword?: string; error?: string }> {
        try {
            if (!options.acceptEula) {
                return {
                    success: false,
                    error: 'You must accept the End-User Licensing Agreement (EULA) to continue.'
                };
            }

            // Validate SA password complexity
            if (options.saPassword.length < 8) {
                return {
                    success: false,
                    error: 'Password must be at least 8 characters long.'
                };
            }

            // Check password complexity (uppercase, lowercase, number, special char)
            const hasUpperCase = /[A-Z]/.test(options.saPassword);
            const hasLowerCase = /[a-z]/.test(options.saPassword);
            const hasNumber = /[0-9]/.test(options.saPassword);
            const hasSpecialChar = /[^A-Za-z0-9]/.test(options.saPassword);

            if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
                return {
                    success: false,
                    error: 'Password must contain uppercase, lowercase, number, and special character.'
                };
            }

            // Build docker run command
            let dockerCmd = 'docker run -d';
            dockerCmd += ` --name ${options.containerName}`;
            dockerCmd += ` -e "ACCEPT_EULA=Y"`;
            dockerCmd += ` -e "SA_PASSWORD=${options.saPassword}"`;
            dockerCmd += ` -p ${options.port}:1433`;

            if (options.edition && options.edition !== 'Developer') {
                dockerCmd += ` -e "MSSQL_PID=${options.edition}"`;
            }

            if (options.collation) {
                dockerCmd += ` -e "MSSQL_COLLATION=${options.collation}"`;
            }

            if (options.network && options.network !== 'bridge') {
                dockerCmd += ` --network ${options.network}`;
            }

            if (options.memory) {
                dockerCmd += ` --memory ${options.memory}`;
            }

            // Use selected SQL Server image
            dockerCmd += ` ${options.image}`;

            this.outputChannel.appendLine(`[DeployDockerMssql] Executing: ${dockerCmd.replace(options.saPassword, '***')}`);

            // Execute docker run
            const containerId = childProcess.execSync(dockerCmd, {
                encoding: 'utf8',
                timeout: 30000
            }).trim();

            this.outputChannel.appendLine(`[DeployDockerMssql] Container created: ${containerId}`);

            // Wait for container to start (SQL Server needs time to initialize)
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Check if container is running
            const inspectResult = childProcess.execSync(`docker inspect ${containerId}`, {
                encoding: 'utf8',
                timeout: 5000
            });
            
            const containerInfo = JSON.parse(inspectResult)[0];
            const isRunning = containerInfo.State.Running;
            
            this.outputChannel.appendLine(`[DeployDockerMssql] Container State: ${JSON.stringify(containerInfo.State)}`);

            if (!isRunning) {
                // Get container logs to see what went wrong
                const logs = childProcess.execSync(`docker logs ${containerId}`, {
                    encoding: 'utf8',
                    timeout: 5000
                });
                this.outputChannel.appendLine(`[DeployDockerMssql] Container logs: ${logs}`);

                return {
                    success: false,
                    error: `Container failed to start. Exit code: ${containerInfo.State.ExitCode}`
                };
            }

            // Container is running, but SQL Server might still be initializing
            // Get logs to show progress
            try {
                const logs = childProcess.execSync(`docker logs ${containerId}`, {
                    encoding: 'utf8',
                    timeout: 5000
                });
                this.outputChannel.appendLine(`[DeployDockerMssql] Container logs: ${logs}`);
            } catch (err) {
                this.outputChannel.appendLine(`[DeployDockerMssql] Could not get logs: ${err}`);
            }

            return {
                success: true,
                containerId: containerId,
                containerName: options.containerName,
                port: options.port,
                saPassword: options.saPassword
            };
        } catch (error: any) {
            this.outputChannel.appendLine(`[DeployDockerMssql] Error deploying container: ${error}`);
            return {
                success: false,
                error: error.message || 'Unknown error occurred'
            };
        }
    }

    /**
     * Add deployed container to Docker group
     */
    private async addContainerToDockerGroup(deployResult: {
        success: boolean;
        containerId?: string;
        containerName?: string;
        port?: number;
        saPassword?: string;
        error?: string;
    }): Promise<void> {
        if (!deployResult.success || !deployResult.containerName || !deployResult.port || !deployResult.saPassword) {
            return;
        }

        try {
            // Get or create Docker group
            let serverGroups = this.connectionProvider.getServerGroups();
            let dockerGroup = serverGroups.find(g => g.name === 'Docker');
            
            if (!dockerGroup) {
                // Create Docker group
                this.outputChannel.appendLine('[DeployDockerMssql] Creating Docker server group');
                dockerGroup = {
                    id: 'docker-group',
                    name: 'Docker',
                    description: 'Docker SQL Server Containers',
                    color: '#0DB7ED',
                    iconType: 'custom'
                };
                await this.connectionProvider.saveServerGroup(dockerGroup);
                serverGroups = this.connectionProvider.getServerGroups();
                dockerGroup = serverGroups.find(g => g.name === 'Docker');
            }

            // Create connection configuration
            const connectionId = `docker-${deployResult.containerName}-${Date.now()}`;
            const connectionConfig = {
                id: connectionId,
                name: deployResult.containerName,
                server: 'localhost',
                port: deployResult.port,
                database: 'master',
                authType: 'sql' as 'sql',
                connectionType: 'server' as 'server',
                username: 'sa',
                password: deployResult.saPassword,
                encrypt: false,
                trustServerCertificate: true,
                serverGroupId: dockerGroup?.id
            };

            // Add connection using the connection provider's method
            this.outputChannel.appendLine(`[DeployDockerMssql] Adding connection: ${connectionConfig.name} to Docker group`);
            
            // We need to trigger the connection save through the provider
            // Use the handleWebviewConnection approach but directly
            await (this.connectionProvider as any).saveConnection(connectionConfig);
            
            vscode.window.showInformationMessage(
                `Container '${deployResult.containerName}' has been added to the Docker group`
            );
        } catch (error: any) {
            this.outputChannel.appendLine(`[DeployDockerMssql] Error adding container to Docker group: ${error}`);
            vscode.window.showErrorMessage(
                `Container deployed but could not add to Docker group: ${error.message}`
            );
        }
    }

    /**
     * Show the Deploy MS SQL webview
     */
    public async show(): Promise<void> {
        // Check if Docker is running
        const dockerRunning = await this.isDockerRunning();
        if (!dockerRunning) {
            vscode.window.showErrorMessage('Docker is not running. Please start Docker and try again.');
            return;
        }

        // Create or show existing panel
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'deployDockerMssql',
            'Deploy MS SQL Server',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'deployDockerMssql'))
                ]
            }
        );

        // Set webview HTML content
        this.panel.webview.html = await this.getWebviewContent();

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'ready':
                        // Send initial data
                        const networks = await this.getDockerNetworks();
                        this.panel!.webview.postMessage({
                            command: 'init',
                            networks: networks
                        });
                        break;

                    case 'deploy':
                        const result = await this.deployMssqlContainer(message.options);
                        this.panel!.webview.postMessage({
                            command: 'deployResult',
                            result: result
                        });
                        
                        if (result.success) {
                            // Add the container to Docker group automatically
                            await this.addContainerToDockerGroup(result);
                            
                            // Refresh the tree to show new connection
                            vscode.commands.executeCommand('mssqlManager.refresh');
                        }
                        break;

                    case 'testConnection':
                        // Test if we can connect to the container
                        const testResult = await this.testContainerConnection(
                            message.host || 'localhost',
                            message.port,
                            message.password
                        );
                        this.panel!.webview.postMessage({
                            command: 'testResult',
                            result: testResult
                        });
                        break;

                    case 'generatePassword':
                        // Generate a strong random password
                        const password = this.generateStrongPassword();
                        this.panel!.webview.postMessage({
                            command: 'passwordGenerated',
                            password: password
                        });
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        // Handle panel disposal
        this.panel.onDidDispose(
            () => {
                this.panel = undefined;
            },
            null,
            this.context.subscriptions
        );
    }

    /**
     * Test connection to SQL Server container
     */
    private async testContainerConnection(host: string, port: number, password: string): Promise<{ success: boolean; error?: string }> {
        try {
            const sql = require('mssql');
            const config = {
                server: host,
                port: port,
                user: 'sa',
                password: password,
                options: {
                    encrypt: false,
                    trustServerCertificate: true,
                    connectTimeout: 10000
                }
            };

            const pool = await sql.connect(config);
            await pool.close();

            return { success: true };
        } catch (error: any) {
            this.outputChannel.appendLine(`[DeployDockerMssql] Connection test failed: ${error}`);
            return {
                success: false,
                error: error.message || 'Connection failed'
            };
        }
    }

    /**
     * Generate a strong random password
     */
    private generateStrongPassword(): string {
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const lowercase = 'abcdefghijklmnopqrstuvwxyz';
        const numbers = '0123456789';
        const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
        const all = uppercase + lowercase + numbers + special;

        let password = '';
        
        // Ensure at least one of each type
        password += uppercase[Math.floor(Math.random() * uppercase.length)];
        password += lowercase[Math.floor(Math.random() * lowercase.length)];
        password += numbers[Math.floor(Math.random() * numbers.length)];
        password += special[Math.floor(Math.random() * special.length)];

        // Fill the rest (total length: 16)
        for (let i = password.length; i < 16; i++) {
            password += all[Math.floor(Math.random() * all.length)];
        }

        // Shuffle the password
        return password.split('').sort(() => Math.random() - 0.5).join('');
    }

    /**
     * Get webview HTML content
     */
    private async getWebviewContent(): Promise<string> {
        const htmlPath = path.join(this.context.extensionPath, 'webview', 'deployDockerMssql', 'deployDockerMssql.html');
        const cssPath = path.join(this.context.extensionPath, 'webview', 'deployDockerMssql', 'deployDockerMssql.css');
        const jsPath = path.join(this.context.extensionPath, 'webview', 'deployDockerMssql', 'deployDockerMssql.js');

        const cssUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(cssPath));
        const jsUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(jsPath));

        let html = fs.readFileSync(htmlPath, 'utf8');
        html = html.replace('{{cssUri}}', cssUri.toString());
        html = html.replace('{{jsUri}}', jsUri.toString());

        return html;
    }
}
