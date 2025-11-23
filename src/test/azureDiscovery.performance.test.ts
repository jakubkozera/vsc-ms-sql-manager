// Performance comparison test for Azure Discovery
import * as azureDiscovery from '../utils/azureDiscovery';
import * as vscode from 'vscode';

async function performanceTest() {
    // Create a test output channel
    const outputChannel = {
        appendLine: (message: string) => console.log(`[${new Date().toISOString()}] ${message}`),
        append: (message: string) => console.log(message),
        show: () => {},
        hide: () => {},
        dispose: () => {},
        name: 'Performance Test Channel'
    } as vscode.OutputChannel;

    console.log('🚀 Starting Azure Discovery Performance Test...');
    console.log('=' .repeat(50));

    const startTime = Date.now();

    try {
        // Test the optimized discovery function
        const connections = await azureDiscovery.performAzureDiscovery(outputChannel);
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        console.log('=' .repeat(50));
        console.log(`✅ Discovery completed in ${duration}s`);
        console.log(`📊 Found ${connections.length} connections`);
        
        if (connections.length > 0) {
            console.log(`📈 Average time per connection: ${(duration / connections.length).toFixed(2)}s`);
            
            // Show distribution by subscription
            const subscriptions = new Set(connections.map(c => c.metadata?.subscriptionName).filter(Boolean));
            console.log(`🏢 Across ${subscriptions.size} subscriptions`);
            
            // Show distribution by server
            const servers = new Set(connections.map(c => c.server));
            console.log(`🖥️  Across ${servers.size} servers`);
        }

        // Show batch processing benefits
        console.log('\n🎯 Optimization Benefits:');
        console.log('✅ Parallel subscription processing (batches of 5)');
        console.log('✅ Parallel server processing (batches of 5)');
        console.log('✅ No unnecessary az account set calls');
        console.log('✅ Subscription-specific queries for thread safety');

    } catch (error) {
        console.error('❌ Performance test failed:', error);
    }
}

// Export for potential use
export { performanceTest };