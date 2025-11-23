// Azure SQL Server Admin Discovery - Enhanced Authentication
// This example shows how the new Azure Discovery retrieves SQL admin logins

import * as azureDiscovery from '../utils/azureDiscovery';

// BEFORE: User had to guess the username
const beforeDiscovery = {
    connectionName: "hei-gis-ssportal-p-azwe-ass-1 [Credentials Required]",
    server: "hei-gis-ssportal-p-azwe-ass-1.database.windows.net",
    username: "", // ❌ Empty - user has to guess
    password: "", // ❌ Empty - user has to provide
    metadata: {
        authOptions: {
            sqlAuth: {
                usernameHint: "SQL login name (e.g. sqladmin)" // ❌ Generic hint
            }
        }
    }
};

// AFTER: Azure CLI discovers the actual admin username
const afterDiscovery = {
    connectionName: "hei-gis-ssportal-p-azwe-ass-1 [Try user: heiadmin]", // ✅ Shows discovered username
    server: "hei-gis-ssportal-p-azwe-ass-1.database.windows.net", 
    username: "heiadmin", // ✅ Pre-filled with discovered admin login
    password: "", // ❌ Still empty (security - passwords cannot be retrieved)
    metadata: {
        discoveredAdminLogin: "heiadmin", // ✅ Stores discovered admin
        authOptions: {
            sqlAuth: {
                usernameHint: "heiadmin" // ✅ Specific discovered username
            }
        }
    }
};

// Azure CLI Commands Used:
export const azureCliCommands = {
    serverInfo: {
        command: `az sql server show --name "server-name" --resource-group "rg-name" --subscription "sub-id" --query "{administratorLogin:administratorLogin}" -o json`,
        description: "Retrieves SQL Server administrator login name",
        expectedOutput: {
            administratorLogin: "sqladmin" // The actual admin username
        }
    },
    
    limitations: {
        passwords: "Azure CLI cannot retrieve passwords for security reasons",
        scopeNote: "Only retrieves the main server administrator login",
        alternativeLogins: "Additional SQL logins created after server setup are not discoverable via Azure CLI"
    }
};

// User Experience Improvements:
export const userExperienceImprovements = {
    before: [
        "User sees generic connection with empty username",
        "User has to guess or look up the admin username in Azure Portal", 
        "Trial and error to find correct username",
        "Error: 'Login failed for user '''"
    ],
    
    after: [
        "User sees connection with discovered admin username pre-filled",
        "Connection name hints at the username: '[Try user: admin]'",
        "User only needs to provide the password",
        "Much higher success rate on first connection attempt"
    ]
};

// Technical Implementation:
export const technicalDetails = {
    discoveryFlow: [
        "1. Azure Discovery scans subscriptions for SQL servers",
        "2. For each server, calls getAzureSqlServerAdmin()",
        "3. Azure CLI query retrieves administratorLogin field", 
        "4. Username is pre-filled in connection config",
        "5. Connection name updated to show discovered username"
    ],
    
    parallelExecution: "Admin info retrieval runs in parallel with AAD support check and database discovery",
    
    fallback: "If admin info cannot be retrieved, falls back to empty username (original behavior)"
};

// Example Usage:
async function exampleAzureDiscoveryWithAdmin() {
    const server = {
        name: "hei-gis-ssportal-p-azwe-ass-1",
        fullyQualifiedDomainName: "hei-gis-ssportal-p-azwe-ass-1.database.windows.net",
        resourceGroup: "hei-gis-rg",
        subscriptionId: "sub-12345",
        subscriptionName: "Production",
        location: "westeurope"
    };
    
    // This will now discover and return admin login
    const adminInfo = await azureDiscovery.getAzureSqlServerAdmin(server);
    console.log('Discovered admin:', adminInfo?.adminLogin); // e.g., "heiadmin"
    
    // Connection will be created with pre-filled username
    const connection = azureDiscovery.createAzureServerConnectionConfig(server, [], adminInfo || undefined);
    console.log('Pre-filled username:', connection.username); // e.g., "heiadmin"
    console.log('Connection name:', connection.name); // e.g., "server [Try user: heiadmin]"
}

export { exampleAzureDiscoveryWithAdmin };