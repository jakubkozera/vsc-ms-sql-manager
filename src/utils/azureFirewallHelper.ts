import * as vscode from 'vscode';
import * as cp from 'child_process';
import { promisify } from 'util';

const exec = promisify(cp.exec);

// Cache key for storing Azure server information
const AZURE_SERVERS_CACHE_KEY = 'azureServersCache';

let extensionContext: vscode.ExtensionContext | null = null;

/**
 * Initializes the module with extension context
 */
export function initializeAzureFirewallHelper(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

/**
 * Gets server information from cache
 */
function getCachedServerInfo(serverName: string): AzureServerInfo | null {
    if (!extensionContext) return null;
    
    const cache = extensionContext.globalState.get<Record<string, AzureServerInfo>>(AZURE_SERVERS_CACHE_KEY, {});
    const serverNameOnly = serverName.split('.')[0];
    const cached = cache[serverNameOnly];
    
    return cached || null;
}

/**
 * Saves server information to cache
 */
function setCachedServerInfo(serverInfo: AzureServerInfo): void {
    if (!extensionContext) return;
    
    const cache = extensionContext.globalState.get<Record<string, AzureServerInfo>>(AZURE_SERVERS_CACHE_KEY, {});
    cache[serverInfo.serverName] = {
        ...serverInfo,
        lastUpdated: Date.now()
    };
    extensionContext.globalState.update(AZURE_SERVERS_CACHE_KEY, cache);
}

/**
 * Clears cache for a specific server (e.g. when server was moved)
 */
export function clearServerCache(serverName: string): void {
    if (!extensionContext) return;
    
    const cache = extensionContext.globalState.get<Record<string, AzureServerInfo>>(AZURE_SERVERS_CACHE_KEY, {});
    const serverNameOnly = serverName.split('.')[0];
    delete cache[serverNameOnly];
    extensionContext.globalState.update(AZURE_SERVERS_CACHE_KEY, cache);
}

/**
 * Verifies if server still exists in cached subscription and clears cache if not
 */
async function validateAndCleanServerCache(serverName: string, cachedInfo: AzureServerInfo): Promise<boolean> {
    try {
        const serverNameOnly = serverName.split('.')[0];
        
        // Set subscription from cache
        await exec(`az account set --subscription "${cachedInfo.subscriptionId}"`);
        
        // Check if server still exists in this subscription
        const { stdout: serverInfo } = await exec(`az sql server list --query "[?name=='${serverNameOnly}'].{name:name,resourceGroup:resourceGroup}" -o json`);
        const servers = JSON.parse(serverInfo);
        
        if (servers.length === 0) {
            // Server not found - clear cache for this specific server
            console.warn(`Server ${serverNameOnly} not found in cached subscription ${cachedInfo.subscriptionName}, clearing cache`);
            clearServerCache(serverName);
            return false;
        }
        
        // Check if resource group has changed
        if (servers[0].resourceGroup !== cachedInfo.resourceGroup) {
            console.warn(`Server ${serverNameOnly} resource group changed, updating cache`);
            // Update cache with new information
            const updatedInfo: AzureServerInfo = {
                ...cachedInfo,
                resourceGroup: servers[0].resourceGroup,
                lastUpdated: Date.now()
            };
            setCachedServerInfo(updatedInfo);
        }
        
        return true;
    } catch (error) {
        console.warn(`Failed to validate cached server ${serverName}: ${error}`);
        clearServerCache(serverName);
        return false;
    }
}

/**
 * Clears entire Azure servers cache
 */
export function clearAllServerCache(): void {
    if (!extensionContext) return;
    
    extensionContext.globalState.update(AZURE_SERVERS_CACHE_KEY, {});
    vscode.window.showInformationMessage('Azure servers cache cleared successfully.');
}

/**
 * Shows information about cached servers
 */
export function showServerCacheInfo(): void {
    if (!extensionContext) return;
    
    const cache = extensionContext.globalState.get<Record<string, AzureServerInfo>>(AZURE_SERVERS_CACHE_KEY, {});
    const servers = Object.values(cache);
    
    if (servers.length === 0) {
        vscode.window.showInformationMessage('No Azure servers cached.');
        return;
    }
    
    const items = servers.map(server => {
        const lastUpdated = new Date(server.lastUpdated).toLocaleString();
        return `${server.serverName} (${server.subscriptionName}) - last verified: ${lastUpdated}`;
    });
    
    vscode.window.showQuickPick(items, {
        canPickMany: false,
        placeHolder: `${servers.length} Azure servers cached`,
        title: 'Azure Servers Cache'
    });
}

export interface AzureFirewallError {
    isAzureFirewallError: boolean;
    serverName?: string;
    clientIP?: string;
    errorMessage?: string;
}

export interface AzureServerInfo {
    serverName: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    lastUpdated: number; // timestamp for tracking when info was cached
}

/**
 * Analyzes connection error and determines if it's an Azure SQL firewall error
 */
export function analyzeConnectionError(error: string): AzureFirewallError {
    const azureFirewallPattern = /Cannot open server '([^']+)' requested by the login\. Client with IP address '([^']+)' is not allowed to access the server/i;
    const match = error.match(azureFirewallPattern);
    
    if (match) {
        return {
            isAzureFirewallError: true,
            serverName: match[1],
            clientIP: match[2],
            errorMessage: error
        };
    }
    
    return {
        isAzureFirewallError: false,
        errorMessage: error
    };
}

/**
 * Checks if Azure CLI is installed
 */
export async function checkAzureCLI(): Promise<boolean> {
    try {
        await exec('az --version');
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Checks if user is logged in to Azure CLI
 */
export async function checkAzureCLILogin(): Promise<boolean> {
    try {
        const { stdout } = await exec('az account show');
        return stdout.trim().length > 0;
    } catch (error) {
        return false;
    }
}

/**
 * Logs user into Azure CLI
 */
export async function loginToAzure(): Promise<boolean> {
    try {
        // Run az login in background - will open browser
        await exec('az login');
        return true;
    } catch (error) {
        console.error('Azure CLI login failed:', error);
        return false;
    }
}

/**
 * Installs Azure CLI
 */
export async function installAzureCLI(): Promise<boolean> {
    try {
        const choice = await vscode.window.showInformationMessage(
            'Azure CLI is not installed. Would you like to install it?',
            { modal: true },
            'Install Azure CLI',
            'Cancel'
        );
        
        if (choice !== 'Install Azure CLI') {
            return false;
        }
        
        // Pokazuj progress podczas instalacji
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Installing Azure CLI...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ increment: 25, message: 'Downloading installer...' });
                
                // Installation via PowerShell on Windows
                const installCommand = 'Invoke-WebRequest -Uri https://aka.ms/installazurecliwindows -OutFile .\\AzureCLI.msi; Start-Process msiexec.exe -Wait -ArgumentList \'/I AzureCLI.msi /quiet\'; Remove-Item .\\AzureCLI.msi';
                
                progress.report({ increment: 50, message: 'Installing...' });
                await exec(installCommand, { shell: 'powershell' });
                
                progress.report({ increment: 100, message: 'Installation completed!' });
                
                vscode.window.showInformationMessage('Azure CLI installed successfully! Please restart VS Code.');
                return true;
            } catch (error) {
                console.error('Azure CLI installation failed:', error);
                vscode.window.showErrorMessage(`Failed to install Azure CLI: ${error instanceof Error ? error.message : 'Unknown error'}`);
                return false;
            }
        });
    } catch (error) {
        console.error('Azure CLI installation failed:', error);
        return false;
    }
}

/**
 * Adds firewall rule for given IP to Azure SQL Database
 */
export async function addFirewallRule(serverName: string, clientIP: string, connectionId?: string): Promise<boolean> {
    try {
        // Extract resource group and server name from full server name
        const serverNameOnly = serverName.split('.')[0];
        
        // Check if we are logged in
        const isLoggedIn = await checkAzureCLILogin();
        if (!isLoggedIn) {
            const loginChoice = await vscode.window.showInformationMessage(
                'You need to login to Azure CLI first.',
                'Login to Azure',
                'Cancel'
            );
            
            if (loginChoice !== 'Login to Azure') {
                return false;
            }
            
            const loginSuccess = await loginToAzure();
            if (!loginSuccess) {
                vscode.window.showErrorMessage('Failed to login to Azure CLI');
                return false;
            }
        }
        
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Adding firewall rule...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ increment: 10, message: 'Checking cached server information...' });
                
                const serverNameOnly = serverName.split('.')[0];
                let foundServer = null;
                let foundSubscription = null;
                
                // Check if we have information in cache
                const cachedInfo = getCachedServerInfo(serverName);
                if (cachedInfo) {
                    progress.report({ increment: 30, message: `Using cached info for subscription: ${cachedInfo.subscriptionName}` });
                    
                    // Verify if server still exists and clear cache if not
                    const isValid = await validateAndCleanServerCache(serverName, cachedInfo);
                    
                    if (isValid) {
                        foundServer = {
                            name: cachedInfo.serverName,
                            resourceGroup: cachedInfo.resourceGroup,
                            subscriptionId: cachedInfo.subscriptionId,
                            subscriptionName: cachedInfo.subscriptionName
                        };
                        foundSubscription = {
                            id: cachedInfo.subscriptionId,
                            name: cachedInfo.subscriptionName
                        };
                    }
                    // If isValid === false, cache was cleared and we'll proceed to full search
                }
                
                // If we didn't find server in cache, search all subscriptions
                if (!foundServer) {
                    progress.report({ increment: 20, message: 'Getting Azure subscriptions...' });
                    
                    // Get list of all available subscriptions
                    const { stdout: subscriptionsJson } = await exec('az account list --query "[].{id:id,name:name}" -o json');
                    const subscriptions = JSON.parse(subscriptionsJson);
                    
                    if (subscriptions.length === 0) {
                        vscode.window.showErrorMessage('No Azure subscriptions found. Please ensure you are logged in to Azure CLI.');
                        return false;
                    }
                    
                    progress.report({ increment: 30, message: 'Searching for SQL server across subscriptions...' });
                    
                    // Search each subscription for SQL server
                    for (let i = 0; i < subscriptions.length; i++) {
                        const subscription = subscriptions[i];
                        
                        progress.report({ 
                            increment: Math.floor(40 / subscriptions.length), 
                            message: `Searching in subscription: ${subscription.name}...` 
                        });
                        
                        try {
                            // Set active subscription
                            await exec(`az account set --subscription "${subscription.id}"`);
                            
                            // Search for SQL server in this subscription
                            const { stdout: serverInfo } = await exec(`az sql server list --query "[?name=='${serverNameOnly}'].{name:name,resourceGroup:resourceGroup,subscriptionId:'${subscription.id}',subscriptionName:'${subscription.name}'}" -o json`);
                            const servers = JSON.parse(serverInfo);
                            
                            if (servers.length > 0) {
                                foundServer = servers[0];
                                foundSubscription = subscription;
                                
                                // Save information in cache for future use
                                const serverInfo: AzureServerInfo = {
                                    serverName: serverNameOnly,
                                    resourceGroup: foundServer.resourceGroup,
                                    subscriptionId: subscription.id,
                                    subscriptionName: subscription.name,
                                    lastUpdated: Date.now()
                                };
                                setCachedServerInfo(serverInfo);
                                
                                break;
                            }
                        } catch (error) {
                            // If we don't have access to this subscription, continue with next
                            console.warn(`Failed to access subscription ${subscription.name}: ${error}`);
                            continue;
                        }
                    }
                    
                    if (!foundServer) {
                        vscode.window.showErrorMessage(
                            `SQL Server '${serverNameOnly}' not found in any of your ${subscriptions.length} Azure subscriptions. ` +
                            'Please ensure the server name is correct and you have access to the subscription containing this server.'
                        );
                        return false;
                    }
                }
                
                progress.report({ increment: 70, message: `Found server in subscription: ${foundSubscription.name}` });
                
                const server = foundServer;
                const resourceGroup = server.resourceGroup;
                
                progress.report({ increment: 80, message: 'Creating firewall rule...' });
                
                // Make sure we're using the correct subscription
                await exec(`az account set --subscription "${foundSubscription.id}"`);
                
                // Create unique rule name with timestamp
                const ruleName = `VSCode-${clientIP.replace(/\./g, '-')}-${Date.now()}`;
                
                // Add firewall rule
                await exec(`az sql server firewall-rule create --resource-group "${resourceGroup}" --server "${serverNameOnly}" --name "${ruleName}" --start-ip-address "${clientIP}" --end-ip-address "${clientIP}"`);
                
                progress.report({ increment: 100, message: 'Firewall rule created successfully!' });
                
                // Automatically try to reconnect if we have connectionId
                if (connectionId) {
                    try {
                        vscode.window.showInformationMessage(
                            `Firewall rule '${ruleName}' created successfully for IP ${clientIP} in subscription '${foundSubscription.name}'. Attempting to reconnect...`
                        );
                        
                        // Wait a moment for firewall rule propagation
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        // Try to reconnect
                        await vscode.commands.executeCommand('mssqlManager.connectToSaved', { connectionId });
                        
                        vscode.window.showInformationMessage('Successfully reconnected to the database!');
                    } catch (reconnectError) {
                        console.warn('Auto-reconnect failed:', reconnectError);
                        vscode.window.showInformationMessage(
                            `Firewall rule created successfully, but auto-reconnect failed. Please try connecting manually.`,
                            'Try Connecting Again'
                        ).then(choice => {
                            if (choice === 'Try Connecting Again') {
                                vscode.commands.executeCommand('mssqlManager.refresh');
                            }
                        });
                    }
                } else {
                    vscode.window.showInformationMessage(
                        `Firewall rule '${ruleName}' created successfully for IP ${clientIP} in subscription '${foundSubscription.name}'. You can now connect to the database.`,
                        'Try Connecting Again'
                    ).then(choice => {
                        if (choice === 'Try Connecting Again') {
                            vscode.commands.executeCommand('mssqlManager.refresh');
                        }
                    });
                }
                
                return true;
            } catch (error) {
                console.error('Failed to add firewall rule:', error);
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to add firewall rule: ${errorMsg}`);
                return false;
            }
        });
    } catch (error) {
        console.error('Failed to add firewall rule:', error);
        vscode.window.showErrorMessage(`Failed to add firewall rule: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return false;
    }
}

/**
 * Opens Azure Portal on firewall settings page for given server
 */
export function openAzurePortalFirewall(serverName: string): void {
    try {
        // Extract server name without domain
        const serverNameOnly = serverName.split('.')[0];
        
        // URL to Azure Portal - SQL Server firewall settings
        const portalUrl = `https://portal.azure.com/#blade/HubsExtension/BrowseResource/resourceType/Microsoft.Sql%2Fservers`;
        
        // Open in browser
        vscode.env.openExternal(vscode.Uri.parse(portalUrl));
        
        // Show additional information
        vscode.window.showInformationMessage(
            `Azure Portal opened. Navigate to your SQL Server '${serverNameOnly}' and go to 'Networking' or 'Firewalls and virtual networks' to add your IP address.`,
            'OK'
        );
    } catch (error) {
        console.error('Failed to open Azure Portal:', error);
        vscode.window.showErrorMessage('Failed to open Azure Portal');
    }
}

/**
 * Shows intelligent options for solving Azure SQL firewall problem
 */
export async function showAzureFirewallSolution(serverName: string, clientIP: string, connectionId?: string): Promise<void> {
    const choice = await vscode.window.showErrorMessage(
        `Azure SQL Server firewall is blocking your IP address ${clientIP}. How would you like to fix this?`,
        {
            modal: false,
            detail: 'You can either use Azure Portal manually or let VS Code automatically add the firewall rule using Azure CLI.'
        },
        'Add IP with Azure CLI',
        'Open Azure Portal',
        'Cancel'
    );
    
    switch (choice) {
        case 'Add IP with Azure CLI':
            await handleAzureCLIFirewallFix(serverName, clientIP, connectionId);
            break;
            
        case 'Open Azure Portal':
            openAzurePortalFirewall(serverName);
            break;
            
        default:
            // User cancelled
            break;
    }
}

/**
 * Handles automatic firewall rule addition via Azure CLI
 */
async function handleAzureCLIFirewallFix(serverName: string, clientIP: string, connectionId?: string): Promise<void> {
    // Check if Azure CLI is installed
    const isAzInstalled = await checkAzureCLI();
    
    if (!isAzInstalled) {
        const installSuccess = await installAzureCLI();
        if (!installSuccess) {
            return;
        }
        
        // After installation, ask for VS Code restart
        const restartChoice = await vscode.window.showInformationMessage(
            'Azure CLI has been installed. Please restart VS Code and try again.',
            'Restart VS Code'
        );
        
        if (restartChoice === 'Restart VS Code') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        return;
    }
    
    // Try to add firewall rule
    await addFirewallRule(serverName, clientIP, connectionId);
}