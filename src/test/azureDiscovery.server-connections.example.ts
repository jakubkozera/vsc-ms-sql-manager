// Example of new Azure Discovery behavior - Server-level connections
import * as azureDiscovery from '../utils/azureDiscovery';
import { AzureSqlServer, AzureSqlDatabase } from '../utils/azureDiscovery';

// Example: Before vs After comparison

// BEFORE (per database): Multiple connections per server
const oldApproach = {
    connections: [
        {
            id: "azure-sub1-server1-db1",
            name: "Database1 (server1) [Credentials Required]",
            server: "server1.database.windows.net",
            database: "Database1" // ❌ Locked to specific database
        },
        {
            id: "azure-sub1-server1-db2", 
            name: "Database2 (server1) [Credentials Required]",
            server: "server1.database.windows.net",
            database: "Database2" // ❌ Locked to specific database
        },
        {
            id: "azure-sub1-server1-db3",
            name: "Database3 (server1) [Credentials Required]", 
            server: "server1.database.windows.net",
            database: "Database3" // ❌ Locked to specific database
        }
    ]
};

// AFTER (per server): One connection per server
const newApproach = {
    connections: [
        {
            id: "azure-sub1-server1",
            name: "server1 (3 databases) [Credentials Required]",
            server: "server1.database.windows.net",
            database: "", // ✅ User can choose database after connecting
            metadata: {
                availableDatabases: ["Database1", "Database2", "Database3"],
                databaseCount: 3,
                serverType: "Azure SQL Server",
                // ... other Azure metadata
            }
        }
    ]
};

// Example usage of new createAzureServerConnectionConfig function
function exampleUsage() {
    const server: AzureSqlServer = {
        name: "hei-gis-ssportal-p-azwe-ass-1",
        fullyQualifiedDomainName: "hei-gis-ssportal-p-azwe-ass-1.database.windows.net",
        resourceGroup: "hei-gis-rg",
        subscriptionId: "12345678-1234-1234-1234-123456789012",
        subscriptionName: "Production Subscription", 
        location: "West Europe"
    };

    const databases: AzureSqlDatabase[] = [
        {
            name: "master", // Will be filtered out
            serverName: server.name,
            fullyQualifiedDomainName: server.fullyQualifiedDomainName,
            resourceGroup: server.resourceGroup,
            subscriptionId: server.subscriptionId,
            subscriptionName: server.subscriptionName,
            location: server.location
        },
        {
            name: "hei-gis-ssportal-p-azwe-orc-1",
            serverName: server.name,
            fullyQualifiedDomainName: server.fullyQualifiedDomainName,
            resourceGroup: server.resourceGroup,
            subscriptionId: server.subscriptionId,
            subscriptionName: server.subscriptionName,
            location: server.location
        }
    ];

    const connectionConfig = azureDiscovery.createAzureServerConnectionConfig(server, databases);
    
    console.log('New connection config:');
    console.log('Server:', connectionConfig.server); // hei-gis-ssportal-p-azwe-ass-1.database.windows.net
    console.log('Database:', connectionConfig.database); // "" (empty - user chooses)
    console.log('Available DBs:', connectionConfig.metadata.availableDatabases); // ["hei-gis-ssportal-p-azwe-orc-1"]
    console.log('Connection String equivalent:');
    console.log(`Server=${connectionConfig.server};Encrypt=true;TrustServerCertificate=false;Port=1433;`);
    console.log('✅ User can now choose database from the available list after connecting!');
}

export { exampleUsage };