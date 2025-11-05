(function() {
    const vscode = acquireVsCodeApi();
    
    let allChanges = [];
    let leftEditor = null;
    let rightEditor = null;
    let selectedRow = null;

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
    const changesTableBody = document.getElementById('changesTableBody');
    
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
            document.getElementById('comparisonSection').style.display = 'none';
            document.getElementById('editorContainer').style.display = 'none';
            return;
        }
        
        emptyState.classList.add('hidden');
        resultsSection.style.display = 'flex';
        document.getElementById('comparisonSection').style.display = 'block';
        document.getElementById('editorContainer').style.display = 'grid';
        
        // Force layout recalculation for Monaco editors after they become visible
        if (leftEditor && rightEditor) {
            setTimeout(() => {
                leftEditor.layout();
                rightEditor.layout();
            }, 50);
        }
        
        renderChanges();
    }

    function renderChanges() {
        changesTableBody.innerHTML = '';
        
        allChanges.forEach((change, index) => {
            const row = createTableRow(change, index);
            changesTableBody.appendChild(row);
        });
    }

    function createTableRow(change, index) {
        const row = document.createElement('div');
        row.className = 'table-row';
        row.setAttribute('data-index', index);
        
        // Determine source and target names based on change type
        let sourceName = '';
        let targetName = '';
        let actionText = '';
        
        if (change.changeType === 'add') {
            sourceName = change.objectName;
            targetName = '';
            actionText = 'Add';
        } else if (change.changeType === 'delete') {
            sourceName = '';
            targetName = change.objectName;
            actionText = 'Delete';
        } else {
            sourceName = change.objectName;
            targetName = change.objectName;
            actionText = 'Change';
        }
        
        row.innerHTML = `
            <div>${change.objectType.charAt(0).toUpperCase() + change.objectType.slice(1)}</div>
            <div>${sourceName}</div>
            <div></div>
            <div>${actionText}</div>
            <div>${targetName}</div>
        `;
        
        // Click handler
        row.addEventListener('click', () => {
            document.querySelectorAll('.table-row').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            selectedRow = row;
            showDiff(change);
        });
        
        return row;
    }

    function showDiff(change) {
        // Request schema details from backend
        vscode.postMessage({
            command: 'getSchemaDetails',
            change: change
        });
    }

    function initMonacoEditors() {
        require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], function() {
            leftEditor = monaco.editor.create(document.getElementById('leftEditor'), {
                value: '',
                language: 'sql',
                theme: 'vs-dark',
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                glyphMargin: false,
                folding: false,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 3,
                renderLineHighlight: 'none',
                overviewRulerLanes: 0
            });

            rightEditor = monaco.editor.create(document.getElementById('rightEditor'), {
                value: '',
                language: 'sql',
                theme: 'vs-dark',
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                glyphMargin: false,
                folding: false,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 3,
                renderLineHighlight: 'none',
                overviewRulerLanes: 0
            });

            window.addEventListener('resize', () => {
                leftEditor.layout();
                rightEditor.layout();
            });
        });
    }

    function updateDiffEditor(originalContent, modifiedContent) {
        if (!leftEditor || !rightEditor) {
            setTimeout(() => updateDiffEditor(originalContent, modifiedContent), 500);
            return;
        }
        
        leftEditor.setValue(originalContent || '');
        rightEditor.setValue(modifiedContent || '');
    }

    // Request initial data
    vscode.postMessage({ command: 'ready' });
})();
