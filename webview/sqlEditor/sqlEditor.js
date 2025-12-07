console.log('SQL Editor Webview loaded');

window.addEventListener('message', event => {
    const message = event.data;

    switch (message.type) {
        case 'config':
            if (message.config.colorPrimaryForeignKeys !== undefined) {
                colorPrimaryForeignKeys = message.config.colorPrimaryForeignKeys;
                console.log('[CONFIG] colorPrimaryForeignKeys set to:', colorPrimaryForeignKeys);
            }
            break;
        case 'update':
            if (editor && message.content !== editor.getValue()) {
                isUpdatingFromExtension = true;
                const position = editor.getPosition();
                editor.setValue(message.content);
                if (position) {
                    editor.setPosition(position);
                }
                isUpdatingFromExtension = false;
            }
            break;

        case 'connectionsUpdate':
            // message.connections is an array of connection configs
            updateConnectionsList(message.connections || [], message.currentConnectionId, message.currentDatabase);
            break;

        case 'databasesUpdate':
            // message.databases is an array of database names for current server connection
            updateDatabasesList(message.databases || [], message.currentDatabase);
            break;

        case 'schemaUpdate':
            console.log('[SQL-COMPLETION] Received schemaUpdate message');
            console.log('[SQL-COMPLETION] Message schema:', message.schema);
            dbSchema = message.schema || { tables: [], views: [], foreignKeys: [] };
            console.log('[SQL-COMPLETION] Schema updated:', dbSchema.tables.length, 'tables', dbSchema.views.length, 'views', dbSchema.foreignKeys.length, 'foreign keys');
            console.log('[SQL-COMPLETION] Tables:', dbSchema.tables?.map(t => `${t.schema}.${t.name}`).join(', '));
            break;

        case 'executing':
            showLoading();
            break;

        case 'results':
            // Store metadata and original query for editable result sets
            resultSetMetadata = message.metadata || [];
            originalQuery = message.originalQuery || '';
            showResults(message.resultSets, message.executionTime, message.rowsAffected, message.messages, message.planXml, message.columnNames);
            break;

        case 'relationResults':
            // Handle FK/PK expansion query results
            handleRelationResults(message);
            break;

        case 'queryPlan':
            showQueryPlan(message.planXml, message.executionTime, message.messages, message.resultSets);
            break;

        case 'error':
            showError(message.error, message.messages);
            break;

        case 'commitSuccess':
            // Clear pending changes after successful commit
            pendingChanges.clear();
            updatePendingChangesCount();
            
            // Remove all cell-modified classes
            document.querySelectorAll('.cell-modified').forEach(cell => {
                cell.classList.remove('cell-modified');
            });
            
            // Show success message
            displayMessages([{ type: 'info', text: message.message }]);
            console.log('[EDIT] Changes committed successfully');
            break;

        case 'confirmActionResult':
            // Handle confirmation response from extension
            if (message.confirmed && message.action === 'revertAll') {
                executeRevertAll();
            }
            break;

        case 'showMessage':
            // Handle messages from extension (they're already shown by the extension)
            console.log('[MESSAGE] :', message);
            break;
            
        case 'autoExecuteQuery':
            // Auto-execute the query if conditions are met
            if (editor && currentConnectionId) {
                const content = editor.getValue().trim();
                if (content && content.toLowerCase().startsWith('select')) {
                    // Small delay to ensure the webview is fully initialized
                    setTimeout(() => {
                        executeQuery();
                    }, 50);
                }
            }
            break;
            
        case 'snippetsUpdate':
            console.log('[SNIPPETS] Received snippets:', message.snippets?.length || 0);
            const newSnippets = message.snippets || [];
            
            // Update snippets array - completion provider will use updated data automatically
            if (JSON.stringify(sqlSnippets) !== JSON.stringify(newSnippets)) {
                console.log('[SNIPPETS] Snippets changed, updating array...');
                sqlSnippets = newSnippets;
                console.log('[SNIPPETS] Snippets updated. Completion provider will use new data on next invocation.');
                
                // Register completion provider if not already registered
                if (!completionProviderRegistered) {
                    registerCompletionProvider();
                }
            } else {
                console.log('[SNIPPETS] Snippets unchanged');
            }
            break;
            
        case 'snippetInputReceived':
            // Handle snippet input from extension
            if (message.success && message.name && message.prefix) {
                console.log('[SNIPPETS] Received snippet input:', message.name, message.prefix);
                
                // Send create snippet message to extension
                vscode.postMessage({
                    type: 'createSnippet',
                    name: message.name,
                    prefix: message.prefix,
                    body: message.body,
                    description: message.description
                });
            } else {
                console.log('[SNIPPETS] Snippet creation cancelled or invalid input');
            }
            break;
    }
});

const executeButton = document.getElementById('executeButton');
if (executeButton) {
    executeButton.addEventListener('click', () => {
        executeQuery();
    });
}

const cancelButton = document.getElementById('cancelButton');
if (cancelButton) {
    cancelButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancelQuery' });
    });
}

const connectButton = document.getElementById('connectButton');
if (connectButton) {
    connectButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'manageConnections' });
    });
}

const estimatedPlanButton = document.getElementById('estimatedPlanButton');
if (estimatedPlanButton) {
    estimatedPlanButton.addEventListener('click', () => {
        executeEstimatedPlan();
    });
}

const actualPlanCheckbox = document.getElementById('actualPlanCheckbox');
if (actualPlanCheckbox) {
    actualPlanCheckbox.addEventListener('change', (e) => {
        actualPlanEnabled = e.target.checked;
    });
}


// Initialize tabs
if (typeof initTabs === 'function') {
    initTabs();
}


