// FK expansion state
let expandedRows = new Map(); // Track expanded rows by unique key: ${tableId}-${rowIndex}-${columnName}
let expansionIdCounter = 0; // Generate unique expansion IDs

// ===== FK/PK EXPANSION FUNCTIONS =====

/**
 * Handle FK relation expansion results from extension
 */
function handleRelationResults(message) {
    const { expansionId, resultSets, metadata, executionTime, error } = message;
    
    if (error) {
        console.error('[EXPANSION] Error:', error);
        const expandedRow = document.querySelector(`[data-expansion-id="${expansionId}"]`);
        if (expandedRow) {
            const content = expandedRow.querySelector('.expanded-content');
            if (content) {
                content.innerHTML = `<div style="color: var(--vscode-errorForeground); padding: 20px; text-align: center;">Error: ${error}</div>`;
            }
        }
        return;
    }
    
    const expandedRow = document.querySelector(`[data-expansion-id="${expansionId}"]`);
    if (expandedRow) {
        const content = expandedRow.querySelector('.expanded-content');
        if (content && resultSets && resultSets[0] && resultSets[0].length > 0) {
            content.innerHTML = '';
            
            const nestedContainer = document.createElement('div');
            nestedContainer.className = 'nested-table-container';
            
            // Calculate dynamic height based on row count (max 5 rows)
            const rowCount = resultSets[0].length;
            const rowHeight = 30; // Match ROW_HEIGHT in initAgGridTable
            const headerHeight = 40; // Approx header height
            const scrollbarHeight = 17; // Approx scrollbar height
            const maxVisibleRows = 5;
            const calculatedHeight = Math.min((Math.min(rowCount, maxVisibleRows) * rowHeight) + headerHeight + scrollbarHeight, 400);
            
            nestedContainer.style.cssText = `
                background: var(--vscode-editor-background);
                border-radius: 4px;
                overflow: auto;
                max-height: 400px;
                height: ${calculatedHeight}px;
                min-height: 80px;
                border: 1px solid var(--vscode-panel-border);
                width: 100%;
                box-sizing: border-box;
            `;
            
            content.appendChild(nestedContainer);
            console.log('[EXPANSION] Rendering nested table with', resultSets[0].length, 'rows');
            initAgGridTable(resultSets[0], nestedContainer, true, -1, metadata[0]);
            console.log('[EXPANSION] Nested table rendered, container height:', nestedContainer.offsetHeight);

            // Update height after content is rendered
            setTimeout(() => {
                // Use the calculated height for the row, respecting min-height of container
                const newHeight = Math.max(calculatedHeight, 80);
                const currentHeight = parseInt(expandedRow.style.height || '200');
                const heightDiff = newHeight - currentHeight;
                
                if (heightDiff !== 0) {
                    expandedRow.style.height = `${newHeight}px`;
                    // Adjust rows below with the height difference
                    const rowIndex = parseInt(expandedRow.dataset.sourceRowIndex || '0');
                    shiftRowsBelow(expandedRow.parentNode, rowIndex, heightDiff);
                }
            }, 50);
        } else {
            content.innerHTML = `<div style="color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px; text-align: center;">No related data found</div>`;
            
            // Resize for empty state
            const newHeight = 60;
            const currentHeight = parseInt(expandedRow.style.height || '200');
            const heightDiff = newHeight - currentHeight;
            
            if (heightDiff !== 0) {
                expandedRow.style.height = `${newHeight}px`;
                // Adjust rows below with the height difference
                const rowIndex = parseInt(expandedRow.dataset.sourceRowIndex || '0');
                shiftRowsBelow(expandedRow.parentNode, rowIndex, heightDiff);
            }
        }
    }
}

/**
 * Show quick pick modal for FK relation selection
 */
function showQuickPick(relations, keyValue, sourceRow, columnName, tableId, rowIndex, containerEl, metadata) {
    const existing = document.querySelector('.fk-quick-pick-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'fk-quick-pick-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    const quickPick = document.createElement('div');
    quickPick.className = 'fk-quick-pick';
    quickPick.style.cssText = `
        background: var(--vscode-quickInput-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        min-width: 800px;
        max-width: 900px;
        height: 500px;
        display: flex;
        flex-direction: row;
    `;
    
    // Left panel for list
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = `
        flex: 1;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--vscode-panel-border);
        min-width: 300px;
    `;
    
    // Right panel for details
    const rightPanel = document.createElement('div');
    rightPanel.style.cssText = `
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        background: var(--vscode-editor-background);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
    `;
    rightPanel.innerHTML = '<div style="color: var(--vscode-descriptionForeground); text-align: center; margin-top: 20px;">Select a table to view details</div>';

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 12px 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
        font-weight: 600;
        color: var(--vscode-foreground);
    `;
    header.textContent = 'Select related table';
    leftPanel.appendChild(header);
    
    // Add filter input
    const filterContainer = document.createElement('div');
    filterContainer.style.cssText = `
        padding: 8px 16px;
        background: var(--vscode-quickInput-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        position: relative;
        display: flex;
        align-items: center;
    `;
    
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.placeholder = 'Type to filter tables...';
    filterInput.style.cssText = `
        width: 100%;
        padding: 6px 30px 6px 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 2px;
        outline: none;
        box-sizing: border-box;
    `;

    const searchIcon = document.createElement('div');
    searchIcon.innerHTML = `
        <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        >
        <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
        <path d="M21 21l-6 -6" />
        </svg>
    `;
    searchIcon.style.cssText = `
        position: absolute;
        right: 24px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--vscode-input-foreground);
        opacity: 0.7;
        pointer-events: none;
        display: flex;
        align-items: center;
    `;
    
    filterInput.addEventListener('focus', () => {
        filterInput.style.borderColor = 'var(--vscode-focusBorder)';
    });
    
    filterInput.addEventListener('blur', () => {
        filterInput.style.borderColor = 'var(--vscode-input-border)';
    });

    let selectedIndex = -1;
    let selectedElement = null;

    function updateRightPanel(relation) {
        if (!relation) {
            rightPanel.innerHTML = '<div style="color: var(--vscode-descriptionForeground); text-align: center; margin-top: 20px;">Select a table to view details</div>';
            return;
        }

        // Find table in dbSchema
        const tableDef = typeof dbSchema !== 'undefined' && dbSchema.tables ? dbSchema.tables.find(t => t.schema === relation.schema && t.name === relation.table) : null;
        
        let html = `
            <div style="margin-bottom: 16px;">
                <div style="font-weight: 600; font-size: 1.1em; margin-bottom: 4px;">${relation.schema}.${relation.table}</div>
                <div style="color: var(--vscode-descriptionForeground); font-size: 0.9em;">Relation: ${relation.column}</div>
            </div>
        `;

        if (tableDef && tableDef.columns) {
            html += `
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                    <thead>
                        <tr style="text-align: left; border-bottom: 1px solid var(--vscode-panel-border);">
                            <th style="padding: 4px 8px; color: var(--vscode-descriptionForeground);">Column</th>
                            <th style="padding: 4px 8px; color: var(--vscode-descriptionForeground);">Type</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            tableDef.columns.forEach(col => {
                const isPK = col.isPrimaryKey;
                const isFK = col.isForeignKey; 
                
                let keyText = '';
                if (isPK) keyText += 'PK ';
                if (isFK) keyText += 'FK';
                
                html += `
                    <tr style="border-bottom: 1px solid var(--vscode-panel-border);">
                        <td style="padding: 4px 8px;">${col.name}</td>
                        <td style="padding: 4px 8px; color: var(--vscode-descriptionForeground);">${col.type || ''}</td>
                    </tr>
                `;
            });
            
            html += `
                    </tbody>
                </table>
            `;
        } else {
            html += `<div style="color: var(--vscode-descriptionForeground); font-style: italic;">Table definition not available in cache.</div>`;
        }
        
        rightPanel.innerHTML = html;
    }

    function updateSelection() {
        const visibleItems = Array.from(list.querySelectorAll('.fk-quick-pick-item')).filter(item => item.style.display !== 'none');
        selectedElement = visibleItems[selectedIndex] || null;
        
        visibleItems.forEach((item, index) => {
            const btn = item.querySelector('.open-query-btn');
            if (index === selectedIndex) {
                item.style.background = 'var(--vscode-list-activeSelectionBackground)';
                item.style.color = 'var(--vscode-list-activeSelectionForeground)';
                item.scrollIntoView({ block: 'nearest' });
                if (btn) {
                    btn.style.display = 'flex';
                    btn.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground)';
                    btn.style.color = 'var(--vscode-list-activeSelectionForeground)';
                }
                
                const relation = JSON.parse(item.dataset.relation);
                updateRightPanel(relation);
            } else {
                item.style.background = '';
                item.style.color = '';
                if (btn) {
                    btn.style.display = 'none';
                    btn.style.backgroundColor = '';
                    btn.style.color = 'var(--vscode-button-background)';
                }
            }
        });
    }
    
    filterInput.addEventListener('input', (e) => {
        const filterText = e.target.value.toLowerCase();
        const items = list.querySelectorAll('.fk-quick-pick-item');
        let visibleCount = 0;
        
        items.forEach(item => {
            const label = item.querySelector('div:first-child').textContent.toLowerCase();
            if (label.includes(filterText)) {
                item.style.display = 'block';
                visibleCount++;
            } else {
                item.style.display = 'none';
            }
        });

        selectedIndex = visibleCount === 1 ? 0 : -1;
        updateSelection();
    });

    filterInput.addEventListener('keydown', (e) => {
        const visibleItems = Array.from(list.querySelectorAll('.fk-quick-pick-item')).filter(item => item.style.display !== 'none');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, visibleItems.length - 1);
            if (selectedIndex === -1 && visibleItems.length > 0) selectedIndex = 0;
            updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            updateSelection();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (visibleItems.length === 1) {
                visibleItems[0].click();
            } else if (selectedIndex >= 0 && selectedIndex < visibleItems.length) {
                visibleItems[selectedIndex].click();
            }
        }
    });
    
    filterContainer.appendChild(filterInput);
    filterContainer.appendChild(searchIcon);
    leftPanel.appendChild(filterContainer);
    
    const sortedRelations = [...relations].sort((a, b) => {
        if (a.isComposite && !b.isComposite) return 1;
        if (!a.isComposite && b.isComposite) return -1;
        return 0;
    });
    
    const list = document.createElement('div');
    list.style.cssText = `overflow-y: auto; flex: 1;`;
    
    sortedRelations.forEach(rel => {
        const item = document.createElement('div');
        item.className = 'fk-quick-pick-item';
        item.dataset.relation = JSON.stringify(rel);
        item.style.cssText = `
            padding: 10px 16px;
            cursor: pointer;
            border-bottom: 1px solid var(--vscode-panel-border);
            transition: background 0.1s;
            position: relative;
        `;
        
        const label = document.createElement('div');
        label.textContent = `${rel.table} (${rel.schema})${rel.isComposite ? ' - Composite Key' : ''}`;
        label.style.fontWeight = '500';
        item.appendChild(label);
        
        const queryText = `SELECT * FROM [${rel.schema}].[${rel.table}] WHERE [${rel.column}] = '${keyValue}'`;
        const query = document.createElement('div');
        query.textContent = queryText;
        query.style.cssText = `
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        `;
        item.appendChild(query);

        // Add open query button
        const openQueryBtn = document.createElement('div');
        openQueryBtn.className = 'open-query-btn';
        openQueryBtn.title = 'Open in New Query';
        openQueryBtn.innerHTML = `
            <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            >
            <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
            <path d="M11 13l9 -9" />
            <path d="M15 4h5v5" />
            </svg>
        `;
        openQueryBtn.style.cssText = `
            position: absolute;
            right: 10px;
            top: 50%;
            transform: translateY(-50%);
            padding: 4px;
            border-radius: 4px;
            color: var(--vscode-button-background);
            display: none;
            align-items: center;
            justify-content: center;
        `;
        
        openQueryBtn.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            openQueryBtn.style.backgroundColor = 'var(--vscode-button-background)';
            openQueryBtn.style.color = 'var(--vscode-button-foreground)';
        });
        
        openQueryBtn.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            openQueryBtn.style.backgroundColor = item.style.background;
            if (item === selectedElement) {
                openQueryBtn.style.color = 'var(--vscode-list-activeSelectionForeground)';
            } else {
                openQueryBtn.style.color = 'var(--vscode-button-background)';
            }
        });

        openQueryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Send message to open new query
            const currentConnectionId = window.currentConnectionId;
            const currentDatabaseName = window.currentDatabaseName;
            
            window.vscode.postMessage({
                type: 'openNewQuery',
                query: queryText,
                connectionId: currentConnectionId,
                database: currentDatabaseName
            });
            
            overlay.remove();
        });

        item.appendChild(openQueryBtn);
        
        item.addEventListener('mouseenter', () => {
            item.style.background = 'var(--vscode-list-hoverBackground)';
            openQueryBtn.style.display = 'flex';
            openQueryBtn.style.backgroundColor = 'var(--vscode-list-hoverBackground)';
            openQueryBtn.style.color = 'var(--vscode-button-background)';
            updateRightPanel(rel);
        });
        item.addEventListener('mouseleave', () => {
            if (item === selectedElement) {
                item.style.background = 'var(--vscode-list-activeSelectionBackground)';
                openQueryBtn.style.display = 'flex';
                openQueryBtn.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground)';
                openQueryBtn.style.color = 'var(--vscode-list-activeSelectionForeground)';
            } else {
                item.style.background = '';
                openQueryBtn.style.display = 'none';
            }
        });
        item.addEventListener('click', () => {
            overlay.remove();
            executeRelationExpansion(rel, keyValue, sourceRow, columnName, tableId, rowIndex, containerEl, metadata);
        });
        
        list.appendChild(item);
    });
    
    leftPanel.appendChild(list);
    quickPick.appendChild(leftPanel);
    quickPick.appendChild(rightPanel);
    overlay.appendChild(quickPick);
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
            const chevron = sourceRow.querySelector(`[data-column="${columnName}"] .chevron-icon`);
            if (chevron) chevron.classList.remove('expanded');
        }
    });
    
    document.body.appendChild(overlay);
    
    // Focus the filter input
    setTimeout(() => filterInput.focus(), 50);
}

/**
 * Execute FK relation expansion query
 */
function executeRelationExpansion(relation, keyValue, sourceRow, columnName, tableId, rowIndex, containerEl, metadata) {
    const expandKey = `${tableId}-${rowIndex}-${columnName}`;
    const expansionId = `exp_${Date.now()}_${expansionIdCounter++}`;
    const expandedRow = insertExpandedRow(sourceRow, expandKey, expansionId, containerEl);
    
    // Build full connectionId with database context for server connections
    // Access global variables from sqlEditor.js
    const currentConnectionId = window.currentConnectionId;
    const currentDatabaseName = window.currentDatabaseName;
    
    let fullConnectionId = currentConnectionId;
    if (currentConnectionId && currentDatabaseName) {
        // Check if connectionId already includes database
        if (!currentConnectionId.includes('::')) {
            fullConnectionId = `${currentConnectionId}::${currentDatabaseName}`;
        }
    }
    
    const request = {
        type: 'expandRelation',
        keyValue: keyValue,
        schema: relation.schema,
        table: relation.table,
        column: relation.column,
        expansionId: expansionId,
        connectionId: fullConnectionId
    };
    console.log('[EXPANSION] Sending request:', request);
    window.vscode.postMessage(request);
    
    expandedRows.set(expandKey, {
        element: expandedRow,
        relation: relation,
        expansionId: expansionId
    });
}

/**
 * Shift rows below expanded row down by height
 */
function shiftRowsBelow(tbody, sourceRowIndex, shiftAmount) {
    // Add small padding to prevent visual overlap
    const paddedShift = shiftAmount;
    
    // Shift regular data rows (but not rows inside nested tables)
    const allRows = tbody.querySelectorAll('tr[data-row-index]');
    allRows.forEach(row => {
        // Skip rows that are inside nested table containers
        if (row.closest('.nested-table-container')) {
            return;
        }
        
        const rowIdx = parseInt(row.dataset.rowIndex || '0');
        if (rowIdx > sourceRowIndex) {
            const currentTop = parseInt(row.style.top || '0');
            row.style.top = `${currentTop + paddedShift}px`;
        }
    });
    
    // Also shift any expanded rows that are below the source
    const expandedRows = tbody.querySelectorAll('.expanded-row-content');
    expandedRows.forEach(expandedRow => {
        const expandedSourceIndex = parseInt(expandedRow.dataset.sourceRowIndex || '0');
        if (expandedSourceIndex > sourceRowIndex) {
            const currentTop = parseInt(expandedRow.style.top || '0');
            expandedRow.style.top = `${currentTop + paddedShift}px`;
        }
    });
}

/**
 * Insert expanded row with loader
 */
function insertExpandedRow(sourceRow, expandKey, expansionId, containerEl) {
    // Remove any existing expanded row for this key
    const existing = document.querySelector(`[data-expand-key="${expandKey}"]`);
    if (existing) {
        existing.remove();
    }
    
    // Calculate source row position
    const sourceTop = parseInt(sourceRow.style.top || '0');
    const sourceHeight = parseInt(sourceRow.style.height || '30');
    const rowIndex = parseInt(sourceRow.dataset.rowIndex || '0');
    
    // Create expanded row as a normal TR that will push rows below
    const expandedRow = document.createElement('tr');
    expandedRow.className = 'expanded-row-content';
    expandedRow.dataset.expandKey = expandKey;
    expandedRow.dataset.expansionId = expansionId;
    expandedRow.dataset.sourceRowIndex = rowIndex;
    
    // Initial height
    const initialHeight = 60;
    
    // Get viewport width from parent
    const viewport = sourceRow.closest('.ag-grid-viewport');
    const availableWidth = viewport ? viewport.clientWidth : 1024;
    
    // Position it right after the source row with width on TR
    expandedRow.style.cssText = `
        position: absolute;
        top: ${sourceTop + sourceHeight}px;
        left: 0;
        right: 0;
        height: ${initialHeight}px;
        width: ${availableWidth}px;
        border-bottom: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
        box-sizing: border-box;
    `;
    
    // Single cell with full width content
    const cell = document.createElement('td');
    cell.setAttribute('colspan', '100');
    cell.style.cssText = `
        padding: 0;
        box-sizing: border-box;
    `;
    
    const content = document.createElement('div');
    content.className = 'expanded-content';
    
    const loader = document.createElement('div');
    loader.className = 'loader-container';
    loader.style.cssText = `
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
    `;
    loader.innerHTML = '<div class="loading-spinner"></div>';
    content.appendChild(loader);
    cell.appendChild(content);
    expandedRow.appendChild(cell);
    
    // Insert into tbody after source row
    sourceRow.parentNode.appendChild(expandedRow);
    
    // Shift all rows below this one down by the expanded row height
    shiftRowsBelow(sourceRow.parentNode, rowIndex, initialHeight);
    
    return expandedRow;
}



/**
 * Handle chevron click for FK expansion
 */
function handleChevronClick(event, col, value, row, rowIndex, tableId, containerEl, metadata, colIndex) {
    event.stopPropagation();
    event.preventDefault();
    
    const chevron = event.currentTarget;
    const columnName = col.field;
    const expandKey = `${tableId}-${rowIndex}-${columnName}`;
    
    if (expandedRows.has(expandKey)) {
        const expanded = expandedRows.get(expandKey);
        const expandedElement = expanded.element;
        const expandedHeight = parseInt(expandedElement.style.height || '200');
        const sourceRowIndex = parseInt(expandedElement.dataset.sourceRowIndex || '0');
        
        chevron.classList.remove('expanded');
        
        // Shift rows back up before removing
        shiftRowsBelow(expandedElement.parentNode, sourceRowIndex, -expandedHeight);
        
        expandedElement.remove();
        expandedRows.delete(expandKey);
    } else {
        // Close any other expanded rows from the same row (different columns)
        const keysToClose = [];
        expandedRows.forEach((expanded, key) => {
            // Check if key starts with same tableId-rowIndex but different column
            if (key.startsWith(`${tableId}-${rowIndex}-`) && key !== expandKey) {
                keysToClose.push(key);
            }
        });
        
        keysToClose.forEach(key => {
            const expanded = expandedRows.get(key);
            const expandedElement = expanded.element;
            const expandedHeight = parseInt(expandedElement.style.height || '200');
            const sourceRowIndex = parseInt(expandedElement.dataset.sourceRowIndex || '0');
            
            // Remove expanded class from chevron
            const columnNameFromKey = key.split('-').slice(2).join('-');
            const chevronToClose = row.querySelector(`[data-column="${columnNameFromKey}"] .chevron-icon`);
            if (chevronToClose) {
                chevronToClose.classList.remove('expanded');
            }
            
            // Shift rows back up before removing
            shiftRowsBelow(expandedElement.parentNode, sourceRowIndex, -expandedHeight);
            
            expandedElement.remove();
            expandedRows.delete(key);
        });
        
        chevron.classList.add('expanded');
        
        // Use colIndex if available, otherwise fallback to name lookup (for backward compatibility)
        let colMetadata;
        if (typeof colIndex !== 'undefined' && metadata?.columns) {
            colMetadata = metadata.columns[colIndex];
        } else {
            colMetadata = metadata?.columns?.find(c => c.name === columnName);
        }
        
        console.log('[EXPANSION] Column metadata:', colMetadata);
        console.log('[EXPANSION] FK references:', colMetadata?.foreignKeyReferences);
        
        if (colMetadata && colMetadata.foreignKeyReferences && colMetadata.foreignKeyReferences.length > 0) {
            if (colMetadata.foreignKeyReferences.length === 1) {
                console.log('[EXPANSION] Single FK, expanding directly:', colMetadata.foreignKeyReferences[0]);
                executeRelationExpansion(
                    colMetadata.foreignKeyReferences[0],
                    value,
                    row,
                    columnName,
                    tableId,
                    rowIndex,
                    containerEl,
                    metadata
                );
            } else {
                console.log('[EXPANSION] Multiple FKs, showing quick pick');
                showQuickPick(
                    colMetadata.foreignKeyReferences,
                    value,
                    row,
                    columnName,
                    tableId,
                    rowIndex,
                    containerEl,
                    metadata
                );
            }
        }
    }
}
