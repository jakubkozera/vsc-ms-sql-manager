import * as vscode from 'vscode';
import * as cp from 'child_process';
import { promisify } from 'util';

const exec = promisify(cp.exec);

export interface AzureSqlServer {
    name: string;
    fullyQualifiedDomainName: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    location: string;
}

export interface AzureSqlDatabase {
    name: string;
    serverName: string;
    fullyQualifiedDomainName: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    location: string;
}

/**
 * Checks if Azure CLI is installed and user is logged in
 */
export async function checkAzureCliAvailability(): Promise<boolean> {
    try {
        // Check if Azure CLI is installed
        await exec('az --version');
        
        // Check if user is logged in
        const { stdout } = await exec('az account show');
        return stdout.trim().length > 0;
    } catch (error) {
        return false;
    }
}

/**
 * Gets current Azure AD user information for authentication hints
 */
export async function getAzureUserInfo(): Promise<{email?: string, tenantId?: string} | null> {
    try {
        const { stdout } = await exec('az account show --query "{userPrincipalName:user.name,tenantId:tenantId}" -o json');
        const userInfo = JSON.parse(stdout);
        return {
            email: userInfo.userPrincipalName,
            tenantId: userInfo.tenantId
        };
    } catch (error) {
        return null;
    }
}

/**
 * Checks if server supports Azure AD authentication
 */
export async function checkServerAadSupport(server: AzureSqlServer): Promise<boolean> {
    try {
        // Set active subscription
        await exec(`az account set --subscription "${server.subscriptionId}"`);
        
        // Check if server has AAD admin configured
        const { stdout } = await exec(
            `az sql server ad-admin list --server "${server.name}" --resource-group "${server.resourceGroup}" -o json`
        );
        
        const aadAdmins = JSON.parse(stdout);
        return aadAdmins && aadAdmins.length > 0;
    } catch (error) {
        // If command fails, assume AAD is not configured
        return false;
    }
}

/**
 * Discovers all Azure SQL servers across all accessible subscriptions
 */
export async function discoverAzureSqlServers(outputChannel: vscode.OutputChannel): Promise<AzureSqlServer[]> {
    const servers: AzureSqlServer[] = [];
    
    try {
        outputChannel.appendLine('[Azure Discovery] Starting Azure SQL server discovery...');
        
        // Get all accessible subscriptions
        const { stdout: subscriptionsJson } = await exec('az account list --query "[].{id:id,name:name}" -o json');
        const subscriptions = JSON.parse(subscriptionsJson);
        
        if (subscriptions.length === 0) {
            outputChannel.appendLine('[Azure Discovery] No Azure subscriptions found.');
            return servers;
        }
        
        outputChannel.appendLine(`[Azure Discovery] Found ${subscriptions.length} subscriptions to search`);
        
        // Process subscriptions in batches for better performance
        // Can be configured via environment variable AZURE_DISCOVERY_SUBSCRIPTION_BATCH_SIZE
        const batchSize = parseInt(process.env.AZURE_DISCOVERY_SUBSCRIPTION_BATCH_SIZE || '5');
        const batches = [];
        for (let i = 0; i < subscriptions.length; i += batchSize) {
            batches.push(subscriptions.slice(i, i + batchSize));
        }
        
        outputChannel.appendLine(`[Azure Discovery] Processing ${batches.length} batches of up to ${batchSize} subscriptions each`);
        
        // Process each batch in parallel
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            outputChannel.appendLine(`[Azure Discovery] Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} subscriptions`);
            
            // Process subscriptions in current batch in parallel
            const batchPromises = batch.map(async (subscription: any) => {
                try {
                    outputChannel.appendLine(`[Azure Discovery] Searching subscription: ${subscription.name}`);
                    
                    // Use subscription-specific query to avoid az account set conflicts
                    const { stdout: serversJson } = await exec(
                        `az sql server list --subscription "${subscription.id}" --query "[].{name:name,fullyQualifiedDomainName:fullyQualifiedDomainName,resourceGroup:resourceGroup,location:location}" -o json`
                    );
                    
                    const subscriptionServers = JSON.parse(serversJson);
                    
                    // Transform servers with subscription info
                    const serversWithMeta = subscriptionServers.map((server: any) => ({
                        name: server.name,
                        fullyQualifiedDomainName: server.fullyQualifiedDomainName,
                        resourceGroup: server.resourceGroup,
                        subscriptionId: subscription.id,
                        subscriptionName: subscription.name,
                        location: server.location
                    }));
                    
                    if (serversWithMeta.length > 0) {
                        outputChannel.appendLine(`[Azure Discovery] Found ${serversWithMeta.length} SQL servers in ${subscription.name}`);
                    }
                    
                    return serversWithMeta;
                    
                } catch (error) {
                    outputChannel.appendLine(`[Azure Discovery] Failed to access subscription ${subscription.name}: ${error}`);
                    return [];
                }
            });
            
            // Wait for current batch to complete
            const batchResults = await Promise.all(batchPromises);
            
            // Flatten and add results to servers array
            batchResults.forEach(subscriptionServers => {
                servers.push(...subscriptionServers);
            });
            
            outputChannel.appendLine(`[Azure Discovery] Batch ${batchIndex + 1} completed. Total servers found so far: ${servers.length}`);
        }
        
        outputChannel.appendLine(`[Azure Discovery] Discovery completed. Found ${servers.length} total Azure SQL servers.`);
        return servers;
        
    } catch (error) {
        outputChannel.appendLine(`[Azure Discovery] Discovery failed: ${error}`);
        return servers;
    }
}

/**
 * Discovers all databases in a specific Azure SQL server
 */
export async function discoverDatabasesInServer(server: AzureSqlServer, outputChannel: vscode.OutputChannel): Promise<AzureSqlDatabase[]> {
    const databases: AzureSqlDatabase[] = [];
    
    try {
        // Get databases in this server using subscription-specific query
        const { stdout: databasesJson } = await exec(
            `az sql db list --server "${server.name}" --resource-group "${server.resourceGroup}" --subscription "${server.subscriptionId}" --query "[].{name:name}" -o json`
        );
        
        const serverDatabases = JSON.parse(databasesJson);
        
        for (const db of serverDatabases) {
            // Skip system databases
            if (db.name === 'master') {
                continue;
            }
            
            databases.push({
                name: db.name,
                serverName: server.name,
                fullyQualifiedDomainName: server.fullyQualifiedDomainName,
                resourceGroup: server.resourceGroup,
                subscriptionId: server.subscriptionId,
                subscriptionName: server.subscriptionName,
                location: server.location
            });
        }
        
        outputChannel.appendLine(`[Azure Discovery] Found ${databases.length} databases in server ${server.name}`);
        return databases;
        
    } catch (error) {
        outputChannel.appendLine(`[Azure Discovery] Failed to get databases for server ${server.name}: ${error}`);
        return databases;
    }
}

/**
 * Creates connection configuration for Azure SQL server with multiple auth options
 */
export function createAzureServerConnectionConfig(server: AzureSqlServer, databases: AzureSqlDatabase[], adminInfo?: {adminLogin?: string, adminType?: string}): any {
    // Filter out system databases and get user database names
    const userDatabases = databases.filter(db => db.name !== 'master').map(db => db.name);
    
    // Use admin login as suggested username if available
    const suggestedUsername = adminInfo?.adminLogin || '';
    const connectionName = server.name;
    
    return {
        id: `azure-${server.subscriptionId}-${server.name}`,
        name: connectionName,
        server: server.fullyQualifiedDomainName,
        database: '', // No specific database - user can choose after connecting
        authType: 'sql', // Default to SQL auth, user should choose between SQL/AAD
        username: suggestedUsername, // Use discovered admin login or empty
        password: '', // User needs to provide SQL auth password or AAD token
        encrypt: true,
        trustServerCertificate: false,
        port: 1433,
        serverGroup: 'Azure',
        connectionType: 'server', // Server-level connection - user can choose database after connecting
        metadata: {
            resourceGroup: server.resourceGroup,
            subscriptionId: server.subscriptionId,
            subscriptionName: server.subscriptionName,
            location: server.location,
            isAzureDiscovered: true,
            serverType: 'Azure SQL Server',
            availableDatabases: userDatabases,
            databaseCount: userDatabases.length,
            discoveredAdminLogin: adminInfo?.adminLogin,
            authOptions: {
                sqlAuth: {
                    description: 'SQL Server Authentication - requires username/password created in Azure Portal',
                    usernameHint: adminInfo?.adminLogin || 'SQL login name (e.g. sqladmin)',
                    passwordHint: 'SQL login password'
                },
                aadAuth: {
                    description: 'Azure Active Directory Authentication - use your Azure account',
                    usernameHint: 'Your Azure AD email (e.g. user@company.com)',
                    passwordHint: 'Your Azure AD password or access token'
                }
            }
        }
    };
}

/**
 * Gets SQL Server administrator information for Azure SQL Server
 */
export async function getAzureSqlServerAdmin(server: AzureSqlServer): Promise<{adminLogin?: string, adminType?: string} | null> {
    try {
        const { stdout: adminJson } = await exec(
            `az sql server show --name "${server.name}" --resource-group "${server.resourceGroup}" --subscription "${server.subscriptionId}" --query "{administratorLogin:administratorLogin,administratorLoginPassword:administratorLoginPassword}" -o json`
        );
        const adminInfo = JSON.parse(adminJson);
        
        return {
            adminLogin: adminInfo.administratorLogin || undefined,
            adminType: 'sql' // Azure SQL Server admin is always SQL auth
        };
    } catch (error) {
        // Server admin info might not be accessible
        return null;
    }
}

/**
 * Checks if user has Azure AD access token available
 */
export async function getAzureAccessToken(): Promise<string | null> {
    try {
        const { stdout } = await exec('az account get-access-token --resource https://database.windows.net/ --query "accessToken" -o tsv');
        return stdout.trim();
    } catch (error) {
        return null;
    }
}

/**
 * Detects available Azure authentication methods
 */
export async function detectAzureAuthMethods(): Promise<{sqlAuth: boolean, aadAuth: boolean}> {
    const aadToken = await getAzureAccessToken();
    return {
        sqlAuth: true, // SQL auth is always available if server supports it
        aadAuth: aadToken !== null // AAD auth available if we can get token
    };
}

/**
 * Performs complete Azure SQL discovery and returns connection configurations
 */
export async function performAzureDiscovery(outputChannel: vscode.OutputChannel): Promise<any[]> {
    const connections: any[] = [];
    
    try {
        // Check if Azure CLI is available
        const isAzureCliAvailable = await checkAzureCliAvailability();
        if (!isAzureCliAvailable) {
            outputChannel.appendLine('[Azure Discovery] Azure CLI not available or user not logged in. Skipping Azure discovery.');
            outputChannel.appendLine('[Azure Discovery] To use Azure discovery:');
            outputChannel.appendLine('[Azure Discovery] 1. Install Azure CLI: https://docs.microsoft.com/cli/azure/install-azure-cli');
            outputChannel.appendLine('[Azure Discovery] 2. Login: az login');
            outputChannel.appendLine('[Azure Discovery] 3. Restart VS Code and run discovery again');
            return connections;
        }
        
        // Discover all Azure SQL servers
        const servers = await discoverAzureSqlServers(outputChannel);
        
        if (servers.length === 0) {
            outputChannel.appendLine('[Azure Discovery] No Azure SQL servers found in accessible subscriptions.');
            return connections;
        }
        
        // Get current Azure user info for authentication hints
        const userInfo = await getAzureUserInfo();
        if (userInfo?.email) {
            outputChannel.appendLine(`[Azure Discovery] Logged in as: ${userInfo.email}`);
        }
        
        // Process servers in batches for better performance
        // Can be configured via environment variable AZURE_DISCOVERY_SERVER_BATCH_SIZE
        const serverBatchSize = parseInt(process.env.AZURE_DISCOVERY_SERVER_BATCH_SIZE || '5');
        const serverBatches = [];
        for (let i = 0; i < servers.length; i += serverBatchSize) {
            serverBatches.push(servers.slice(i, i + serverBatchSize));
        }
        
        outputChannel.appendLine(`[Azure Discovery] Processing ${servers.length} servers in ${serverBatches.length} batches`);
        
        // Process each batch of servers in parallel
        for (let batchIndex = 0; batchIndex < serverBatches.length; batchIndex++) {
            const serverBatch = serverBatches[batchIndex];
            outputChannel.appendLine(`[Azure Discovery] Processing server batch ${batchIndex + 1}/${serverBatches.length} with ${serverBatch.length} servers`);
            
            // Process servers in current batch in parallel
            const serverPromises = serverBatch.map(async (server) => {
                try {
                    // Get SQL Server admin info and AAD support in parallel
                    const [supportsAad, adminInfo, databases] = await Promise.all([
                        checkServerAadSupport(server),
                        getAzureSqlServerAdmin(server),
                        discoverDatabasesInServer(server, outputChannel)
                    ]);
                    
                    outputChannel.appendLine(`[Azure Discovery] Server ${server.name} - AAD: ${supportsAad ? 'Yes' : 'No'}, Admin: ${adminInfo?.adminLogin || 'Unknown'}`);
                    
                    // Create one connection config per server (not per database)
                    const connectionConfig = createAzureServerConnectionConfig(server, databases, adminInfo || undefined);
                    
                    // Enhance with AAD info if available
                    if (supportsAad && userInfo?.email) {
                        connectionConfig.metadata.aadSupported = true;
                        connectionConfig.metadata.suggestedAadUser = userInfo.email;
                    } else {
                        connectionConfig.metadata.aadSupported = false;
                    }
                    
                    // Database count available in metadata for UI if needed
                    const dbCount = databases.filter(db => db.name !== 'master').length;
                    connectionConfig.metadata.userDatabaseCount = dbCount;
                    
                    return [connectionConfig]; // Return array with single connection per server
                } catch (error) {
                    outputChannel.appendLine(`[Azure Discovery] Failed to process server ${server.name}: ${error}`);
                    return [];
                }
            });
            
            // Wait for current batch to complete
            const batchResults = await Promise.all(serverPromises);
            
            // Flatten and add results to connections array
            batchResults.forEach(serverConnections => {
                connections.push(...serverConnections);
            });
            
            outputChannel.appendLine(`[Azure Discovery] Server batch ${batchIndex + 1} completed. Total connections found so far: ${connections.length}`);
        }
        
        outputChannel.appendLine(`[Azure Discovery] Created ${connections.length} Azure SQL connection configurations`);
        
        if (connections.length > 0) {
            outputChannel.appendLine('[Azure Discovery] ⚠️  AUTHENTICATION REQUIRED:');
            outputChannel.appendLine('[Azure Discovery] Discovered connections need credentials to work.');
            outputChannel.appendLine('[Azure Discovery]');
            outputChannel.appendLine('[Azure Discovery] 🔐 Authentication Options:');
            outputChannel.appendLine('[Azure Discovery] 1. SQL Authentication: Use SQL login created in Azure Portal');
            outputChannel.appendLine('[Azure Discovery]    - Edit connection → Set username/password');
            outputChannel.appendLine('[Azure Discovery] 2. Azure AD Authentication: Use your Azure account');
            outputChannel.appendLine('[Azure Discovery]    - Edit connection → Change Auth Type to "Azure Active Directory"');
            if (userInfo?.email) {
                outputChannel.appendLine(`[Azure Discovery]    - Try username: ${userInfo.email}`);
            }
            outputChannel.appendLine('[Azure Discovery]');
            outputChannel.appendLine('[Azure Discovery] 💡 Tip: Right-click connection → "Edit Connection" to set credentials');
        }
        
        return connections;
        
    } catch (error) {
        outputChannel.appendLine(`[Azure Discovery] Complete discovery failed: ${error}`);
        return connections;
    }
}