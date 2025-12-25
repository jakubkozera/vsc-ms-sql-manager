(function() {
    const vscode = acquireVsCodeApi();
    
    let allChanges = [];
    let diffEditor = null;
    let selectedChange = null;
    let groupedChanges = {
        tables: [],
        views: [],
        programmability: [],
        users: []
    };

    // DOM elements
    const sourceConnectionBtn = document.getElementById('sourceConnectionSelect');
    const sourceConnectionMenu = document.getElementById('sourceConnectionMenu');
    const sourceDatabaseBtn = document.getElementById('sourceDatabaseSelect');
    const sourceDatabaseMenu = document.getElementById('sourceDatabaseMenu');
    const sourceDatabaseLabel = document.getElementById('sourceDatabaseLabel');
    const sourceDatabaseDropdown = document.getElementById('source-database-dropdown');
    
    const targetConnectionBtn = document.getElementById('targetConnectionSelect');
    const targetConnectionMenu = document.getElementById('targetConnectionMenu');
    const targetDatabaseBtn = document.getElementById('targetDatabaseSelect');
    const targetDatabaseMenu = document.getElementById('targetDatabaseMenu');
    const targetDatabaseLabel = document.getElementById('targetDatabaseLabel');
    const targetDatabaseDropdown = document.getElementById('target-database-dropdown');
    
    const connectButton = document.getElementById('connectButton');
    const compareButton = document.getElementById('compareButton');
    const swapButton = document.getElementById('swapButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const resultsSection = document.getElementById('resultsSection');
    const emptyState = document.getElementById('emptyState');
    const changesTree = document.getElementById('changesTree');
    const diffHeader = document.getElementById('diffHeader');
    const editorContainer = document.getElementById('editorContainer');
    const emptyDiffState = document.getElementById('emptyDiffState');
    const comparisonInfo = document.getElementById('comparisonInfo');
    const sourceConnectionInfo = document.getElementById('sourceConnectionInfo');
    const targetConnectionInfo = document.getElementById('targetConnectionInfo');
    
    let selectedSourceConnection = null;
    let selectedSourceDatabase = null;
    let selectedTargetConnection = null;
    let selectedTargetDatabase = null;

    // Setup dropdown handlers for SOURCE
    setupDropdown(sourceConnectionBtn, sourceConnectionMenu, (item) => {
        selectedSourceConnection = item.dataset.value;
        sourceConnectionBtn.textContent = item.textContent;
        
        const connection = allConnections.find(c => c.id === selectedSourceConnection);
        
        if (connection && connection.connectionType === 'server') {
            // Show database selector for server connections
            sourceDatabaseLabel.style.display = 'inline-block';
            sourceDatabaseDropdown.style.display = 'inline-block';
            sourceDatabaseBtn.disabled = false;
            sourceDatabaseBtn.textContent = 'Select database...';
            selectedSourceDatabase = null;
            sourceDatabaseMenu.innerHTML = '';
            
            vscode.postMessage({
                command: 'getDatabasesForConnection',
                connectionId: selectedSourceConnection,
                target: 'source'
            });
        } else {
            // Hide database selector for direct database connections
            sourceDatabaseLabel.style.display = 'none';
            sourceDatabaseDropdown.style.display = 'none';
            selectedSourceDatabase = null;
            sourceDatabaseBtn.textContent = 'Select database...';
        }
        
        checkIfReadyToCompare();
    });
    
    setupDropdown(sourceDatabaseBtn, sourceDatabaseMenu, (item) => {
        selectedSourceDatabase = item.dataset.value;
        sourceDatabaseBtn.textContent = item.textContent;
        checkIfReadyToCompare();
    });
    
    // Setup dropdown handlers for TARGET
    setupDropdown(targetConnectionBtn, targetConnectionMenu, (item) => {
        selectedTargetConnection = item.dataset.value;
        targetConnectionBtn.textContent = item.textContent;
        
        const connection = allConnections.find(c => c.id === selectedTargetConnection);
        
        if (connection && connection.connectionType === 'server') {
            // Show database selector for server connections
            targetDatabaseLabel.style.display = 'inline-block';
            targetDatabaseDropdown.style.display = 'inline-block';
            targetDatabaseBtn.disabled = false;
            targetDatabaseBtn.textContent = 'Select database...';
            selectedTargetDatabase = null;
            targetDatabaseMenu.innerHTML = '';
            
            vscode.postMessage({
                command: 'getDatabasesForConnection',
                connectionId: selectedTargetConnection,
                target: 'target'
            });
        } else {
            // Hide database selector for direct database connections
            targetDatabaseLabel.style.display = 'none';
            targetDatabaseDropdown.style.display = 'none';
            selectedTargetDatabase = null;
            targetDatabaseBtn.textContent = 'Select database...';
        }
        
        checkIfReadyToCompare();
    });
    
    setupDropdown(targetDatabaseBtn, targetDatabaseMenu, (item) => {
        selectedTargetDatabase = item.dataset.value;
        targetDatabaseBtn.textContent = item.textContent;
        checkIfReadyToCompare();
    });
    
    // Connect button - opens connection management webview
    connectButton.addEventListener('click', () => {
        vscode.postMessage({
            command: 'manageConnections'
        });
    });

    // Compare button click
    compareButton.addEventListener('click', () => {
        if (isReadyToCompare()) {
            vscode.postMessage({
                command: 'compareSchemas',
                sourceConnectionId: selectedSourceConnection,
                sourceDatabase: selectedSourceDatabase,
                targetConnectionId: selectedTargetConnection,
                targetDatabase: selectedTargetDatabase
            });
        }
    });
    
    // Swap button click - swap source and target
    swapButton.addEventListener('click', () => {
        // Store current source values
        const tempSourceConnection = selectedSourceConnection;
        const tempSourceDatabase = selectedSourceDatabase;
        const tempSourceConnectionText = sourceConnectionBtn.textContent;
        const tempSourceDatabaseText = sourceDatabaseBtn.textContent;
        const tempSourceDatabaseVisible = sourceDatabaseDropdown.style.display !== 'none';
        
        // Move target to source
        selectedSourceConnection = selectedTargetConnection;
        selectedSourceDatabase = selectedTargetDatabase;
        sourceConnectionBtn.textContent = targetConnectionBtn.textContent;
        sourceDatabaseBtn.textContent = targetDatabaseBtn.textContent;
        
        // Update source database dropdown visibility
        if (selectedSourceConnection) {
            const sourceConn = allConnections.find(c => c.id === selectedSourceConnection);
            if (sourceConn && sourceConn.connectionType === 'server') {
                sourceDatabaseLabel.style.display = 'inline-block';
                sourceDatabaseDropdown.style.display = 'inline-block';
                sourceDatabaseBtn.disabled = false;
            } else {
                sourceDatabaseLabel.style.display = 'none';
                sourceDatabaseDropdown.style.display = 'none';
            }
        }
        
        // Move source to target
        selectedTargetConnection = tempSourceConnection;
        selectedTargetDatabase = tempSourceDatabase;
        targetConnectionBtn.textContent = tempSourceConnectionText;
        targetDatabaseBtn.textContent = tempSourceDatabaseText;
        
        // Update target database dropdown visibility
        if (selectedTargetConnection) {
            const targetConn = allConnections.find(c => c.id === selectedTargetConnection);
            if (targetConn && targetConn.connectionType === 'server') {
                targetDatabaseLabel.style.display = 'inline-block';
                targetDatabaseDropdown.style.display = 'inline-block';
                targetDatabaseBtn.disabled = false;
            } else {
                targetDatabaseLabel.style.display = 'none';
                targetDatabaseDropdown.style.display = 'none';
            }
        }
        
        // Update selected states in dropdown menus
        updateDropdownSelections();
        
        checkIfReadyToCompare();
    });
    
    function updateDropdownSelections() {
        // Update source connection dropdown selection
        sourceConnectionMenu.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.value === selectedSourceConnection);
        });
        
        // Update source database dropdown selection
        sourceDatabaseMenu.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.value === selectedSourceDatabase);
        });
        
        // Update target connection dropdown selection
        targetConnectionMenu.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.value === selectedTargetConnection);
        });
        
        // Update target database dropdown selection
        targetDatabaseMenu.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.value === selectedTargetDatabase);
        });
    }
    
    function checkIfReadyToCompare() {
        const sourceReady = selectedSourceConnection && (selectedSourceDatabase || !needsDatabaseForConnection(selectedSourceConnection));
        const targetReady = selectedTargetConnection && (selectedTargetDatabase || !needsDatabaseForConnection(selectedTargetConnection));
        
        const ready = sourceReady && targetReady;
        
        // Compare button is always visible, just control disabled state
        compareButton.disabled = !ready;
        
        // Swap button only shows when both are selected
        if (ready) {
            swapButton.style.display = 'inline-flex';
        } else {
            swapButton.style.display = 'none';
        }
        
        return ready;
    }
    
    function isReadyToCompare() {
        return checkIfReadyToCompare();
    }
    
    function needsDatabaseForConnection(connectionId) {
        const connection = allConnections.find(c => c.id === connectionId);
        return connection && connection.connectionType === 'server';
    }
    
    let allConnections = [];
    
    // Cache loading state tracking
    let cacheLoadingStates = {
        source: false,
        target: false
    };
    
    function handleCacheLoadingStatus(stage, status) {
        cacheLoadingStates[stage] = (status === 'loading');
        
        // Update compare button state
        const isLoading = cacheLoadingStates.source || cacheLoadingStates.target;
        const isReady = isReadyToCompare();
        
        if (isLoading) {
            compareButton.disabled = true;
            compareButton.innerHTML = '<span class="codicon codicon-loading codicon-modifier-spin"></span> Loading Cache...';
        } else if (isReady) {
            compareButton.disabled = false;
            compareButton.textContent = 'Compare';
        } else {
            compareButton.disabled = true;
            compareButton.textContent = 'Compare';
        }
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.command) {
            case 'init':
                allConnections = message.connections;
                populateConnectionList(sourceConnectionMenu, message.connections);
                populateConnectionList(targetConnectionMenu, message.connections);
                
                // Auto-select source if provided
                if (message.sourceConnectionId && message.sourceDatabase) {
                    const sourceConn = allConnections.find(c => c.id === message.sourceConnectionId);
                    if (sourceConn) {
                        selectedSourceConnection = message.sourceConnectionId;
                        sourceConnectionBtn.textContent = sourceConn.name;
                        
                        if (sourceConn.connectionType === 'server') {
                            selectedSourceDatabase = message.sourceDatabase;
                            sourceDatabaseBtn.textContent = message.sourceDatabase;
                            sourceDatabaseLabel.style.display = 'inline-block';
                            sourceDatabaseDropdown.style.display = 'inline-block';
                            sourceDatabaseBtn.disabled = false;
                        }
                    }
                }
                
                checkIfReadyToCompare();
                break;
            
            case 'cacheLoadingStatus':
                handleCacheLoadingStatus(message.stage, message.status);
                break;
                
            case 'databasesForConnection':
                if (message.target === 'source') {
                    populateDatabaseList(sourceDatabaseMenu, message.databases, message.autoSelect, 'source');
                } else {
                    populateDatabaseList(targetDatabaseMenu, message.databases, message.autoSelect, 'target');
                }
                break;
                
            case 'comparisonStarted':
                showLoading();
                actualSourceDatabase = message.sourceDatabase;
                actualTargetDatabase = message.targetDatabase;
                updateComparisonInfo();
                break;
                
            case 'comparisonResult':
                hideLoading();
                displayResults(message.changes);
                break;
                
            case 'comparisonError':
                hideLoading();
                vscode.postMessage({
                    command: 'showError',
                    message: message.error
                });
                break;
                
            case 'schemaDetails':
                updateDiffEditor(message.originalSchema, message.modifiedSchema);
                break;
                
            case 'connectionsUpdated':
                // Update connections list and refresh dropdowns while preserving selections
                allConnections = message.connections;
                updateConnectionDropdowns();
                
                // Auto-select new connection if provided and needed
                if (message.autoSelectConnectionId) {
                    autoSelectConnectionIfNeeded(message.autoSelectConnectionId);
                }
                break;
        }
    });

    // Initialize Monaco Editors
    initMonacoEditors();
    
    function setupDropdown(button, menu, onSelect) {
        button.addEventListener('click', (e) => {
            if (button.disabled) {
                return;
            }
            e.stopPropagation();
            
            const isOpen = menu.classList.contains('open');
            
            // Close all dropdowns
            document.querySelectorAll('.dropdown-menu.open').forEach(m => {
                m.classList.remove('open');
                m.previousElementSibling.classList.remove('open');
            });
            
            if (!isOpen) {
                menu.classList.add('open');
                button.classList.add('open');
            }
        });
        
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.dropdown-item');
            if (item) {
                e.stopPropagation();
                
                // Remove selected class from all items
                menu.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                
                onSelect(item);
                
                menu.classList.remove('open');
                button.classList.remove('open');
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!button.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('open');
                button.classList.remove('open');
            }
        });
    }

    function populateConnectionList(menuElement, connections) {
        menuElement.innerHTML = '';
        
        connections.forEach(conn => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.dataset.value = conn.id;
            item.textContent = conn.name;
            menuElement.appendChild(item);
        });
    }

    function populateDatabaseList(menuElement, databases, autoSelect, target) {
        menuElement.innerHTML = '';
        
        databases.forEach(db => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.dataset.value = db;
            item.textContent = db;
            menuElement.appendChild(item);
        });
        
        // Auto-select if only one database
        if (autoSelect && databases.length === 1) {
            if (target === 'source') {
                selectedSourceDatabase = databases[0];
                sourceDatabaseBtn.textContent = databases[0];
                sourceDatabaseBtn.disabled = false;
            } else {
                selectedTargetDatabase = databases[0];
                targetDatabaseBtn.textContent = databases[0];
                targetDatabaseBtn.disabled = false;
            }
            
            checkIfReadyToCompare();
            menuElement.querySelector('.dropdown-item')?.classList.add('selected');
        }
    }
    
    function updateConnectionDropdowns() {
        // Store current selections
        const currentSourceConn = selectedSourceConnection;
        const currentTargetConn = selectedTargetConnection;
        
        // Repopulate both connection dropdowns
        populateConnectionList(sourceConnectionMenu, allConnections);
        populateConnectionList(targetConnectionMenu, allConnections);
        
        // Restore source selection if it still exists
        if (currentSourceConn) {
            const sourceStillExists = allConnections.find(c => c.id === currentSourceConn);
            if (sourceStillExists) {
                sourceConnectionMenu.querySelector(`[data-value="${currentSourceConn}"]`)?.classList.add('selected');
            } else {
                // Connection no longer exists, clear selection
                selectedSourceConnection = null;
                sourceConnectionBtn.textContent = 'Select connection...';
                sourceDatabaseLabel.style.display = 'none';
                sourceDatabaseDropdown.style.display = 'none';
            }
        }
        
        // Restore target selection if it still exists
        if (currentTargetConn) {
            const targetStillExists = allConnections.find(c => c.id === currentTargetConn);
            if (targetStillExists) {
                targetConnectionMenu.querySelector(`[data-value="${currentTargetConn}"]`)?.classList.add('selected');
            } else {
                // Connection no longer exists, clear selection
                selectedTargetConnection = null;
                targetConnectionBtn.textContent = 'Select connection...';
                targetDatabaseLabel.style.display = 'none';
                targetDatabaseDropdown.style.display = 'none';
            }
        }
        
        checkIfReadyToCompare();
    }
    
    function autoSelectConnectionIfNeeded(connectionId) {
        const connection = allConnections.find(c => c.id === connectionId);
        if (!connection) return;
        
        // If neither source nor target is selected, select as source
        if (!selectedSourceConnection && !selectedTargetConnection) {
            selectConnection('source', connection);
        }
        // If only source is selected and target is not, select as target
        else if (selectedSourceConnection && !selectedTargetConnection) {
            selectConnection('target', connection);
        }
        // If only target is selected and source is not, select as source
        else if (!selectedSourceConnection && selectedTargetConnection) {
            selectConnection('source', connection);
        }
        // If both are selected, don't auto-select anything
    }
    
    function selectConnection(type, connection) {
        if (type === 'source') {
            selectedSourceConnection = connection.id;
            sourceConnectionBtn.textContent = connection.name;
            
            // Update dropdown selection
            sourceConnectionMenu.querySelectorAll('.dropdown-item').forEach(item => {
                item.classList.toggle('selected', item.dataset.value === connection.id);
            });
            
            if (connection.connectionType === 'server') {
                // Show database selector for server connections
                sourceDatabaseLabel.style.display = 'inline-block';
                sourceDatabaseDropdown.style.display = 'inline-block';
                sourceDatabaseBtn.disabled = false;
                sourceDatabaseBtn.textContent = 'Select database...';
                selectedSourceDatabase = null;
                sourceDatabaseMenu.innerHTML = '';
                
                vscode.postMessage({
                    command: 'getDatabasesForConnection',
                    connectionId: selectedSourceConnection,
                    target: 'source'
                });
            } else {
                // Hide database selector for direct database connections
                sourceDatabaseLabel.style.display = 'none';
                sourceDatabaseDropdown.style.display = 'none';
                selectedSourceDatabase = null;
                sourceDatabaseBtn.textContent = 'Select database...';
            }
        } else if (type === 'target') {
            selectedTargetConnection = connection.id;
            targetConnectionBtn.textContent = connection.name;
            
            // Update dropdown selection
            targetConnectionMenu.querySelectorAll('.dropdown-item').forEach(item => {
                item.classList.toggle('selected', item.dataset.value === connection.id);
            });
            
            if (connection.connectionType === 'server') {
                // Show database selector for server connections
                targetDatabaseLabel.style.display = 'inline-block';
                targetDatabaseDropdown.style.display = 'inline-block';
                targetDatabaseBtn.disabled = false;
                targetDatabaseBtn.textContent = 'Select database...';
                selectedTargetDatabase = null;
                targetDatabaseMenu.innerHTML = '';
                
                vscode.postMessage({
                    command: 'getDatabasesForConnection',
                    connectionId: selectedTargetConnection,
                    target: 'target'
                });
            } else {
                // Hide database selector for direct database connections
                targetDatabaseLabel.style.display = 'none';
                targetDatabaseDropdown.style.display = 'none';
                selectedTargetDatabase = null;
                targetDatabaseBtn.textContent = 'Select database...';
            }
        }
        
        checkIfReadyToCompare();
    }

    function showLoading() {
        resultsSection.style.display = 'none';
        emptyState.classList.add('hidden');
        loadingIndicator.classList.remove('hidden');
    }

    function hideLoading() {
        loadingIndicator.classList.add('hidden');
    }

    function displayResults(changes) {
        allChanges = changes;
        
        if (changes.length === 0) {
            emptyState.classList.remove('hidden');
            resultsSection.style.display = 'none';
            return;
        }
        
        emptyState.classList.add('hidden');
        resultsSection.style.display = 'flex';
        
        // Show comparison info
        comparisonInfo.style.display = 'block';
        
        // Group changes by type
        groupChangesByType(changes);
        
        // Render grouped changes in sidebar
        renderChangesTree();
        
        // Force layout recalculation for Monaco diff editor after it becomes visible
        if (diffEditor) {
            setTimeout(() => {
                diffEditor.layout();
            }, 50);
        }
    }
    
    let actualSourceDatabase = null;
    let actualTargetDatabase = null;
    
    function updateComparisonInfo() {
        if (selectedSourceConnection && selectedTargetConnection) {
            const sourceConn = allConnections.find(c => c.id === selectedSourceConnection);
            const targetConn = allConnections.find(c => c.id === selectedTargetConnection);
            
            let sourceText = sourceConn ? sourceConn.name : 'Unknown';
            let targetText = targetConn ? targetConn.name : 'Unknown';
            
            // Add database info - use actual database names that will be used in comparison
            if (actualSourceDatabase) {
                sourceText += '.' + actualSourceDatabase;
            }
            
            if (actualTargetDatabase) {
                targetText += '.' + actualTargetDatabase;
            }
            
            sourceConnectionInfo.textContent = sourceText;
            targetConnectionInfo.textContent = targetText;
            
            comparisonInfo.style.display = 'block';
        }
    }

    function groupChangesByType(changes) {
        groupedChanges = {
            tables: [],
            views: [],
            programmability: [],
            users: []
        };
        
        changes.forEach(change => {
            const type = change.objectType.toLowerCase();
            
            if (type === 'table') {
                groupedChanges.tables.push(change);
            } else if (type === 'view') {
                groupedChanges.views.push(change);
            } else if (['procedure', 'function', 'trigger'].includes(type)) {
                groupedChanges.programmability.push(change);
            } else if (type === 'user') {
                groupedChanges.users.push(change);
            }
        });
    }

    function renderChangesTree() {
        changesTree.innerHTML = '';
        
        // Render Tables group
        if (groupedChanges.tables.length > 0) {
            changesTree.appendChild(createGroupElement('Tables', groupedChanges.tables, 'table'));
        }
        
        // Render Views group
        if (groupedChanges.views.length > 0) {
            changesTree.appendChild(createGroupElement('Views', groupedChanges.views, 'view'));
        }
        
        // Render Programmability group
        if (groupedChanges.programmability.length > 0) {
            changesTree.appendChild(createGroupElement('Programmability', groupedChanges.programmability, 'code'));
        }

        // Render Users group
        if (groupedChanges.users.length > 0) {
            changesTree.appendChild(createGroupElement('Users', groupedChanges.users, 'user'));
        }
    }

    function createGroupElement(title, items, iconType) {
        const group = document.createElement('div');
        group.className = 'change-group expanded';
        
        const header = document.createElement('div');
        header.className = 'group-header';
        
        const icon = getGroupIcon(iconType);
        
        header.innerHTML = `
            <div class="group-chevron">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 6l6 6l-6 6" />
                </svg>
            </div>
            <div class="group-icon">${icon}</div>
            <div class="group-title">${title}</div>
            <div class="group-count">${items.length}</div>
        `;
        
        header.addEventListener('click', () => {
            group.classList.toggle('expanded');
        });
        
        const content = document.createElement('div');
        content.className = 'group-content';
        
        items.forEach(change => {
            content.appendChild(createChangeItem(change));
        });
        
        group.appendChild(header);
        group.appendChild(content);
        
        return group;
    }

    function getGroupIcon(type) {
        switch (type) {
            case 'table':
                return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="3" y1="9" x2="21" y2="9"></line>
                    <line x1="9" y1="21" x2="9" y2="9"></line>
                </svg>`;
            case 'view':
                return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>`;
            case 'code':
                return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="16 18 22 12 16 6"></polyline>
                    <polyline points="8 6 2 12 8 18"></polyline>
                </svg>`;
            case 'user':
                return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>`;
            default:
                return '';
        }
    }

    function createChangeItem(change) {
        const item = document.createElement('div');
        item.className = `change-item ${change.changeType}`;
        
        let statusText = '';
        let statusClass = '';
        
        if (change.changeType === 'add') {
            statusText = '+';
            statusClass = 'added';
        } else if (change.changeType === 'delete') {
            statusText = '-';
            statusClass = 'deleted';
        } else {
            statusText = 'M';
            statusClass = 'modified';
        }
        
        // Determine source/target names based on change type
        let sourceName = change.changeType === 'delete' ? '' : change.objectName;
        let targetName = change.changeType === 'add' ? '' : change.objectName;
        
        item.innerHTML = `
            <span class="change-status ${statusClass}"></span>
            <span class="change-name">${change.objectName}</span>
        `;
        
        item.addEventListener('click', () => {
            selectChange(change, item);
        });
        
        return item;
    }

    function selectChange(change, itemElement) {
        selectedChange = change;
        
        // Update selected state in UI
        document.querySelectorAll('.change-item').forEach(item => {
            item.classList.remove('selected');
        });
        itemElement.classList.add('selected');
        
        // Show diff header
        diffHeader.style.display = 'flex';
        emptyDiffState.style.display = 'none';
        editorContainer.style.display = 'grid';
        
        // Update header info
        document.getElementById('selectedObjectName').textContent = change.objectName;
        
        // Request schema details from backend
        vscode.postMessage({
            command: 'getSchemaDetails',
            change: change
        });
    }

    function initMonacoEditors() {
        require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], function() {
            const container = document.getElementById('editorContainer');
            
            diffEditor = monaco.editor.createDiffEditor(container, {
                theme: 'vs-dark',
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                renderSideBySide: true,
                lineNumbers: 'on',
                glyphMargin: false,
                folding: false,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 3,
                renderLineHighlight: 'none',
                overviewRulerLanes: 0,
                enableSplitViewResizing: true,
                renderOverviewRuler: true,
                scrollbar: {
                    vertical: 'auto',
                    horizontal: 'auto'
                }
            });

            window.addEventListener('resize', () => {
                if (diffEditor) {
                    diffEditor.layout();
                }
            });
        });
    }

    function updateDiffEditor(originalContent, modifiedContent) {
        if (!diffEditor) {
            setTimeout(() => updateDiffEditor(originalContent, modifiedContent), 500);
            return;
        }
        
        const originalModel = monaco.editor.createModel(originalContent || '-- No content', 'sql');
        const modifiedModel = monaco.editor.createModel(modifiedContent || '-- No content', 'sql');
        
        diffEditor.setModel({
            original: originalModel,
            modified: modifiedModel
        });
        
        // Layout editor
        setTimeout(() => {
            diffEditor.layout();
        }, 50);
    }
    // Global function for toggling sidebar
    window.toggleSidebar = function() {
        const sidebar = document.getElementById('changesSidebar');
        const expandBtn = document.getElementById('expandSidebarBtn');
        
        sidebar.classList.toggle('collapsed');
        
        // Show/hide expand button
        if (sidebar.classList.contains('collapsed')) {
            expandBtn.style.display = 'flex';
        } else {
            expandBtn.style.display = 'none';
        }
        
        // Re-layout editor after sidebar animation
        setTimeout(() => {
            if (diffEditor) {
                diffEditor.layout();
            }
        }, 300);
    };

    // Notify extension that webview is ready
    vscode.postMessage({ command: 'ready' });
})();
