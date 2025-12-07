
let queryTimerInterval = null;
let queryStartTime = null;

/**
 * Display messages in the messages tab
 */
function displayMessages(messages) {
    const messagesContent = document.getElementById('messagesContent');
    
    if (!messages || messages.length === 0) {
        messagesContent.innerHTML = '<div class="message info">No messages</div>';
        return;
    }

    let messagesHtml = '';
    messages.forEach(msg => {
        const msgClass = msg.type || 'info';
        messagesHtml += `<div class="message ${msgClass}">${escapeHtml(msg.text)}</div>`;
    });
    
    messagesContent.innerHTML = messagesHtml;
}

/**
 * Show error message and switch to messages tab
 */
function showError(error, messages) {
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusLabel = document.getElementById('statusLabel');
    const resizer = document.getElementById('resizer');
    const resultsContainer = document.getElementById('resultsContainer');
    
    // Stop the loading timer
    if (typeof stopLoadingTimer === 'function') {
        stopLoadingTimer();
    }
    
    lastResults = [];
    lastMessages = messages || [{ type: 'error', text: error }];
    
    if (executeButton) executeButton.disabled = false;
    if (cancelButton) cancelButton.disabled = true;
    
    const isCancelled = error.includes('cancel');
    if (statusLabel) statusLabel.textContent = isCancelled ? 'Query cancelled' : 'Query failed';

    if (resultsContainer) resultsContainer.classList.add('visible');
    if (resizer) resizer.classList.add('visible');

    // Show results panel with initial height if not already set
    if (resultsContainer && !resultsContainer.style.flex) {
        resultsContainer.style.flex = '0 0 300px';
    }

    // Switch to messages tab to show error
    document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
    const messagesTab = document.querySelector('.results-tab[data-tab="messages"]');
    if (messagesTab) messagesTab.classList.add('active');
    currentTab = 'messages';
    
    // Show messages container, hide results
    const resultsContent = document.getElementById('resultsContent');
    const messagesContent = document.getElementById('messagesContent');
    
    if (resultsContent) resultsContent.style.display = 'none';
    if (messagesContent) messagesContent.style.display = 'block';

    displayMessages(lastMessages);
}

// Custom Dropdown Class for Connection and Database Selectors
class CustomDropdown {
    constructor(containerId, onSelect) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.warn(`CustomDropdown: Container with id '${containerId}' not found`);
            return;
        }
        
        this.trigger = this.container.querySelector('.dropdown-trigger');
        this.menu = this.container.querySelector('.dropdown-menu');
        this.onSelect = onSelect;
        this.selectedValue = null;

        if (this.trigger && this.menu) {
            this.init();
        } else {
            console.warn(`CustomDropdown: Required elements not found in container '${containerId}'`);
        }
    }

    init() {
        if (!this.trigger || !this.container) return;
        
        // Toggle dropdown on trigger click
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    toggle() {
        if (!this.menu || !this.trigger) return;
        
        const isOpen = this.menu.classList.contains('open');

        // Close all other dropdowns
        document.querySelectorAll('.dropdown-menu.open').forEach(menu => {
            menu.classList.remove('open');
        });
        document.querySelectorAll('.dropdown-trigger.open').forEach(trigger => {
            trigger.classList.remove('open');
        });

        if (!isOpen) {
            this.open();
        } else {
            this.close();
        }
    }

    open() {
        if (!this.menu || !this.trigger) return;
        
        this.menu.classList.add('open');
        this.trigger.classList.add('open');
    }

    close() {
        if (!this.menu || !this.trigger) return;
        
        this.menu.classList.remove('open');
        this.trigger.classList.remove('open');
    }

    setItems(items) {
        if (!this.menu || !this.trigger) return;
        
        // items should be array of {value, text, selected}
        this.menu.innerHTML = '';
        
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'dropdown-item';
            div.textContent = item.text;
            div.dataset.value = item.value;
            
            if (item.selected) {
                div.classList.add('selected');
                this.trigger.textContent = item.text;
                this.selectedValue = item.value;
            }
            
            div.addEventListener('click', () => {
                this.selectItem(item.value, item.text);
            });
            
            this.menu.appendChild(div);
        });
    }

    selectItem(value, text) {
        if (!this.menu || !this.trigger) return;
        
        // Remove selected class from all items
        this.menu.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selected'));

        // Add selected class to clicked item
        const selectedItem = this.menu.querySelector(`[data-value="${value}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }

        // Update trigger text
        this.trigger.textContent = text;
        this.selectedValue = value;

        // Close dropdown
        this.close();

        // Call the callback
        if (this.onSelect) {
            this.onSelect(value);
        }
    }

    setValue(value, text) {
        this.trigger.textContent = text;
        this.selectedValue = value;
        
        // Update selected state in menu
        this.menu.querySelectorAll('.dropdown-item').forEach(i => {
            i.classList.remove('selected');
            if (i.dataset.value === value) {
                i.classList.add('selected');
            }
        });
    }

    setDisabled(disabled) {
        this.trigger.disabled = disabled;
    }

    show() {
        this.container.style.display = 'inline-block';
    }

    hide() {
        this.container.style.display = 'none';
    }
}

function showLoading() {
    const resultsContent = document.getElementById('resultsContent');
    const statusLabel = document.getElementById('statusLabel');
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const resizer = document.getElementById('resizer');
    const resultsContainer = document.getElementById('resultsContainer');
    
    // Create loading content with spinner and timer
    const loadingHtml = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <div>Executing query...</div>
            <div class="loading-timer" id="loadingTimer">00:00</div>
        </div>
    `;
    
    if (resultsContent) resultsContent.innerHTML = loadingHtml;
    if (resultsContainer) resultsContainer.classList.add('visible');
    if (resizer) resizer.classList.add('visible');
    
    if (executeButton) executeButton.disabled = true;
    if (cancelButton) cancelButton.disabled = false;
    if (statusLabel) statusLabel.textContent = 'Executing query...';

    // Show results panel with initial height if not already set
    if (resultsContainer && !resultsContainer.style.flex) {
        resultsContainer.style.flex = '0 0 300px';
    }

    // Switch to results tab
    document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
    const resultsTab = document.querySelector('.results-tab[data-tab="results"]');
    if (resultsTab) {
        resultsTab.classList.add('active');
    }
    currentTab = 'results';
    
    // Ensure results container is visible and messages is hidden
    const messagesContent = document.getElementById('messagesContent');
    if (resultsContent) {
        resultsContent.style.display = 'block';
    }
    if (messagesContent) {
        messagesContent.style.display = 'none';
    }
    
    // Start the timer
    startLoadingTimer();
}

function startLoadingTimer() {
    queryStartTime = Date.now();
    
    // Clear any existing timer
    if (queryTimerInterval) {
        clearInterval(queryTimerInterval);
    }
    
    // Update timer every 100ms for smooth display
    queryTimerInterval = setInterval(() => {
        const elapsed = Date.now() - queryStartTime;
        const seconds = Math.floor(elapsed / 1000);
        const milliseconds = Math.floor((elapsed % 1000) / 100);
        
        const timerElement = document.getElementById('loadingTimer');
        if (timerElement) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            const timeString = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds}`;
            timerElement.textContent = timeString;
        }
    }, 100);
}

function updateConnectionsList(connections, currentId, currentDatabase) {
    if (!connectionDropdown) return;

    const items = connections.map(c => ({
        value: c.id,
        text: c.name || c.server,
        selected: c.id === currentId
    }));

    connectionDropdown.setItems(items);
    
    // Update current selection text if found
    const current = connections.find(c => c.id === currentId);
    if (current) {
        connectionDropdown.setValue(current.id, current.name || current.server);
        if (typeof currentConnectionId !== 'undefined') currentConnectionId = current.id;
        if (typeof currentDatabaseName !== 'undefined') currentDatabaseName = currentDatabase;
        
        // Show database dropdown if connected AND connection type is 'server'
        if (databaseDropdown) {
            const databaseLabel = document.getElementById('databaseLabel');
            if (current.connectionType === 'server') {
                if (databaseLabel) databaseLabel.style.display = 'inline-block';
                databaseDropdown.show();
                // If we have a database, update the label
                if (currentDatabase) {
                    databaseDropdown.setValue(currentDatabase, currentDatabase);
                } else {
                    databaseDropdown.setValue('', 'Select database');
                }
            } else {
                if (databaseLabel) databaseLabel.style.display = 'none';
                databaseDropdown.hide();
            }
        }
    } else {
        connectionDropdown.setValue('', 'Not Connected');
        if (typeof currentConnectionId !== 'undefined') currentConnectionId = null;
        if (typeof currentDatabaseName !== 'undefined') currentDatabaseName = null;
        if (databaseDropdown) {
            const databaseLabel = document.getElementById('databaseLabel');
            if (databaseLabel) databaseLabel.style.display = 'none';
            databaseDropdown.hide();
        }
    }
}

function updateDatabasesList(databases, currentDatabase) {
    if (!databaseDropdown) return;

    const items = databases.map(db => ({
        value: db,
        text: db,
        selected: db === currentDatabase
    }));

    databaseDropdown.setItems(items);

    if (currentDatabase) {
        databaseDropdown.setValue(currentDatabase, currentDatabase);
        if (typeof currentDatabaseName !== 'undefined') currentDatabaseName = currentDatabase;
    } else {
        databaseDropdown.setValue('', 'Select database');
    }
}


function stopLoadingTimer() {
    if (queryTimerInterval) {
        clearInterval(queryTimerInterval);
        queryTimerInterval = null;
    }
}

function showResults(resultSets, executionTime, rowsAffected, messages, planXml, columnNames) {
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusLabel = document.getElementById('statusLabel');
    
    // Stop the loading timer
    stopLoadingTimer();
    
    lastResults = resultSets;
    lastColumnNames = columnNames;
    lastMessages = messages || [];
    
    executeButton.disabled = false;
    cancelButton.disabled = true;
    
    const totalRows = resultSets.reduce((sum, rs) => sum + rs.length, 0);
    statusLabel.textContent = `Query completed (${resultSets.length} result set(s), ${totalRows} rows)`;

    // Update aggregation stats (initially empty)
    updateAggregationStats();

    // Show/hide plan tabs based on whether we have a plan
    if (planXml) {
        // Parse and store the plan data
        currentQueryPlan = parseQueryPlan(planXml);
        
        // Show plan tabs
        document.querySelectorAll('.results-tab').forEach(tab => {
            if (tab.dataset.tab === 'queryPlan' || tab.dataset.tab === 'planTree' || tab.dataset.tab === 'topOperations') {
                tab.style.display = 'block';
            }
        });
        
        // Display the plan in different views
        displayQueryPlanGraphical(currentQueryPlan);
        displayPlanTree(currentQueryPlan);
        displayTopOperations(currentQueryPlan);
    } else {
        // Hide plan tabs when no plan
        document.querySelectorAll('.results-tab').forEach(tab => {
            if (tab.dataset.tab === 'queryPlan' || tab.dataset.tab === 'planTree' || tab.dataset.tab === 'topOperations') {
                tab.style.display = 'none';
            }
        });
    }

    // Always update both containers
    displayResults(resultSets, planXml, columnNames);
    displayMessages(messages);
    
    // Determine which tab to show by default
    // If there are no result sets (queries like UPDATE, DELETE, INSERT), show Messages tab
    // Otherwise, show Results tab
    const hasResultSets = resultSets && resultSets.length > 0 && resultSets.some(rs => rs && rs.length > 0);
    
    if (!hasResultSets) {
        // Switch to Messages tab for queries without result sets
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        const messagesTab = document.querySelector('.results-tab[data-tab="messages"]');
        if (messagesTab) {
            messagesTab.classList.add('active');
        }
        currentTab = 'messages';
        
        // Show messages content, hide others
        const resultsContent = document.getElementById('resultsContent');
        const messagesContent = document.getElementById('messagesContent');
        const queryPlanContent = document.getElementById('queryPlanContent');
        const planTreeContent = document.getElementById('planTreeContent');
        const topOperationsContent = document.getElementById('topOperationsContent');
        
        if (resultsContent) resultsContent.style.display = 'none';
        if (messagesContent) messagesContent.style.display = 'block';
        if (queryPlanContent) queryPlanContent.style.display = 'none';
        if (planTreeContent) planTreeContent.style.display = 'none';
        if (topOperationsContent) topOperationsContent.style.display = 'none';
    } else {
        // Switch to Results tab for queries with result sets
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        const resultsTab = document.querySelector('.results-tab[data-tab="results"]');
        if (resultsTab) {
            resultsTab.classList.add('active');
        }
        currentTab = 'results';
        
        // Show results content, hide others
        const resultsContent = document.getElementById('resultsContent');
        const messagesContent = document.getElementById('messagesContent');
        const queryPlanContent = document.getElementById('queryPlanContent');
        const planTreeContent = document.getElementById('planTreeContent');
        
        if (resultsContent) resultsContent.style.display = 'block';
        if (messagesContent) messagesContent.style.display = 'none';
        if (queryPlanContent) queryPlanContent.style.display = 'none';
        if (planTreeContent) planTreeContent.style.display = 'none';
        const topOperationsContent = document.getElementById('topOperationsContent');
        if (topOperationsContent) topOperationsContent.style.display = 'none';
    }
}

const connectionDropdown = new CustomDropdown('connection-dropdown', (connectionId) => {
    currentConnectionId = connectionId;
    
    if (connectionId) {
        // Find connection config to check type
        const connection = activeConnections.find(c => c.id === connectionId);
        
        if (connection && connection.connectionType === 'server') {
            // Show database selector and request database list
            const databaseLabel = document.getElementById('databaseLabel');
            if (databaseLabel) {
                databaseLabel.style.display = 'inline-block';
            }
            const databaseDropdownEl = document.getElementById('database-dropdown');
            if (databaseDropdownEl) {
                databaseDropdownEl.style.display = 'inline-block';
            }
            databaseDropdown.show();
            
            vscode.postMessage({
                type: 'switchConnection',
                connectionId: connectionId
            });
        } else {
            // Hide database selector for direct database connections
            const databaseLabel = document.getElementById('databaseLabel');
            if (databaseLabel) {
                databaseLabel.style.display = 'none';
            }
            const databaseDropdownEl = document.getElementById('database-dropdown');
            if (databaseDropdownEl) {
                databaseDropdownEl.style.display = 'none';
            }
            databaseDropdown.hide();
            currentDatabaseName = null;
            
            vscode.postMessage({
                type: 'switchConnection',
                connectionId: connectionId
            });
        }
    } else {
        const databaseLabel = document.getElementById('databaseLabel');
        if (databaseLabel) {
            databaseLabel.style.display = 'none';
        }
        databaseDropdown.hide();
    }
});

const databaseDropdown = new CustomDropdown('database-dropdown', (databaseName) => {
    currentDatabaseName = databaseName;
    
    if (currentConnectionId && databaseName) {
        vscode.postMessage({
            type: 'switchDatabase',
            connectionId: currentConnectionId,
            databaseName: databaseName
        });
    }
});

// Initialize Run Button Dropdown
const executeDropdownToggle = document.getElementById('executeDropdownToggle');
const executeDropdownMenu = document.getElementById('executeDropdownMenu');

if (executeDropdownToggle && executeDropdownMenu) {
    executeDropdownToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        executeDropdownMenu.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!executeDropdownToggle.contains(e.target) && !executeDropdownMenu.contains(e.target)) {
            executeDropdownMenu.classList.remove('show');
        }
    });
}

// Initialize Panel Resizing
const resizer = document.getElementById('resizer');
const resultsContainer = document.getElementById('resultsContainer');

if (resizer && resultsContainer) {
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        const startY = e.clientY;
        const startHeight = resultsContainer.offsetHeight;
        
        // Add resizing class to body to prevent text selection and show cursor
        document.body.classList.add('resizing');

        const doDrag = (e) => {
            if (!isResizing) return;
            // Calculate new height (dragging up increases height)
            const newHeight = startHeight + (startY - e.clientY);
            
            // Min height 30px, Max height window height - 100px
            if (newHeight > 30 && newHeight < window.innerHeight - 100) {
                resultsContainer.style.flex = `0 0 ${newHeight}px`;
                resultsContainer.style.height = `${newHeight}px`;
            }
        };

        const stopDrag = () => {
            isResizing = false;
            document.body.classList.remove('resizing');
            document.removeEventListener('mousemove', doDrag);
            document.removeEventListener('mouseup', stopDrag);
            
            // Trigger resize event for grid to adjust
            window.dispatchEvent(new Event('resize'));
        };

        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);
    });
}

