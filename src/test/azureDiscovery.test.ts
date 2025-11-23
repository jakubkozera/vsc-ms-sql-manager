// Quick test for Azure Discovery functions
import * as azureDiscovery from '../utils/azureDiscovery';
import * as vscode from 'vscode';

async function testAzureDiscovery() {
    // Create a test output channel
    const outputChannel = {
        appendLine: (message: string) => console.log(message),
        append: (message: string) => console.log(message),
        show: () => {},
        hide: () => {},
        dispose: () => {},
        name: 'Test Channel'
    } as vscode.OutputChannel;

    console.log('Testing Azure CLI availability...');
    const isAvailable = await azureDiscovery.checkAzureCliAvailability();
    console.log(`Azure CLI available: ${isAvailable}`);

    if (isAvailable) {
        console.log('Testing Azure user info...');
        const userInfo = await azureDiscovery.getAzureUserInfo();
        console.log('User info:', userInfo);

        console.log('Testing Azure access token...');
        const token = await azureDiscovery.getAzureAccessToken();
        console.log(`Access token available: ${token ? 'Yes' : 'No'}`);

        console.log('Testing Azure auth methods detection...');
        const authMethods = await azureDiscovery.detectAzureAuthMethods();
        console.log('Auth methods:', authMethods);

        console.log('Testing full Azure discovery...');
        const connections = await azureDiscovery.performAzureDiscovery(outputChannel);
        console.log(`Found ${connections.length} connections`);
        
        if (connections.length > 0) {
            console.log('Sample connection config:');
            console.log(JSON.stringify(connections[0], null, 2));
        }
    }
}

// Export for potential use
export { testAzureDiscovery };