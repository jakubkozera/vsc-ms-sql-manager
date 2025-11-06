(function() {
    const vscode = acquireVsCodeApi();
    
    let allChanges = [];
    let diffEditor = null;
    let selectedChange = null;
    let groupedChanges = {
        tables: [],
        views: [],
        programmability: []
    };

    // DOM elements
    const sourceDatabaseElement = document.getElementById('sourceDatabase');
    const targetConnectionBtn = document.getElementById('targetConnectionSelect');
    const targetConnectionMenu = document.getElementById('targetConnectionMenu');
    const targetDatabaseBtn = document.getElementById('targetDatabaseSelect');
    const targetDatabaseMenu = document.getElementById('targetDatabaseMenu');
    const compareButton = document.getElementById('compareButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const resultsSection = document.getElementById('resultsSection');
    const emptyState = document.getElementById('emptyState');
    const changesTree = document.getElementById('changesTree');
    const diffHeader = document.getElementById('diffHeader');
    const editorContainer = document.getElementById('editorContainer');
    const emptyDiffState = document.getElementById('emptyDiffState');
    
    let selectedTargetConnection = null;
    let selectedTargetDatabase = null;

    // Setup dropdown handlers
    setupDropdown(targetConnectionBtn, targetConnectionMenu, (item) => {
        selectedTargetConnection = item.dataset.value;
        targetConnectionBtn.textContent = item.textContent;
        targetDatabaseBtn.disabled = false;
        targetDatabaseBtn.textContent = 'Select database...';
        selectedTargetDatabase = null;
        targetDatabaseMenu.innerHTML = '';
        compareButton.disabled = true;
        
        vscode.postMessage({
            command: 'getDatabasesForConnection',
            connectionId: selectedTargetConnection
        });
    });
    
    setupDropdown(targetDatabaseBtn, targetDatabaseMenu, (item) => {
        selectedTargetDatabase = item.dataset.value;
        targetDatabaseBtn.textContent = item.textContent;
        compareButton.disabled = !selectedTargetConnection || !selectedTargetDatabase;
    });

    // Compare button click
    compareButton.addEventListener('click', () => {
        if (selectedTargetConnection && selectedTargetDatabase) {
            vscode.postMessage({
                command: 'compareSchemas',
                targetConnectionId: selectedTargetConnection,
                targetDatabase: selectedTargetDatabase
            });
        }
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.command) {
            case 'init':
                sourceDatabaseElement.textContent = message.sourceDatabase;
                populateConnectionList(message.connections);
                break;
                
            case 'databasesForConnection':
                populateDatabaseList(message.databases, message.autoSelect);
                break;
                
            case 'comparisonStarted':
                showLoading();
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

    function populateConnectionList(connections) {
        targetConnectionMenu.innerHTML = '';
        
        connections.forEach(conn => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.dataset.value = conn.id;
            item.textContent = conn.name;
            targetConnectionMenu.appendChild(item);
        });
    }

    function populateDatabaseList(databases, autoSelect) {
        targetDatabaseMenu.innerHTML = '';
        
        databases.forEach(db => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.dataset.value = db;
            item.textContent = db;
            targetDatabaseMenu.appendChild(item);
        });
        
        // Auto-select if only one database
        if (autoSelect && databases.length === 1) {
            selectedTargetDatabase = databases[0];
            targetDatabaseBtn.textContent = databases[0];
            targetDatabaseBtn.disabled = false;
            compareButton.disabled = !selectedTargetConnection || !selectedTargetDatabase;
            targetDatabaseMenu.querySelector('.dropdown-item')?.classList.add('selected');
        }
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

    function groupChangesByType(changes) {
        groupedChanges = {
            tables: [],
            views: [],
            programmability: []
        };
        
        changes.forEach(change => {
            const type = change.objectType.toLowerCase();
            
            if (type === 'table') {
                groupedChanges.tables.push(change);
            } else if (type === 'view') {
                groupedChanges.views.push(change);
            } else if (['procedure', 'function', 'trigger'].includes(type)) {
                groupedChanges.programmability.push(change);
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
