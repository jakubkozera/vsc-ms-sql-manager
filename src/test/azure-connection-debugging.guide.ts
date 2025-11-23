// Azure SQL Connection Debugging Guide
// Problem: Missing User ID in connection string

// PROBLEM SCENARIO:
// User sees this connection string:
// Server=hei-gis-ssportal-d-azwe-ass-1.database.windows.net;Password=hasloJ;Encrypt=true;TrustServerCertificate=false;Port=1433;
// Notice: Missing "User Id=username" part!

// ROOT CAUSE ANALYSIS:
// 1. Azure Discovery creates connection with empty username: username: ''
// 2. User fills in username and password in connection form
// 3. Connection is saved, but username might not be persisted properly
// 4. When connecting, username is not retrieved from secure storage

// DEBUGGING STEPS:
export const debuggingSteps = {
    step1: {
        title: "Check Azure Connection Config Creation",
        description: "Verify Azure discovery creates proper config",
        expectedResult: {
            authType: 'sql',
            username: '', // Empty initially - correct
            password: '', // Empty initially - correct
            server: 'server.database.windows.net',
            encrypt: true
        }
    },
    
    step2: {
        title: "Check Connection Form Submission", 
        description: "Verify username and password are submitted from form",
        checkPoints: [
            "Form contains username field",
            "Form contains password field", 
            "Form submits both values to saveConnection",
            "authType remains 'sql' during save"
        ]
    },
    
    step3: {
        title: "Check Secure Storage Persistence",
        description: "Verify username is saved to VS Code secure storage",
        requirements: [
            "connection.username is not empty",
            "connection.authType === 'sql'",
            "Both conditions must be true for username to be saved"
        ]
    },
    
    step4: {
        title: "Check Connection Retrieval",
        description: "Verify username is retrieved when connecting",
        process: [
            "getCompleteConnectionConfig() is called",
            "Username retrieved from: mssqlManager.username.{connectionId}",
            "Username added to complete config",
            "Complete config passed to createPoolForConfig"
        ]
    }
};

// SOLUTION APPROACH:
export const solutionApproaches = {
    approach1: {
        title: "Add Debug Logging",
        description: "Add temporary logging to track username flow",
        locations: [
            "connectionProvider.saveConnection() - log username save",
            "connectionProvider.getCompleteConnectionConfig() - log username retrieval",
            "connectionCommands.copyConnectionString() - verify username in complete config"
        ]
    },
    
    approach2: {
        title: "Verify Connection Form",
        description: "Check if connection form properly handles Azure connections",
        checkPoints: [
            "Form recognizes authType='sql' for Azure connections",
            "Username field is enabled and editable",
            "Form submission includes username in payload"
        ]
    },
    
    approach3: {
        title: "Test Minimal Case",
        description: "Create test with minimal Azure-like connection",
        testConfig: {
            id: "test-azure-connection",
            name: "Test Azure SQL",
            server: "test.database.windows.net",
            authType: "sql",
            username: "testuser",
            password: "testpass",
            encrypt: true
        }
    }
};

// EXPECTED CORRECT FLOW:
export const correctFlow = {
    step1: "Azure Discovery creates connection with empty username/password",
    step2: "User edits connection and fills in username='sqladmin', password='secretpass'",
    step3: "saveConnection() stores username in secure storage (key: mssqlManager.username.{id})", 
    step4: "User connects - getCompleteConnectionConfig() retrieves username from secure storage",
    step5: "createPoolForConfig() receives complete config with username",
    step6: "mssql driver creates connection with proper User Id in connection string",
    expectedConnectionString: "Server=server.database.windows.net;User Id=sqladmin;Password=secretpass;Encrypt=true;Port=1433;"
};

// USER WORKAROUND (temporary):
export const temporaryWorkaround = {
    title: "Manual Connection String Method",
    steps: [
        "1. Right-click Azure connection → Edit Connection",
        "2. Click 'Use Connection String' toggle",
        "3. Enter complete connection string manually:",
        "   Server=your-server.database.windows.net;Database=your-db;User Id=your-username;Password=your-password;Encrypt=true;TrustServerCertificate=false;",
        "4. Test connection",
        "5. Save connection"
    ],
    note: "This bypasses the individual field approach and uses direct connection string"
};