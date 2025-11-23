/**
 * Test example: Simplified Azure connection names
 * 
 * This shows how Azure connections now have clean, simple names
 * without auth details or database counts
 */

// Example Azure connections after discovery
const azureConnections = [
    {
        name: 'hei-gis-sportsdata-1', // Just the server name - clean!
        server: 'hei-gis-sportsdata-1.database.windows.net',
        database: '',
        connectionType: 'server',
        serverGroup: 'Azure',
        metadata: {
            // Auth info moved to metadata instead of name
            aadSupported: false,
            discoveredAdminLogin: 'sqladmin',
            userDatabaseCount: 2,
            authOptions: {
                sqlAuth: {
                    description: 'SQL Server Authentication - requires username/password created in Azure Portal',
                    usernameHint: 'sqladmin',
                    passwordHint: 'SQL login password'
                }
            }
        }
    },
    {
        name: 'hei-gis-sportsdata-1', // Same clean name for AAD-enabled server
        server: 'hei-gis-sportsdata-1.database.windows.net', 
        database: '',
        connectionType: 'server',
        serverGroup: 'Azure',
        metadata: {
            // AAD info in metadata, not name
            aadSupported: true,
            suggestedAadUser: 'KOZERA01@heiway.net',
            discoveredAdminLogin: 'sqladmin',
            userDatabaseCount: 3
        }
    }
];

// BEFORE this change:
// ❌ hei-gis-sportsdata-1 (2 databases) [Try user: sqladmin]
// ❌ hei-gis-sportsdata-1 (3 databases) [Try AAD: KOZERA01@heiway.net]

// AFTER this change:  
// ✅ hei-gis-sportsdata-1
// ✅ hei-gis-sportsdata-1

console.log('Clean Azure connection names:', azureConnections.map(c => c.name));