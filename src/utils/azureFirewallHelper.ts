import * as vscode from 'vscode';
import * as cp from 'child_process';
import { promisify } from 'util';

const exec = promisify(cp.exec);

export interface AzureFirewallError {
    isAzureFirewallError: boolean;
    serverName?: string;
    clientIP?: string;
    errorMessage?: string;
}

/**
 * Analizuje błąd połączenia i określa czy to błąd Azure SQL firewall
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
 * Sprawdza czy Azure CLI jest zainstalowane
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
 * Sprawdza czy użytkownik jest zalogowany do Azure CLI
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
 * Loguje użytkownika do Azure CLI
 */
export async function loginToAzure(): Promise<boolean> {
    try {
        // Uruchom az login w tle - otworzy przeglądarkę
        await exec('az login');
        return true;
    } catch (error) {
        console.error('Azure CLI login failed:', error);
        return false;
    }
}

/**
 * Instaluje Azure CLI
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
                
                // Instalacja przez PowerShell na Windows
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
 * Dodaje regułę firewall dla danego IP do Azure SQL Database
 */
export async function addFirewallRule(serverName: string, clientIP: string): Promise<boolean> {
    try {
        // Wyciągnij resource group i server name z pełnej nazwy serwera
        const serverNameOnly = serverName.split('.')[0];
        
        // Sprawdź czy jesteśmy zalogowani
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
                progress.report({ increment: 10, message: 'Getting Azure subscriptions...' });
                
                // Pobierz listę wszystkich dostępnych subskrypcji
                const { stdout: subscriptionsJson } = await exec('az account list --query "[].{id:id,name:name}" -o json');
                const subscriptions = JSON.parse(subscriptionsJson);
                
                if (subscriptions.length === 0) {
                    vscode.window.showErrorMessage('No Azure subscriptions found. Please ensure you are logged in to Azure CLI.');
                    return false;
                }
                
                progress.report({ increment: 20, message: 'Searching for SQL server across subscriptions...' });
                
                let foundServer = null;
                let foundSubscription = null;
                
                // Przeszukaj każdą subskrypcję w poszukiwaniu serwera SQL
                for (let i = 0; i < subscriptions.length; i++) {
                    const subscription = subscriptions[i];
                    
                    progress.report({ 
                        increment: Math.floor(50 / subscriptions.length), 
                        message: `Searching in subscription: ${subscription.name}...` 
                    });
                    
                    try {
                        // Ustaw aktywną subskrypcję
                        await exec(`az account set --subscription "${subscription.id}"`);
                        
                        // Szukaj serwera SQL w tej subskrypcji
                        const { stdout: serverInfo } = await exec(`az sql server list --query "[?name=='${serverNameOnly}'].{name:name,resourceGroup:resourceGroup,subscriptionId:'${subscription.id}',subscriptionName:'${subscription.name}'}" -o json`);
                        const servers = JSON.parse(serverInfo);
                        
                        if (servers.length > 0) {
                            foundServer = servers[0];
                            foundSubscription = subscription;
                            break;
                        }
                    } catch (error) {
                        // Jeśli nie mamy dostępu do tej subskrypcji, kontynuuj z następną
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
                
                progress.report({ increment: 70, message: `Found server in subscription: ${foundSubscription.name}` });
                
                const server = foundServer;
                const resourceGroup = server.resourceGroup;
                
                progress.report({ increment: 80, message: 'Creating firewall rule...' });
                
                // Upewnij się, że używamy właściwej subskrypcji
                await exec(`az account set --subscription "${foundSubscription.id}"`);
                
                // Stwórz unikalną nazwę reguły z timestampem
                const ruleName = `VSCode-${clientIP.replace(/\./g, '-')}-${Date.now()}`;
                
                // Dodaj regułę firewall
                await exec(`az sql server firewall-rule create --resource-group "${resourceGroup}" --server "${serverNameOnly}" --name "${ruleName}" --start-ip-address "${clientIP}" --end-ip-address "${clientIP}"`);
                
                progress.report({ increment: 100, message: 'Firewall rule created successfully!' });
                
                vscode.window.showInformationMessage(
                    `Firewall rule '${ruleName}' created successfully for IP ${clientIP} in subscription '${foundSubscription.name}'. You can now connect to the database.`,
                    'Try Connecting Again'
                ).then(choice => {
                    if (choice === 'Try Connecting Again') {
                        vscode.commands.executeCommand('mssqlManager.refresh');
                    }
                });
                
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
 * Otwiera Azure Portal na stronie firewall settings dla danego serwera
 */
export function openAzurePortalFirewall(serverName: string): void {
    try {
        // Wyciągnij tylko nazwę serwera bez domeny
        const serverNameOnly = serverName.split('.')[0];
        
        // URL do Azure Portal - SQL Server firewall settings
        const portalUrl = `https://portal.azure.com/#blade/HubsExtension/BrowseResource/resourceType/Microsoft.Sql%2Fservers`;
        
        // Otwórz w przeglądarce
        vscode.env.openExternal(vscode.Uri.parse(portalUrl));
        
        // Pokazuj dodatkowe informacje
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
 * Pokazuje inteligentne opcje rozwiązania problemu z Azure SQL firewall
 */
export async function showAzureFirewallSolution(serverName: string, clientIP: string): Promise<void> {
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
            await handleAzureCLIFirewallFix(serverName, clientIP);
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
 * Obsługuje automatyczne dodanie reguły firewall przez Azure CLI
 */
async function handleAzureCLIFirewallFix(serverName: string, clientIP: string): Promise<void> {
    // Sprawdź czy Azure CLI jest zainstalowane
    const isAzInstalled = await checkAzureCLI();
    
    if (!isAzInstalled) {
        const installSuccess = await installAzureCLI();
        if (!installSuccess) {
            return;
        }
        
        // Po instalacji, poproś o restart VS Code
        const restartChoice = await vscode.window.showInformationMessage(
            'Azure CLI has been installed. Please restart VS Code and try again.',
            'Restart VS Code'
        );
        
        if (restartChoice === 'Restart VS Code') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        return;
    }
    
    // Spróbuj dodać regułę firewall
    await addFirewallRule(serverName, clientIP);
}