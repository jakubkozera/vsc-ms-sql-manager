// Global selection state for all tables in results
let globalSelection = {
    type: null, // 'row', 'column', or 'cell'
    tableContainer: null, // reference to the specific table container
    selections: [], // Array of selected items: {rowIndex, columnIndex, cellValue}
    columnDef: null,
    data: null,
    columnDefs: null,
    lastClickedIndex: null // Last clicked row/column index for Shift selection
};

// Editable result sets support
window.resultSetMetadata = []; // Metadata for each result set
window.originalQuery = ''; // Original SELECT query for UPDATE generation
window.pendingChanges = new Map(); // Map<resultSetIndex, Array<ChangeRecord>>
let currentEditingCell = null; // Currently editing cell reference
function initAgGridTable(rowData, container, isSingleResultSet = false, resultSetIndex = 0, metadata = null, providedColumns = null) {
    console.log('[AG-GRID] initAgGridTable called with', rowData.length, 'rows, single result set:', isSingleResultSet);
    console.log('[AG-GRID] Container element:', container, 'offsetHeight:', container.offsetHeight, 'scrollHeight:', container.scrollHeight);
    console.log('[AG-GRID] Metadata:', metadata);
    
    // Create PK/FK lookup maps from metadata columns
    // This works for all result sets, regardless of single or multiple tables
    const pkColumnSet = new Set();
    const fkColumnMap = new Map(); // Map column name to FK info
    
    if (metadata && metadata.columns) {
        metadata.columns.forEach(col => {
            if (col.isPrimaryKey) {
                pkColumnSet.add(col.name);
            }
            // Check FK from dbSchema if we have source table info
            if (col.sourceTable && col.sourceSchema && dbSchema.foreignKeys) {
                dbSchema.foreignKeys.forEach(fk => {
                    if (fk.fromTable === col.sourceTable && 
                        fk.fromSchema === col.sourceSchema && 
                        fk.fromColumn === col.name) {
                        fkColumnMap.set(col.name, fk);
                    }
                });
            }
        });
        console.log('[AG-GRID] PK columns:', Array.from(pkColumnSet));
        console.log('[AG-GRID] FK columns:', Array.from(fkColumnMap.keys()));
    }
    
    // Virtual scrolling configuration
    const ROW_HEIGHT = 30; // Fixed row height in pixels
    const VISIBLE_ROWS = 30; // Number of rows to render in viewport
    const BUFFER_ROWS = 10; // Extra rows to render above/below viewport
    const RENDER_CHUNK_SIZE = VISIBLE_ROWS + (BUFFER_ROWS * 2);
    
    // Function to calculate optimal column width based on content
    function calculateOptimalColumnWidth(columnName, columnData, type) {
        // Create a temporary canvas element for text measurement
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // Set font to match table font for accurate measurement
        context.font = '13px var(--vscode-font-family, "Segoe UI", sans-serif)';
        
        // Measure header width
        const headerWidth = context.measureText(columnName).width;
        
        // Find the longest content in this column
        let maxContentWidth = 0;
        let longestContent = '';
        
        // Sample up to 100 rows for performance (or all if less than 100)
        const sampleSize = Math.min(100, columnData.length);
        const step = Math.max(1, Math.floor(columnData.length / sampleSize));
        
        for (let i = 0; i < columnData.length; i += step) {
            const value = columnData[i];
            let displayValue = '';
            
            if (value === null || value === undefined) {
                displayValue = 'NULL';
            } else if (type === 'boolean') {
                displayValue = value ? '✓' : '✗';
            } else if (type === 'number') {
                displayValue = typeof value === 'number' ? value.toLocaleString() : String(value);
            } else {
                displayValue = String(value);
            }
            
            const contentWidth = context.measureText(displayValue).width;
            if (contentWidth > maxContentWidth) {
                maxContentWidth = contentWidth;
                longestContent = displayValue;
            }
        }
        
        console.log(`[COLUMN-WIDTH] Column "${columnName}": header=${headerWidth.toFixed(1)}px, content=${maxContentWidth.toFixed(1)}px ("${longestContent.substring(0, 20)}...")`);
        
        // Calculate optimal width (max of header and content, plus padding)
        const padding = 32; // 16px padding on each side + some extra space for icons and borders
        const iconSpace = 80; // Space for sort, filter, and pin icons
        const optimalWidth = Math.max(headerWidth + iconSpace, maxContentWidth + padding);
        
        // Set reasonable min/max bounds
        const minWidth = 80;
        const maxWidth = 450;
        const paddingWidth = 36; 
        
        const finalWidth = Math.min(Math.max(optimalWidth, minWidth), maxWidth) + paddingWidth;
        console.log(`[COLUMN-WIDTH] Column "${columnName}" final width: ${finalWidth.toFixed(0)}px`);
        
        return Math.round(finalWidth);
    }

    // Detect column types and create columnDefs
    let columns = [];
    if (providedColumns) {
        columns = providedColumns;
    } else if (rowData.length > 0 && !Array.isArray(rowData[0])) {
        columns = Object.keys(rowData[0]);
    } else {
        columns = [];
    }
    console.log('[AG-GRID] Detected columns:', columns);
    
    const columnDefs = columns.map((col, colIndex) => {
        let sampleValue = null;
        if (rowData.length > 0) {
            if (Array.isArray(rowData[0])) {
                sampleValue = rowData[0][colIndex];
            } else {
                sampleValue = rowData[0][col];
            }
        }
        
        let type = 'string';
        
        if (typeof sampleValue === 'number') {
            type = 'number';
        } else if (typeof sampleValue === 'boolean') {
            type = 'boolean';
        } else if (sampleValue instanceof Date || (typeof sampleValue === 'string' && !isNaN(Date.parse(sampleValue)) && sampleValue.match(/\\d{4}-\\d{2}-\\d{2}/))) {
            type = 'date';
        }
        
        // Extract column data for width calculation
        const columnData = rowData.map(row => {
            if (Array.isArray(row)) {
                return row[colIndex];
            } else {
                return row[col];
            }
        });
        const optimalWidth = calculateOptimalColumnWidth(col, columnData, type);
        
        // Check if this column is a primary key or foreign key
        // Use PK/FK info from metadata columns (works for all result sets)
        const isPrimaryKey = pkColumnSet.has(col);
        const isForeignKey = fkColumnMap.has(col);
        
        return {
            field: (rowData.length > 0 && Array.isArray(rowData[0])) ? String(colIndex) : col,
            headerName: col,
            type: type,
            width: optimalWidth,
            pinned: false,
            isPrimaryKey: isPrimaryKey,
            isForeignKey: isForeignKey,
            valueGetter: (params) => {
                if (Array.isArray(params.data)) {
                    return params.data[colIndex];
                }
                return params.data[col];
            }
        };
    });

    console.log('[AG-GRID] Column definitions created:', columnDefs.map(c => ({ name: c.headerName, type: c.type, width: c.width })));

    let filteredData = [...rowData];
    let activeFilters = {};
    let currentFilterPopup = null;
    let sortConfig = { field: null, direction: null };
    
    // Virtual scrolling state
    let currentStartRow = 0;
    let scrollTimeout = null;

    // Build the table HTML structure with virtual scrolling support
    const tableId = `agGrid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const viewportClass = isSingleResultSet ? 'ag-grid-viewport full-height' : 'ag-grid-viewport';
    const tableHtml = `
        <div class="${viewportClass}" style="overflow: auto; position: relative; height: 100%; width: 100%;">
            <table id="${tableId}" class="ag-grid-table" style="border-collapse: collapse; table-layout: auto; width: 100%;">
                <thead class="ag-grid-thead"></thead>
                <tbody class="ag-grid-tbody" style="position: relative;"></tbody>
            </table>
        </div>
    `;
    
    console.log('[AG-GRID] Setting container innerHTML');
    container.innerHTML = tableHtml;
    
    const viewport = container.querySelector('.ag-grid-viewport');
    const table = container.querySelector('.ag-grid-table');
    const tbody = container.querySelector('.ag-grid-tbody');
    console.log('[AG-GRID] Table element:', table, 'border-collapse:', table?.style.borderCollapse);

    renderAgGridHeaders(columnDefs, sortConfig, activeFilters, container, filteredData);
    
    // Calculate and set table width based on column widths
    const totalTableWidth = columnDefs.reduce((sum, col) => sum + col.width, 0) + 50; // +50 for row number column
    table.style.width = `${totalTableWidth}px`;
    table.style.minWidth = `${totalTableWidth}px`;
    console.log('[AG-GRID] Table width set to:', totalTableWidth, 'px');
    
    renderAgGridRows(columnDefs, filteredData, container, 0, ROW_HEIGHT, RENDER_CHUNK_SIZE);
    
    // Set up virtual scrolling
    viewport.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            const scrollTop = viewport.scrollTop;
            const newStartRow = Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS;
            const clampedStartRow = Math.max(0, Math.min(newStartRow, filteredData.length - RENDER_CHUNK_SIZE));
            
            if (clampedStartRow !== currentStartRow) {
                currentStartRow = clampedStartRow;
                renderAgGridRows(columnDefs, filteredData, container, currentStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);
            }
        }, 10);
    });
    
    console.log('[AG-GRID] Virtual scrolling initialized with', filteredData.length, 'total rows, rendering', RENDER_CHUNK_SIZE, 'at a time');

    function renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, data) {
        console.log('[AG-GRID] renderAgGridHeaders called with', colDefs.length, 'columns');
        const thead = containerEl.querySelector('.ag-grid-thead');
        if (!thead) {
            console.error('[AG-GRID] thead element not found!');
            return;
        }
        
        const tr = document.createElement('tr');
        
        // Add export button header
        const rowNumTh = document.createElement('th');
        rowNumTh.className = 'ag-grid-row-number-header export-header';
        rowNumTh.innerHTML = `
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="sort-to-top-icon"
            >
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                <path d="M7 9l5-5l5 5" />
                <path d="M12 4v12" />
            </svg>
            `;
        // Set styles individually to avoid cssText issues
        rowNumTh.style.width = '50px';
        rowNumTh.style.minWidth = '50px';
        rowNumTh.style.maxWidth = '50px';
        rowNumTh.style.borderBottom = '1px solid var(--vscode-panel-border, #3c3c3c)';
        rowNumTh.style.padding = '8px';
        rowNumTh.style.cursor = 'pointer';
        rowNumTh.style.userSelect = 'none';
        rowNumTh.style.textAlign = 'center';
        rowNumTh.style.position = 'relative';
        rowNumTh.title = 'Click for export options and auto-fit columns';
        
        // Add click handler to show export menu
        rowNumTh.addEventListener('click', (e) => {
            e.stopPropagation();
            showExportMenu(e.target.closest('th'), colDefs, data, containerEl, sortCfg, filters);
        });
        
        console.log('[AG-GRID] Row number header created with class:', rowNumTh.className);
        tr.appendChild(rowNumTh);
        
        const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
        const table = containerEl.querySelector('.ag-grid-table');
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
        console.log('[AG-GRID] Table total width set to:', totalWidth);

        colDefs.forEach((col, index) => {
            const th = document.createElement('th');
            
            // Base styles - set individually to avoid cssText overriding
            th.style.width = col.width + 'px';
            th.style.minWidth = col.width + 'px';
            th.style.maxWidth = col.width + 'px';
            th.style.backgroundColor = 'var(--vscode-editorGroupHeader-tabsBackground, #252526)';
            th.style.borderBottom = '1px solid var(--vscode-panel-border, #3c3c3c)';
            th.style.borderRight = '1px solid var(--vscode-panel-border, #3c3c3c)';
            th.style.padding = '8px';
            th.style.textAlign = 'left';
            th.style.fontWeight = '600';
            th.style.userSelect = 'none';
            th.style.whiteSpace = 'nowrap';
            th.style.overflow = 'hidden';
            th.style.textOverflow = 'ellipsis';
            
            // Don't set position, top, or z-index inline - let CSS classes handle it
            console.log(`[AG-GRID] Header for column "${col.headerName}" - pinned: ${col.pinned}`);
            
            if (col.pinned) {
                const leftOffset = calculatePinnedOffset(colDefs, index);
                th.style.left = leftOffset + 'px';
                th.classList.add('ag-grid-pinned-header');
                console.log(`[AG-GRID] Pinned column "${col.headerName}" left offset:`, leftOffset);
            }
            
            th.dataset.field = col.field;

            const headerContent = document.createElement('div');
            headerContent.style.cssText = 'position: relative; width: 100%; height: 100%; display: flex; align-items: center;';

            const headerTitle = document.createElement('span');
            headerTitle.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; width: 100%; display: block;';
            headerTitle.textContent = col.headerName;

            headerTitle.onclick = (e) => {
                e.stopPropagation();
                highlightColumn(index, colDefs, containerEl, filteredData, e);
            };
            
            // Add context menu for column header
            headerTitle.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                showColumnHeaderContextMenu(e, {
                    table: containerEl.querySelector('.ag-grid-table'),
                    columnIndex: index,
                    columnDefs: colDefs,
                    data: data
                });
            };

            headerContent.appendChild(headerTitle);

            // Action buttons positioned absolutely on the right (no container)
            const sortIcon = document.createElement('span');
            const isSorted = sortCfg.field === col.field;
            sortIcon.className = 'ag-header-icon';
            sortIcon.style.cssText = `
                position: absolute;
                right: 44px;
                top: 50%;
                transform: translateY(-50%);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                padding: 4px;
                border-radius: 2px;
                opacity: ${isSorted ? 1 : 0};
                transition: opacity 0.2s, background-color 0.2s;
                background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                z-index: 1;
            `;
            
            if (isSorted) {
                // Show chevron when sorted
                sortIcon.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--vscode-button-background, #0e639c)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="${sortCfg.direction === 'desc' ? 'transform: rotate(180deg);' : ''}">
                        <path d="M6 15l6 -6l6 6" />
                    </svg>
                `;
            } else {
                // Show sort icon when not sorted
                sortIcon.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 9l4 -4l4 4m-4 -4v14" />
                        <path d="M21 15l-4 4l-4 -4m4 4v-14" />
                    </svg>
                `;
            }
            
            sortIcon.onclick = (e) => {
                e.stopPropagation();
                handleSort(col, colDefs, sortCfg, filters, containerEl);
            };
            
            sortIcon.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            headerContent.appendChild(sortIcon);

            const pinIcon = document.createElement('span');
            pinIcon.className = 'ag-header-icon';
            pinIcon.style.cssText = `
                position: absolute;
                right: 24px;
                top: 50%;
                transform: translateY(-50%);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                padding: 4px;
                border-radius: 2px;
                opacity: ${col.pinned ? 1 : 0};
                transition: opacity 0.2s, background-color 0.2s;
                background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                z-index: 1;
            `;
            pinIcon.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${col.pinned ? 'var(--vscode-button-background, #0e639c)' : 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4" />
                    <path d="M9 15l-4.5 4.5" />
                    <path d="M14.5 4l5.5 5.5" />
                </svg>
            `;
            pinIcon.onclick = (e) => {
                e.stopPropagation();
                // Preserve current vertical scroll position so user doesn't jump to top
                try {
                    const prevScrollTop = viewport.scrollTop;
                    const prevStartRow = Math.floor(prevScrollTop / ROW_HEIGHT);

                    // Toggle pinned state
                    col.pinned = !col.pinned;

                    // Re-render headers first (pinned classes may change layout)
                    renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);

                    // Re-render rows keeping the user's current view
                    currentStartRow = Math.max(0, Math.min(prevStartRow, Math.max(0, filteredData.length - RENDER_CHUNK_SIZE)));
                    renderAgGridRows(colDefs, filteredData, containerEl, currentStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);

                    // Restore exact scroll position (in case row heights/layout changed slightly)
                    // Use requestAnimationFrame to ensure DOM was updated
                    requestAnimationFrame(() => {
                        viewport.scrollTop = prevScrollTop;
                    });
                } catch (err) {
                    // Fallback to safe behavior: render from top
                    col.pinned = !col.pinned;
                    currentStartRow = 0;
                    viewport.scrollTop = 0;
                    renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
                    renderAgGridRows(colDefs, filteredData, containerEl, 0, ROW_HEIGHT, RENDER_CHUNK_SIZE);
                }
            };
            
            pinIcon.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            headerContent.appendChild(pinIcon);

            const filterIcon = document.createElement('span');
            const isFiltered = !!filters[col.field];
            filterIcon.className = 'ag-header-icon';
            filterIcon.style.cssText = `
                position: absolute;
                right: 4px;
                top: 50%;
                transform: translateY(-50%);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                padding: 4px;
                border-radius: 2px;
                opacity: ${isFiltered ? 1 : 0};
                transition: opacity 0.2s, background-color 0.2s;
                background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                z-index: 1;
            `;
            filterIcon.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${isFiltered ? 'var(--vscode-button-background, #0e639c)' : 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z" />
                </svg>
            `;
            filterIcon.onclick = (e) => showAgGridFilter(e, col, th, colDefs, sortCfg, filters, containerEl);
            
            filterIcon.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            headerContent.appendChild(filterIcon);

            // Add hover effect to show icons
            th.onmouseenter = () => {
                if (!isSorted) sortIcon.style.opacity = '1';
                if (!col.pinned) pinIcon.style.opacity = '1';
                if (!isFiltered) filterIcon.style.opacity = '1';
            };
            th.onmouseleave = () => {
                if (!isSorted) sortIcon.style.opacity = '0';
                if (!col.pinned) pinIcon.style.opacity = '0';
                if (!isFiltered) filterIcon.style.opacity = '0';
            };

            // Add resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.style.cssText = `
                position: absolute;
                right: 0;
                top: 0;
                width: 4px;
                height: 100%;
                cursor: col-resize;
                background-color: transparent;
                transition: background-color 0.2s;
                z-index: 25;
            `;
            resizeHandle.title = 'Drag to resize column, double-click to auto-fit';
            resizeHandle.onmouseover = () => resizeHandle.style.backgroundColor = 'var(--vscode-button-background, #0e639c)';
            resizeHandle.onmouseout = () => resizeHandle.style.backgroundColor = 'transparent';
            resizeHandle.onmousedown = (e) => startResize(e, th, index, colDefs, sortCfg, filters, containerEl);
            
            // Add double-click to auto-fit column width
            resizeHandle.ondblclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                autoFitSingleColumn(index, colDefs, containerEl, filteredData);
            };
            
            resizeHandle.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            th.style.position = 'relative';
            th.appendChild(headerContent);
            th.appendChild(resizeHandle);
            tr.appendChild(th);
        });

        thead.innerHTML = '';
        thead.appendChild(tr);
    }

    // Column highlighting functionality
    function highlightColumn(colIndex, colDefs, containerEl, filteredData, event) {
        const ctrlPressed = event?.ctrlKey || event?.metaKey;
        const shiftPressed = event?.shiftKey;
        
        // Check if same table
        const sameTable = globalSelection.tableContainer === containerEl;
        const sameType = globalSelection.type === 'column';
        
        if (shiftPressed && sameTable && sameType && globalSelection.lastClickedIndex !== null) {
            // Shift: select range from last clicked to current
            const start = Math.min(globalSelection.lastClickedIndex, colIndex);
            const end = Math.max(globalSelection.lastClickedIndex, colIndex);
            
            clearAllSelections();
            globalSelection.selections = [];
            
            for (let i = start; i <= end; i++) {
                globalSelection.selections.push({ columnIndex: i });
                applyColumnHighlightGlobal(containerEl, i);
            }
            
            globalSelection.type = 'column';
            globalSelection.tableContainer = containerEl;
            globalSelection.data = filteredData;
            globalSelection.columnDefs = colDefs;
            globalSelection.resultSetIndex = resultSetIndex;
        } else if (ctrlPressed && sameTable && sameType) {
            // Ctrl: toggle individual selection
            const existingIndex = globalSelection.selections.findIndex(s => s.columnIndex === colIndex);
            
            if (existingIndex >= 0) {
                // Remove from selection
                globalSelection.selections.splice(existingIndex, 1);
                
                if (globalSelection.selections.length === 0) {
                    // No more selections
                    clearAllSelections();
                    globalSelection = {
                        type: null,
                        tableContainer: null,
                        selections: [],
                        columnDef: null,
                        data: null,
                        columnDefs: null,
                        lastClickedIndex: null
                    };
                } else {
                    // Reapply all selections
                    clearAllSelections();
                    globalSelection.selections.forEach(s => {
                        applyColumnHighlightGlobal(containerEl, s.columnIndex);
                    });
                }
            } else {
                // Add to selection
                globalSelection.selections.push({ columnIndex: colIndex });
                applyColumnHighlightGlobal(containerEl, colIndex);
            }
            
            globalSelection.lastClickedIndex = colIndex;
        } else {
            // Normal click: single selection
            const isAlreadySelected = sameTable && sameType && 
                globalSelection.selections.length === 1 && 
                globalSelection.selections[0].columnIndex === colIndex;
            
            if (isAlreadySelected) {
                // Unselect - clear all selections
                clearAllSelections();
                globalSelection = {
                    type: null,
                    tableContainer: null,
                    selections: [],
                    columnDef: null,
                    data: null,
                    columnDefs: null,
                    lastClickedIndex: null
                };
            } else {
                // Clear all selections across all tables
                clearAllSelections();
                
                // Collect all cell values from the column
                const columnField = colDefs[colIndex].field;
                const columnSelections = filteredData.map((row, rowIndex) => ({
                    rowIndex: rowIndex,
                    columnIndex: colIndex,
                    cellValue: row[columnField]
                }));
                
                // Set global selection state
                globalSelection = {
                    type: 'column',
                    tableContainer: containerEl,
                    selections: columnSelections,
                    columnDef: colDefs[colIndex],
                    data: filteredData,
                    columnDefs: colDefs,
                    lastClickedIndex: colIndex,
                    resultSetIndex: resultSetIndex,
                    metadata: metadata
                };
                
                // Apply highlighting
                applyColumnHighlightGlobal(containerEl, colIndex);
            }
        }
        
        // Update aggregation stats
        updateAggregationStats();
    }

    // Column resizing functionality
    let resizingColumn = null;
    let startX = 0;
    let startWidth = 0;
    
    function doResize(e) {
        if (!resizingColumn) return;

        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);
        
        resizingColumn.th.style.width = newWidth + 'px';
        resizingColumn.th.style.minWidth = newWidth + 'px';
        resizingColumn.th.style.maxWidth = newWidth + 'px';
        resizingColumn.colDefs[resizingColumn.colIndex].width = newWidth;
        
        // Update total table width
        const totalWidth = resizingColumn.colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
        const table = resizingColumn.containerEl.querySelector('.ag-grid-table');
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
        
        // Update all cells in this column (+2 because row number is first column)
        const cells = table.querySelectorAll(`td:nth-child(${resizingColumn.colIndex + 2})`);
        cells.forEach(cell => {
            cell.style.width = newWidth + 'px';
            cell.style.minWidth = newWidth + 'px';
            cell.style.maxWidth = newWidth + 'px';
        });
    }
    
    function stopResize() {
        resizingColumn = null;
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    }

    function autoFitColumnWidth(colIndex, colDefs, sortCfg, filters, containerEl, data) {
        const col = colDefs[colIndex];
        if (!col) return;
        
        console.log(`[AUTO-FIT] Auto-fitting column "${col.headerName}" (index: ${colIndex})`);
        
        // Extract current column data for recalculation
        const columnData = data.map(row => row[col.field]);
        const newWidth = calculateOptimalColumnWidth(col.headerName, columnData, col.type);
        
        // Update column definition
        col.width = newWidth;
        
        // Update header
        const th = containerEl.querySelector(`th[data-field="${col.field}"]`);
        if (th) {
            th.style.width = newWidth + 'px';
            th.style.minWidth = newWidth + 'px';
            th.style.maxWidth = newWidth + 'px';
        }
        
        // Update total table width
        const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
        const table = containerEl.querySelector('.ag-grid-table');
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
        
        // Update all cells in this column (+2 because row number is first column)
        const cells = table.querySelectorAll(`td:nth-child(${colIndex + 2})`);
        cells.forEach(cell => {
            cell.style.width = newWidth + 'px';
            cell.style.minWidth = newWidth + 'px';
            cell.style.maxWidth = newWidth + 'px';
        });
        
        console.log(`[AUTO-FIT] Column "${col.headerName}" resized to ${newWidth}px`);
    }

    function autoFitAllColumns(colDefs, sortCfg, filters, containerEl, data) {
        console.log('[AUTO-FIT] Auto-fitting all columns');
        
        // Calculate new widths for all columns
        colDefs.forEach((col, index) => {
            const columnData = data.map(row => row[col.field]);
            const newWidth = calculateOptimalColumnWidth(col.headerName, columnData, col.type);
            col.width = newWidth;
        });
        
        // Re-render headers and rows to apply new widths
        renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, data);
        
        // Preserve current scroll position
        const viewport = containerEl.querySelector('.ag-grid-viewport');
        const currentScrollTop = viewport ? viewport.scrollTop : 0;
        
        // Re-render visible rows
        const ROW_HEIGHT = 30;
        const RENDER_CHUNK_SIZE = 50;
        const newStartRow = Math.floor(currentScrollTop / ROW_HEIGHT);
        renderAgGridRows(colDefs, data, containerEl, newStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);
        
        // Restore scroll position
        if (viewport) {
            viewport.scrollTop = currentScrollTop;
        }
        
        console.log('[AUTO-FIT] All columns auto-fitted');
    }

    function startResize(e, th, colIndex, colDefs, sortCfg, filters, containerEl) {
        resizingColumn = { th, colIndex, colDefs, containerEl };
        startX = e.clientX;
        startWidth = th.offsetWidth;

        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
        e.preventDefault();
        e.stopPropagation();
    }

    function renderAgGridRows(colDefs, data, containerEl, startRow = 0, rowHeight = 30, chunkSize = 50) {
        console.log('[AG-GRID] renderAgGridRows called - total:', data.length, 'rows, rendering from:', startRow, 'chunk:', chunkSize);
        const tbody = containerEl.querySelector('.ag-grid-tbody');
        if (!tbody) {
            console.error('[AG-GRID] tbody element not found!');
            return;
        }
        
        // Check if this is a nested table (expanded relation table)
        const isNestedTable = containerEl.classList.contains('nested-table-container');
        console.log('[AG-GRID] Is nested table:', isNestedTable);
        
        // PRESERVE EXPANDED ROWS: Detach expanded row elements before clearing (don't use innerHTML to preserve them)
        // Skip for nested tables as they shouldn't have expanded rows
        const expandedRowElements = isNestedTable ? [] : Array.from(tbody.querySelectorAll('.expanded-row-content'));
        const savedExpandedRows = expandedRowElements.map(el => {
            // Detach from DOM but keep the element
            const parent = el.parentNode;
            if (parent) {
                parent.removeChild(el);
            }
            return {
                element: el, // Keep the actual DOM element
                sourceRowIndex: parseInt(el.dataset.sourceRowIndex || '0'),
                expansionId: el.dataset.expansionId,
                expandKey: el.dataset.expandKey
            };
        });
        console.log('[AG-GRID] Preserving', savedExpandedRows.length, 'expanded rows before clearing');
        
        // Clear existing rows
        tbody.innerHTML = '';
        
        // Calculate visible range
        const endRow = Math.min(startRow + chunkSize, data.length);
        const totalHeight = data.length * rowHeight;
        const offsetY = startRow * rowHeight;
        
        // For nested tables, don't use virtual scrolling height (render all rows naturally)
        // For main tables, set tbody height to accommodate all rows (for scrolling)
        if (!isNestedTable) {
            tbody.style.height = totalHeight + 'px';
        }
        
        console.log('[AG-GRID] Rendering rows', startRow, 'to', endRow, '- offset:', offsetY, 'total height:', totalHeight);

        // Only render visible rows
        for (let i = startRow; i < endRow; i++) {
            const row = data[i];
            const rowIndex = i;
            
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = rowIndex;
            
            // For nested tables, use relative positioning within the nested container
            // For main tables, use absolute positioning based on actual row index
            const rowPosition = isNestedTable ? (i - startRow) * rowHeight : i * rowHeight;
            
            // Position rows absolutely with calculated offset
            tr.style.cssText = `
                position: absolute;
                top: ${rowPosition}px;
                left: 0;
                right: 0;
                height: ${rowHeight}px;
                border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
                display: table;
                width: 100%;
                table-layout: fixed;
            `;
            // Mouse hover handling
            tr.addEventListener('mouseenter', function() {
                if (!this.classList.contains('selected')) {
                    this.style.backgroundColor = 'var(--vscode-list-hoverBackground, #2a2d2e)';
                }
            });
            tr.addEventListener('mouseleave', function() {
                if (!this.classList.contains('selected')) {
                    this.style.backgroundColor = '';
                }
            });

            // Add row number cell
            const rowNumTd = document.createElement('td');
            rowNumTd.className = 'ag-grid-row-number-cell';
            rowNumTd.textContent = rowIndex + 1;
            
            // Set styles individually to avoid cssText overriding class styles
            rowNumTd.style.width = '50px';
            rowNumTd.style.minWidth = '50px';
            rowNumTd.style.maxWidth = '50px';
            rowNumTd.style.cursor = 'pointer';
            rowNumTd.style.padding = '0 8px';
            rowNumTd.style.whiteSpace = 'nowrap';
            rowNumTd.style.overflow = 'hidden';
            rowNumTd.style.textOverflow = 'ellipsis';
            rowNumTd.style.height = rowHeight + 'px';
            rowNumTd.style.lineHeight = rowHeight + 'px';
            rowNumTd.style.display = 'table-cell';
            rowNumTd.style.verticalAlign = 'middle';
            
            rowNumTd.addEventListener('mouseenter', function() {
                if (!tr.classList.contains('selected')) {
                    this.style.backgroundColor = 'var(--vscode-list-hoverBackground, #2a2d2e)';
                }
            });
            rowNumTd.addEventListener('mouseleave', function() {
                if (!tr.classList.contains('selected')) {
                    this.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
                }
            });
            rowNumTd.addEventListener('click', function(event) {
                const ctrlPressed = event.ctrlKey || event.metaKey;
                const shiftPressed = event.shiftKey;
                
                // Check if same table
                const sameTable = globalSelection.tableContainer === containerEl;
                const sameType = globalSelection.type === 'row';
                
                if (shiftPressed && sameTable && sameType && globalSelection.lastClickedIndex !== null) {
                    // Shift: select range from last clicked to current
                    const start = Math.min(globalSelection.lastClickedIndex, rowIndex);
                    const end = Math.max(globalSelection.lastClickedIndex, rowIndex);
                    
                    clearAllSelections();
                    globalSelection.selections = [];
                    
                    for (let i = start; i <= end; i++) {
                        globalSelection.selections.push({ rowIndex: i });
                        applyRowHighlightGlobal(containerEl, i);
                    }
                    
                    globalSelection.type = 'row';
                    globalSelection.tableContainer = containerEl;
                    globalSelection.data = data;
                    globalSelection.columnDefs = colDefs;
                    globalSelection.resultSetIndex = resultSetIndex;
                    globalSelection.metadata = metadata;
                } else if (ctrlPressed && sameTable && sameType) {
                    // Ctrl: toggle individual selection
                    const existingIndex = globalSelection.selections.findIndex(s => s.rowIndex === rowIndex);
                    
                    if (existingIndex >= 0) {
                        // Remove from selection
                        globalSelection.selections.splice(existingIndex, 1);
                        
                        if (globalSelection.selections.length === 0) {
                            // No more selections
                            clearAllSelections();
                            globalSelection = {
                                type: null,
                                tableContainer: null,
                                selections: [],
                                columnDef: null,
                                data: null,
                                columnDefs: null,
                                lastClickedIndex: null
                            };
                        } else {
                            // Reapply all selections
                            clearAllSelections();
                            globalSelection.selections.forEach(s => {
                                applyRowHighlightGlobal(containerEl, s.rowIndex);
                            });
                        }
                    } else {
                        // Add to selection
                        globalSelection.selections.push({ rowIndex: rowIndex });
                        applyRowHighlightGlobal(containerEl, rowIndex);
                    }
                    
                    globalSelection.lastClickedIndex = rowIndex;
                } else {
                    // Normal click: single selection
                    const isAlreadySelected = sameTable && sameType && 
                        globalSelection.selections.length === 1 && 
                        globalSelection.selections[0].rowIndex === rowIndex;
                    
                    if (isAlreadySelected) {
                        // Unselect - clear all selections
                        clearAllSelections();
                        globalSelection = {
                            type: null,
                            tableContainer: null,
                            selections: [],
                            columnDef: null,
                            data: null,
                            columnDefs: null,
                            lastClickedIndex: null
                        };
                    } else {
                        // Clear all selections across all tables
                        clearAllSelections();
                        
                        // Collect all cell values from the row
                        const rowSelections = colDefs.map((col, colIndex) => ({
                            rowIndex: rowIndex,
                            columnIndex: colIndex,
                            cellValue: row[col.field]
                        }));
                        
                        // Set global selection state
                        globalSelection = {
                            type: 'row',
                            tableContainer: containerEl,
                            selections: rowSelections,
                            data: data,
                            columnDefs: colDefs,
                            lastClickedIndex: rowIndex,
                            resultSetIndex: resultSetIndex,
                            metadata: metadata
                        };
                        
                        // Apply highlighting
                        applyRowHighlightGlobal(containerEl, rowIndex);
                    }
                }
                
                // Update aggregation stats
                updateAggregationStats();
            });
            
            // Add context menu for row number cell
            rowNumTd.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showRowContextMenu(e, {
                    table: containerEl.querySelector('.ag-grid-table'),
                    rowIndex: rowIndex,
                    columnDefs: colDefs,
                    data: data,
                    metadata: metadata,
                    resultSetIndex: resultSetIndex
                });
            });
            tr.appendChild(rowNumTd);

            colDefs.forEach((col, colIndex) => {
                const td = document.createElement('td');
                
                // Base styles
                td.style.width = col.width + 'px';
                td.style.minWidth = col.width + 'px';
                td.style.maxWidth = col.width + 'px';
                td.style.borderRight = '1px solid var(--vscode-panel-border, #3c3c3c)';
                td.style.padding = '0 8px';
                td.style.whiteSpace = 'nowrap';
                td.style.overflow = 'hidden';
                td.style.textOverflow = 'ellipsis';
                td.style.height = rowHeight + 'px';
                td.style.lineHeight = rowHeight + 'px';
                td.style.display = 'table-cell';
                td.style.verticalAlign = 'middle';
                
                if (col.pinned) {
                    const leftOffset = calculatePinnedOffset(colDefs, colIndex);
                    td.style.left = leftOffset + 'px';
                    td.classList.add('ag-grid-pinned-cell');
                }
                
                const value = row[col.field];
                
                if (value === null || value === undefined) {
                    td.textContent = 'NULL';
                    td.style.color = 'var(--vscode-descriptionForeground)';
                    td.style.fontStyle = 'italic';
                } else if (col.type === 'boolean') {
                    td.textContent = value ? '✓' : '✗';
                } else if (col.type === 'number') {
                    td.textContent = typeof value === 'number' ? value.toLocaleString() : value;
                    td.style.textAlign = 'right';
                } else {
                    const strValue = String(value);
                    td.textContent = strValue;
                    
                    // Check if content is valid JSON or XML
                    const isJSON = isValidJSON(strValue);
                    const isXML = !isJSON && isValidXML(strValue);
                    
                    if (isJSON || isXML) {
                        // Make it clickable
                        td.classList.add('clickable-cell');
                        td.style.cursor = 'pointer';
                        td.style.color = 'var(--vscode-textLink-foreground, #3794ff)';
                        
                        // Add hover effect
                        td.addEventListener('mouseenter', function() {
                            this.style.textDecoration = 'underline';
                        });
                        td.addEventListener('mouseleave', function() {
                            this.style.textDecoration = 'none';
                        });
                        
                        // Add click handler to open in new editor
                        const contentType = isJSON ? 'json' : 'xml';
                        td.addEventListener('click', function(e) {
                            // Prevent context menu or selection behavior
                            e.stopPropagation();
                            
                            const formatted = isJSON ? formatJSON(strValue) : formatXML(strValue);
                            openInNewEditor(formatted, contentType);
                        });
                        
                        // Update title to indicate it's clickable
                        td.title = `Click to open ${contentType.toUpperCase()} in new editor\n\n${strValue.substring(0, 200)}${strValue.length > 200 ? '...' : ''}`;
                    }
                }
                
                // Add FK/PK expansion icon for columns with foreign key references
                if (metadata && metadata.columns && (col.isPrimaryKey || col.isForeignKey)) {
                    const colMetadata = metadata.columns[colIndex];
                    if (colMetadata && colMetadata.foreignKeyReferences && colMetadata.foreignKeyReferences.length > 0 && value !== null && value !== undefined) {
                        const originalContent = td.textContent;
                        td.textContent = '';
                        td.style.position = 'relative';
                        td.dataset.column = col.field;
                        
                        const wrapper = document.createElement('span');
                        wrapper.style.cssText = `
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                            width: 100%;
                        `;
                        
                        const valueSpan = document.createElement('span');
                        valueSpan.textContent = originalContent;
                        valueSpan.style.cssText = `
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                            flex: 1;
                        `;
                        wrapper.appendChild(valueSpan);
                        
                        const chevron = document.createElement('span');
                        chevron.className = 'chevron-icon';
                        chevron.dataset.column = col.field;
                        chevron.style.cssText = `
                            display: none;
                            opacity: 0;
                            transition: all 0.2s;
                            cursor: pointer;
                            color: var(--vscode-button-background);
                            flex-shrink: 0;
                        `;
                        chevron.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        `;
                        
                        chevron.addEventListener('click', (e) => {
                            handleChevronClick(e, col, value, tr, rowIndex, tableId, containerEl, metadata, colIndex);
                        });
                        
                        wrapper.appendChild(chevron);
                        td.appendChild(wrapper);
                        
                        // Show/hide chevron on hover
                        td.addEventListener('mouseenter', () => {
                            chevron.style.display = 'inline-flex';
                            chevron.style.opacity = '1';
                        });
                        td.addEventListener('mouseleave', () => {
                            if (!chevron.classList.contains('expanded')) {
                                chevron.style.display = 'none';
                                chevron.style.opacity = '0';
                            }
                        });
                    }
                }
                
                // Add context menu handler
                td.addEventListener('contextmenu', (e) => {
                    showContextMenu(e, {
                        table: containerEl.querySelector('.ag-grid-table'),
                        rowIndex: rowIndex,
                        columnIndex: colIndex,
                        columnDefs: colDefs,
                        data: data
                    });
                });
                
                // Add click handler for cell selection
                td.addEventListener('click', (e) => {
                    const ctrlPressed = e.ctrlKey || e.metaKey;
                    const shiftPressed = e.shiftKey;
                    
                    // Check if same table
                    const sameTable = globalSelection.tableContainer === containerEl;
                    const sameType = globalSelection.type === 'cell';
                    
                    if (shiftPressed && sameTable && sameType && globalSelection.lastClickedIndex !== null) {
                        // Shift: select rectangular range from last clicked to current
                        const lastSel = globalSelection.lastClickedIndex;
                        const startRow = Math.min(lastSel.rowIndex, rowIndex);
                        const endRow = Math.max(lastSel.rowIndex, rowIndex);
                        const startCol = Math.min(lastSel.columnIndex, colIndex);
                        const endCol = Math.max(lastSel.columnIndex, colIndex);
                        
                        clearAllSelections();
                        globalSelection.selections = [];
                        
                        for (let r = startRow; r <= endRow; r++) {
                            for (let c = startCol; c <= endCol; c++) {
                                globalSelection.selections.push({ 
                                    rowIndex: r, 
                                    columnIndex: c,
                                    cellValue: data[r][colDefs[c].field]
                                });
                                applyCellHighlightGlobal(containerEl, r, c);
                            }
                        }
                        
                        globalSelection.type = 'cell';
                        globalSelection.tableContainer = containerEl;
                        globalSelection.data = data;
                        globalSelection.columnDefs = colDefs;
                        globalSelection.resultSetIndex = resultSetIndex;
                    } else if (ctrlPressed && sameTable && sameType) {
                        // Ctrl: toggle individual cell
                        const existingIndex = globalSelection.selections.findIndex(
                            s => s.rowIndex === rowIndex && s.columnIndex === colIndex
                        );
                        
                        if (existingIndex >= 0) {
                            // Remove from selection
                            globalSelection.selections.splice(existingIndex, 1);
                            
                            if (globalSelection.selections.length === 0) {
                                // No more selections
                                clearAllSelections();
                                globalSelection = {
                                    type: null,
                                    tableContainer: null,
                                    selections: [],
                                    columnDef: null,
                                    data: null,
                                    columnDefs: null,
                                    lastClickedIndex: null
                                };
                            } else {
                                // Reapply all selections
                                clearAllSelections();
                                globalSelection.selections.forEach(s => {
                                    applyCellHighlightGlobal(containerEl, s.rowIndex, s.columnIndex);
                                });
                            }
                        } else {
                            // Add to selection
                            globalSelection.selections.push({ 
                                rowIndex: rowIndex, 
                                columnIndex: colIndex,
                                cellValue: row[col.field]
                            });
                            applyCellHighlightGlobal(containerEl, rowIndex, colIndex);
                        }
                        
                        globalSelection.lastClickedIndex = { rowIndex, columnIndex };
                    } else {
                        // Normal click: single selection
                        const isAlreadySelected = sameTable && sameType && 
                            globalSelection.selections.length === 1 && 
                            globalSelection.selections[0].rowIndex === rowIndex &&
                            globalSelection.selections[0].columnIndex === colIndex;
                        
                        if (isAlreadySelected) {
                            // Unselect - clear all selections
                            clearAllSelections();
                            globalSelection = {
                                type: null,
                                tableContainer: null,
                                selections: [],
                                columnDef: null,
                                data: null,
                                columnDefs: null,
                                lastClickedIndex: null
                            };
                        } else {
                            // Clear all selections across all tables
                            clearAllSelections();
                            
                            // Set global selection state
                            globalSelection = {
                                type: 'cell',
                                tableContainer: containerEl,
                                selections: [{ 
                                    rowIndex: rowIndex, 
                                    columnIndex: colIndex,
                                    cellValue: row[col.field]
                                }],
                                columnDef: colDefs[colIndex],
                                data: data,
                                columnDefs: colDefs,
                                lastClickedIndex: { rowIndex, colIndex },
                                resultSetIndex: resultSetIndex
                            };
                            
                            // Apply highlighting
                            applyCellHighlightGlobal(containerEl, rowIndex, colIndex);
                        }
                    }
                    
                    // Update aggregation stats
                    updateAggregationStats();
                });

                // Apply PK/FK column styling (PK takes priority) if enabled in configuration
                if (colorPrimaryForeignKeys) {
                    if (col.isPrimaryKey) {
                        td.classList.add('pk-column');
                    } else if (col.isForeignKey) {
                        td.classList.add('fk-column');
                    }
                }

                // Add double-click handler for editing (if editable)
                if (metadata && metadata.isEditable) {
                    td.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        enterEditMode(td, row, col, rowIndex, colIndex, data, colDefs, containerEl, resultSetIndex, metadata);
                    });
                    // Visual indicator that cell is editable
                    td.classList.add('editable-cell');
                    td.style.cursor = 'cell';
                }

                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        }
        
        console.log('[AG-GRID] Rendered', endRow - startRow, 'rows successfully (from', startRow, 'to', endRow, ')');
        
        // RESTORE EXPANDED ROWS: Re-attach saved expanded row DOM elements back into tbody
        // Skip for nested tables as they shouldn't have expanded rows
        if (!isNestedTable && savedExpandedRows.length > 0) {
            console.log('[AG-GRID] Restoring', savedExpandedRows.length, 'expanded rows');
            savedExpandedRows.forEach(saved => {
                // Re-attach the actual DOM element (not a copy)
                tbody.appendChild(saved.element);
                
                // Update the reference in expandedRows map using expandKey
                if (saved.expandKey && typeof expandedRows !== 'undefined') {
                    const existingEntry = expandedRows.get(saved.expandKey);
                    if (existingEntry) {
                        existingEntry.element = saved.element;
                        console.log('[AG-GRID] Updated expandedRows map reference for key:', saved.expandKey);
                    } else {
                        console.warn('[AG-GRID] No existing entry in expandedRows map for key:', saved.expandKey);
                    }
                }
                
                console.log('[AG-GRID] Restored expanded row for source index:', saved.sourceRowIndex, 'expandKey:', saved.expandKey);
                
                // IMPORTANT: Re-apply row shifting to push rows below down by the expanded row's height
                if (typeof shiftRowsBelow !== 'undefined') {
                    const expandedHeight = parseInt(saved.element.style.height || '60');
                    shiftRowsBelow(tbody, saved.sourceRowIndex, expandedHeight);
                    console.log('[AG-GRID] Re-applied row shifting for expanded row at index:', saved.sourceRowIndex, 'height:', expandedHeight);
                }
            });
        }
        
        // Reapply selection if this is the selected table
        if (globalSelection.tableContainer === containerEl) {
            reapplySelection();
        }
    }

    function calculatePinnedOffset(colDefs, colIndex) {
        let offset = 50; // Start after row number column
        for (let i = 0; i < colIndex; i++) {
            if (colDefs[i].pinned) {
                offset += colDefs[i].width;
            }
        }
        return offset;
    }

    function handleSort(col, colDefs, sortCfg, filters, containerEl) {
        // Clear any expanded rows before sorting
        const tbody = containerEl.querySelector('.ag-grid-tbody');
        if (tbody) {
            const expandedRows = tbody.querySelectorAll('.expanded-row-content');
            expandedRows.forEach(row => row.remove());
        }
        
        // Clear expansion state
        if (typeof clearAllExpandedRows === 'function') {
            clearAllExpandedRows();
        }

        if (sortCfg.field === col.field) {
            if (sortCfg.direction === 'asc') {
                sortCfg.direction = 'desc';
            } else if (sortCfg.direction === 'desc') {
                sortCfg.field = null;
                sortCfg.direction = null;
            }
        } else {
            sortCfg.field = col.field;
            sortCfg.direction = 'asc';
        }
        
        currentStartRow = 0; // Reset to top after sort
        const viewport = containerEl.querySelector('.ag-grid-viewport');
        if (viewport) viewport.scrollTop = 0;
        
        updateFilteredData(colDefs, sortCfg, filters, containerEl);
        renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
    }

    function showAgGridFilter(e, col, th, colDefs, sortCfg, filters, containerEl) {
        e.stopPropagation();

        if (currentFilterPopup) {
            currentFilterPopup.remove();
            currentFilterPopup = null;
        }

        const popup = document.createElement('div');
        popup.style.cssText = `
            position: absolute;
            background-color: var(--vscode-dropdown-background, #3c3c3c);
            border: 1px solid var(--vscode-dropdown-border, #454545);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
            padding: 12px;
            z-index: 1000;
            min-width: 200px;
            max-width: 300px;
            border-radius: 3px;
        `;

        const rect = th.getBoundingClientRect();
        popup.style.left = rect.left + 'px';
        popup.style.top = (rect.bottom + 5) + 'px';

        let html = `<h4 style="margin-bottom: 8px; font-size: 12px;">Filter: ${col.headerName}</h4>`;

        // Simple value selection for now
        const uniqueValues = [...new Set(rowData.map(row => row[col.field]))].sort();
        const currentFilter = filters[col.field];
        const selectedValues = currentFilter?.values || uniqueValues;

        html += '<input type="text" id="agFilterSearch" placeholder="Search..." style="width: 100%; padding: 4px 6px; margin-bottom: 8px; background-color: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 2px; font-size: 12px;">';
        html += '<div style="font-size: 11px; color: var(--vscode-descriptionForeground, #999999); margin-bottom: 4px;">' + selectedValues.length + ' Selected</div>';
        html += '<div style="margin-bottom: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);">';
        html += '<label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" id="agSelectAll" ' + (selectedValues.length === uniqueValues.length ? 'checked' : '') + ' style="cursor: pointer; accent-color: var(--vscode-button-background, #0e639c);"><span style="font-size: 12px;">(Select All)</span></label>';
        html += '</div>';
        html += '<div id="agFilterValuesList" style="max-height: 200px; overflow-y: auto; margin-bottom: 8px;">';

        uniqueValues.forEach((value, idx) => {
            const displayValue = col.type === 'boolean' ? (value ? 'True' : 'False') : 
                               value === null || value === undefined ? 'NULL' : String(value);
            const checked = selectedValues.includes(value) ? 'checked' : '';
            html += `
                <label style="display: flex; align-items: center; gap: 6px; padding: 4px 0; cursor: pointer;" data-value="${displayValue.toString().toLowerCase()}">
                    <input type="checkbox" value="${value}" ${checked} class="ag-value-checkbox" style="cursor: pointer; accent-color: var(--vscode-button-background, #0e639c);">
                    <span style="flex: 1; font-size: 12px;">${displayValue}</span>
                </label>
            `;
        });

        html += '</div>';
        html += `
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="agFilterClear" style="padding: 4px 12px; background-color: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #cccccc); border: none; border-radius: 2px; cursor: pointer; font-size: 11px;">Clear</button>
                <button id="agFilterApply" style="padding: 4px 12px; background-color: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #ffffff); border: none; border-radius: 2px; cursor: pointer; font-size: 11px;">Apply</button>
            </div>
        `;

        popup.innerHTML = html;
        document.body.appendChild(popup);
        currentFilterPopup = popup;

        // Setup event listeners
        const searchInput = popup.querySelector('#agFilterSearch');
        searchInput.oninput = () => {
            const searchTerm = searchInput.value.toLowerCase();
            const items = popup.querySelectorAll('#agFilterValuesList label');
            items.forEach(item => {
                const value = item.dataset.value;
                item.style.display = value.includes(searchTerm) ? 'flex' : 'none';
            });
        };

        const selectAllCheckbox = popup.querySelector('#agSelectAll');
        const valueCheckboxes = popup.querySelectorAll('.ag-value-checkbox');
        
        selectAllCheckbox.onchange = () => {
            valueCheckboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
        };

        popup.querySelector('#agFilterClear').onclick = () => {
            delete filters[col.field];
            
            // Clear any expanded rows before clearing filter
            const tbody = containerEl.querySelector('.ag-grid-tbody');
            if (tbody) {
                const expandedRows = tbody.querySelectorAll('.expanded-row-content');
                expandedRows.forEach(row => row.remove());
            }
            
            // Clear expansion state
            if (typeof clearAllExpandedRows === 'function') {
                clearAllExpandedRows();
            }

            currentStartRow = 0; // Reset to top after clearing filter
            const viewport = containerEl.querySelector('.ag-grid-viewport');
            if (viewport) viewport.scrollTop = 0;
            
            updateFilteredData(colDefs, sortCfg, filters, containerEl);
            renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
            popup.remove();
            currentFilterPopup = null;
        };

        popup.querySelector('#agFilterApply').onclick = () => {
            const checkboxes = popup.querySelectorAll('.ag-value-checkbox:checked');
            const values = [...checkboxes].map(cb => {
                const val = cb.value;
                if (col.type === 'number') return parseFloat(val);
                if (col.type === 'boolean') return val === 'true';
                return val;
            });
            filters[col.field] = { values };
            
            // Clear any expanded rows before applying filter
            const tbody = containerEl.querySelector('.ag-grid-tbody');
            if (tbody) {
                const expandedRows = tbody.querySelectorAll('.expanded-row-content');
                expandedRows.forEach(row => row.remove());
            }
            
            // Clear expansion state
            if (typeof clearAllExpandedRows === 'function') {
                clearAllExpandedRows();
            }

            currentStartRow = 0; // Reset to top after filter
            const viewport = containerEl.querySelector('.ag-grid-viewport');
            if (viewport) viewport.scrollTop = 0;
            
            updateFilteredData(colDefs, sortCfg, filters, containerEl);
            renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
            popup.remove();
            currentFilterPopup = null;
        };

        setTimeout(() => {
            document.addEventListener('click', closeFilterPopup);
        }, 0);

        function closeFilterPopup(e) {
            if (currentFilterPopup && !currentFilterPopup.contains(e.target)) {
                currentFilterPopup.remove();
                currentFilterPopup = null;
                document.removeEventListener('click', closeFilterPopup);
            }
        }
    }

    function updateFilteredData(colDefs, sortCfg, filters, containerEl) {
        filteredData = rowData.filter(row => {
            return Object.entries(filters).every(([field, filter]) => {
                const value = row[field];
                return filter.values && filter.values.includes(value);
            });
        });

        if (sortCfg.field) {
            filteredData.sort((a, b) => {
                const aVal = a[sortCfg.field];
                const bVal = b[sortCfg.field];
                
                let comparison = 0;
                if (aVal < bVal) comparison = -1;
                if (aVal > bVal) comparison = 1;
                
                return sortCfg.direction === 'asc' ? comparison : -comparison;
            });
        }

        renderAgGridRows(colDefs, filteredData, containerEl, currentStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);
    }
}

// ===== EDITING FUNCTIONS =====

function enterEditMode(td, row, col, rowIndex, colIndex, data, colDefs, containerEl, resultSetIndex, metadata) {
    // If already editing this cell, do nothing
    if (currentEditingCell && currentEditingCell.rowIndex === rowIndex && currentEditingCell.colIndex === colIndex) {
        return;
    }

    // Cancel any existing edit
    if (currentEditingCell) {
        cancelEdit();
    }

    const originalValue = row[col.field];
    const originalPadding = td.style.padding;
    
    // Create input element
    const input = document.createElement('input');
    
    if (col.type === 'boolean') {
        input.type = 'checkbox';
        input.checked = originalValue === true || originalValue === 1 || String(originalValue).toLowerCase() === 'true';
        input.className = 'cell-editor-checkbox';
        input.style.margin = '0 auto';
        input.style.display = 'block';
        input.style.width = '16px';
        input.style.height = '16px';
        input.style.cursor = 'pointer';
        input.style.accentColor = 'var(--vscode-button-background)';
    } else {
        input.type = 'text';
        input.value = originalValue === null ? '' : String(originalValue);
        input.className = 'cell-editor';
        input.style.width = '100%';
        input.style.height = '100%';
        input.style.border = 'none';
        input.style.outline = '2px solid var(--vscode-focusBorder)';
        input.style.background = 'var(--vscode-input-background)';
        input.style.color = 'var(--vscode-input-foreground)';
        input.style.padding = '0 8px';
        input.style.margin = '0';
        input.style.boxSizing = 'border-box';
        input.style.fontFamily = 'inherit';
        input.style.fontSize = 'inherit';
        
        if (col.type === 'number') {
            input.style.textAlign = 'right';
        }
    }
    
    // Store current editing state
    currentEditingCell = {
        td,
        row,
        col,
        rowIndex,
        colIndex,
        originalValue,
        resultSetIndex,
        metadata,
        originalPadding
    };

    // Clear cell and add input
    td.style.padding = '0';
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();

    // Handle input events
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = input.type === 'checkbox' ? input.checked : input.value;
            commitEdit(val);
            e.stopPropagation(); // Prevent row selection or other grid events
        } else if (e.key === 'Escape') {
            cancelEdit();
            e.stopPropagation();
        }
    });

    input.addEventListener('blur', () => {
        // Commit on blur
        const val = input.type === 'checkbox' ? input.checked : input.value;
        commitEdit(val);
    });
    
    input.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent row selection
    });
    
    input.addEventListener('dblclick', (e) => {
        e.stopPropagation(); // Prevent re-entering edit mode
    });
}

function commitEdit(newValue) {
    if (!currentEditingCell) return;

    const { td, row, col, rowIndex, colIndex, originalValue, resultSetIndex, metadata, originalPadding } = currentEditingCell;
    
    // Check if value changed
    let valueChanged = false;
    
    if (col.type === 'boolean') {
        // Normalize original value to boolean
        const boolOriginal = originalValue === true || originalValue === 1 || String(originalValue).toLowerCase() === 'true';
        if (newValue !== boolOriginal) {
            valueChanged = true;
        }
    } else {
        const stringOriginal = originalValue === null ? '' : String(originalValue);
        if (newValue !== stringOriginal) {
            valueChanged = true;
        }
    }
    
    if (valueChanged) {
        // Update data model
        row[col.field] = newValue; 
        
        // Track change
        if (!pendingChanges.has(resultSetIndex)) {
            pendingChanges.set(resultSetIndex, []);
        }
        
        const changes = pendingChanges.get(resultSetIndex);
        // Check if we already have a change for this row/col
        const existingChangeIndex = changes.findIndex(c => 
            c.rowIndex === rowIndex && c.column === col.headerName
        );
        
        const pkValues = getPrimaryKeyValues(row, metadata);
        
        if (existingChangeIndex >= 0) {
            changes[existingChangeIndex].newValue = newValue;
        } else {
            changes.push({
                type: 'UPDATE',
                rowIndex,
                colIndex,
                column: col.headerName,
                originalValue,
                newValue,
                pk: pkValues
            });
        }
        
        updatePendingChangesCount();
        td.classList.add('cell-modified');
    }

    // Restore cell display
    td.style.padding = originalPadding || '0 8px';
    
    if (col.type === 'boolean') {
        td.textContent = newValue ? '✓' : '✗';
    } else if (newValue === null) {
        td.classList.add('null-value');
        td.textContent = 'NULL';
    } else {
        td.textContent = newValue;
        td.classList.remove('null-value');
    }
    
    currentEditingCell = null;
}

function cancelEdit() {
    if (!currentEditingCell) return;
    
    const { td, originalValue, originalPadding } = currentEditingCell;
    td.style.padding = originalPadding || '0 8px';
    td.textContent = originalValue === null ? 'NULL' : String(originalValue);
    if (originalValue === null) td.classList.add('null-value');
    
    currentEditingCell = null;
}

function updatePendingChangesCount() {
    let totalChanges = 0;
    pendingChanges.forEach(changes => {
        totalChanges += changes.length;
    });

    console.log('[EDIT] Total pending changes:', totalChanges);

    // Update tab badge
    const badge = document.getElementById('pendingChangesCount');
    const tab = document.querySelector('[data-tab="pendingChanges"]');
    
    if (badge) {
        badge.textContent = totalChanges;
        badge.style.display = totalChanges > 0 ? 'inline-block' : 'none';
    }
    
    if (tab) {
        if (totalChanges > 0) {
            tab.style.display = '';
        } else {
            tab.style.display = 'none';
            // If currently viewing pending changes tab, switch to results
            if (currentTab === 'pendingChanges') {
                switchTab('results');
            }
        }
    }
    
    // Update quick save button
    updateQuickSaveButton();
}

function renderPendingChanges() {
    const container = document.getElementById('pendingChangesContent');
    if (!container) return;

    const totalChanges = Array.from(pendingChanges.values()).reduce((sum, changes) => sum + changes.length, 0);

    if (totalChanges === 0) {
        container.innerHTML = '<div class="no-pending-changes">No pending changes</div>';
        return;
    }

    let html = `
        <div class="pending-changes-header">
            <div class="pending-changes-title">${totalChanges} Pending Change${totalChanges !== 1 ? 's' : ''}</div>
            <div class="pending-changes-actions">
                <button onclick="previewUpdateStatements()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" /></svg>
                    Preview SQL
                </button>
                <button class="secondary" onclick="revertAllChanges()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>
                    Revert All
                </button>
                <button onclick="commitAllChanges()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 12l5 5l10 -10" /></svg>
                    Commit All
                </button>
            </div>
        </div>
        <div class="pending-changes-list">
    `;

    pendingChanges.forEach((changes, resultSetIndex) => {
        const metadata = resultSetMetadata[resultSetIndex];
        
        changes.forEach((change, changeIndex) => {
            const { type, rowIndex, column: columnName, originalValue: oldValue, newValue, pk: primaryKeyValues } = change;
            
            // Map new structure to old structure expected by generateUpdateStatement
            // The new structure uses 'column', 'originalValue', 'pk'
            // The old structure used 'columnName', 'oldValue', 'primaryKeyValues'
            // We need to adapt the change object or the generateUpdateStatement function
            // Let's adapt the change object here for display purposes
            
            // Also need sourceTable and sourceSchema which might be in metadata or change object
            // In grid.js commitEdit, we didn't save sourceTable/Schema explicitly in the change object
            // We need to retrieve it from metadata
            
            let sourceTable = 'UnknownTable';
            let sourceSchema = 'dbo';
            let sourceColumn = columnName;
            
            if (metadata && metadata.columns) {
                const colDef = metadata.columns.find(c => c.name === columnName);
                if (colDef) {
                    // If metadata has table info (it should if it came from the extension)
                    // But wait, the metadata structure in grid.js might be different
                    // Let's assume for now we can get it or fallback
                }
            }
            
            // For now, let's try to use what we have. 
            // The generateUpdateStatement needs to be robust.
            
            // Construct a change object compatible with generateUpdateStatement
            // We need to ensure we have table info. 
            // In the new grid.js, we might need to look up table info from metadata.
            
            // Let's look at how commitEdit saves the change.
            // It saves: type, rowIndex, column, originalValue, newValue, pk
            
            // We need to enhance the change object or look up metadata here.
            // Let's try to find the column metadata
            let colMetadata = null;
            if (metadata && metadata.columns) {
                // Try exact match first, then case-insensitive
                colMetadata = metadata.columns.find(c => c.name === columnName) || 
                              metadata.columns.find(c => c.name.toLowerCase() === columnName.toLowerCase());
            }
            
            // If we have column metadata, use it for table name
            // Note: The extension sends metadata with tableName and schemaName if available
            
            // Fallback to result set metadata if column metadata doesn't have table info
            let tableNameVal = colMetadata && colMetadata.tableName ? colMetadata.tableName : (metadata ? metadata.sourceTable : null);
            let schemaNameVal = colMetadata && colMetadata.schemaName ? colMetadata.schemaName : (metadata ? metadata.sourceSchema : 'dbo');

            // For display purposes:
            const tableName = schemaNameVal ? `${schemaNameVal}.${tableNameVal || 'Table'}` : (tableNameVal || 'Table');
            
            // Prepare change object for generateUpdateStatement
            const changeForSql = {
                ...change,
                columnName: columnName,
                sourceColumn: columnName,
                sourceTable: tableNameVal,
                sourceSchema: schemaNameVal,
                primaryKeyValues: primaryKeyValues
            };
            
            let sql = '';
            try {
                sql = generateUpdateStatement(changeForSql, metadata);
            } catch (error) {
                sql = `-- Error: ${error.message}`;
            }
            
            // Handle DELETE display differently
            if (type === 'DELETE') {
                html += `
                    <div class="change-item change-item-delete">
                        <div class="change-header">
                            <div class="change-location">🗑️ ${tableName} (Row ${rowIndex + 1}) - DELETE</div>
                            <button class="change-revert" onclick="revertChange(${resultSetIndex}, ${changeIndex})">Revert</button>
                        </div>
                        <div class="change-sql">${escapeHtml(sql)}</div>
                    </div>
                `;
            } else {
                // UPDATE display
                // Normalize boolean values to 0/1 for display
                const normalizeValue = (val) => {
                    if (val === null || val === undefined) return 'NULL';
                    if (typeof val === 'boolean') return val ? '1' : '0';
                    return String(val);
                };
                
                const oldDisplay = normalizeValue(oldValue);
                const newDisplay = normalizeValue(newValue);
                
                html += `
                    <div class="change-item">
                        <div class="change-header">
                            <div class="change-location">${tableName}.${columnName} (Row ${rowIndex + 1})</div>
                            <button class="change-revert" onclick="revertChange(${resultSetIndex}, ${changeIndex})">Revert</button>
                        </div>
                        <div class="change-details">
                            <div class="change-label">Old value:</div>
                            <div class="change-value change-value-old">${escapeHtml(oldDisplay)}</div>
                            <div class="change-label">New value:</div>
                            <div class="change-value change-value-new">${escapeHtml(newDisplay)}</div>
                        </div>
                        <div class="change-sql">${escapeHtml(sql)}</div>
                    </div>
                `;
            }
        });
    });

    html += '</div>';
    container.innerHTML = html;
}

function generateUpdateStatement(change, metadata) {
    // Handle DELETE statements
    if (change.type === 'DELETE') {
        const { primaryKeyValues, sourceTable, sourceSchema } = change;
        
        if (!sourceTable) {
            // Try to infer from metadata if not in change object
            // This is a fallback
             throw new Error('Cannot generate DELETE: no source table');
        }

        const fullTableName = sourceSchema ? `[${sourceSchema}].[${sourceTable}]` : `[${sourceTable}]`;
        
        // Build WHERE clause with primary keys
        const whereConditions = Object.entries(primaryKeyValues).map(([pkCol, pkValue]) => {
            return `[${pkCol}] = ${sqlEscape(pkValue)}`;
        }).join(' AND ');

        if (!whereConditions) {
            throw new Error('Cannot generate DELETE: no primary key values');
        }

        return `DELETE FROM ${fullTableName} WHERE ${whereConditions};`;
    }
    
    // Handle UPDATE statements
    const { columnName, newValue, primaryKeyValues, sourceTable, sourceSchema, sourceColumn } = change;

    if (!sourceTable) {
         // Try to find table info in metadata if missing
         if (metadata) {
             // 1. Try column metadata (case-insensitive)
             if (metadata.columns) {
                 const col = metadata.columns.find(c => c.name === columnName || c.name.toLowerCase() === columnName.toLowerCase());
                 if (col && col.tableName) {
                     // We found it!
                     const table = col.tableName;
                     const schema = col.schemaName || 'dbo';
                     const fullTableName = `[${schema}].[${table}]`;
                     const setClause = `[${columnName}] = ${sqlEscape(newValue)}`;
                     const whereConditions = Object.entries(primaryKeyValues).map(([pkCol, pkValue]) => {
                        return `[${pkCol}] = ${sqlEscape(pkValue)}`;
                     }).join(' AND ');
                     return `UPDATE ${fullTableName} SET ${setClause} WHERE ${whereConditions};`;
                 }
             }
             
             // 2. Try result set metadata (if single table)
             if (metadata.sourceTable) {
                 const table = metadata.sourceTable;
                 const schema = metadata.sourceSchema || 'dbo';
                 const fullTableName = `[${schema}].[${table}]`;
                 const setClause = `[${columnName}] = ${sqlEscape(newValue)}`;
                 const whereConditions = Object.entries(primaryKeyValues).map(([pkCol, pkValue]) => {
                    return `[${pkCol}] = ${sqlEscape(pkValue)}`;
                 }).join(' AND ');
                 return `UPDATE ${fullTableName} SET ${setClause} WHERE ${whereConditions};`;
             }
         }
        throw new Error(`Cannot generate UPDATE: column '${columnName}' has no source table`);
    }

    const fullTableName = sourceSchema ? `[${sourceSchema}].[${sourceTable}]` : `[${sourceTable}]`;
    
    // Build SET clause with proper escaping
    const setClause = `[${sourceColumn}] = ${sqlEscape(newValue)}`;
    
    // Build WHERE clause with primary keys
    const whereConditions = Object.entries(primaryKeyValues).map(([pkCol, pkValue]) => {
        return `[${pkCol}] = ${sqlEscape(pkValue)}`;
    }).join(' AND ');

    if (!whereConditions) {
        throw new Error('Cannot generate UPDATE: no primary key values');
    }

    return `UPDATE ${fullTableName} SET ${setClause} WHERE ${whereConditions};`;
}

/**
 * SQL escape value for use in queries
 */
function sqlEscape(value) {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    
    if (typeof value === 'number') {
        return String(value);
    }
    
    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }
    
    // String - escape single quotes and wrap in quotes
    const strValue = String(value);
    return `'${strValue.replace(/'/g, "''")}'`;
}

/**
 * Revert a single change
 */
function revertChange(resultSetIndex, changeIndex) {
    const changes = pendingChanges.get(resultSetIndex);
    if (!changes || changeIndex >= changes.length) return;

    const change = changes[changeIndex];
    console.log(`[EDIT] Reverting single change: ${change.column || 'DELETE'} in row ${change.rowIndex}`);
    
    // Revert the data in the grid
    // We need to access the grid data. In grid.js we don't have direct access to 'lastResults' 
    // but we can try to find the grid instance or data.
    // Actually, grid.js manages the grid, so we should be able to update the DOM directly.
    
    // Find the table element
    const resultSetContainers = document.querySelectorAll('.result-set-container');
    if (resultSetContainers[resultSetIndex]) {
        const table = resultSetContainers[resultSetIndex].querySelector('.ag-grid-table');
        if (table) {
            const tbody = table.querySelector('.ag-grid-tbody');
            const row = tbody?.querySelector(`tr[data-row-index="${change.rowIndex}"]`);
            
            if (row) {
                if (change.type === 'DELETE') {
                    // Unmark deletion
                    row.classList.remove('row-marked-for-deletion');
                    row.querySelectorAll('td').forEach(cell => {
                        cell.style.backgroundColor = '';
                        cell.style.textDecoration = '';
                        cell.style.color = '';
                    });
                } else {
                    // Revert UPDATE
                    let colIndex = change.colIndex;
                    
                    // Fallback to metadata lookup if colIndex not stored
                    if (colIndex === undefined) {
                        const metadata = resultSetMetadata[resultSetIndex];
                        if (metadata && metadata.columns) {
                            colIndex = metadata.columns.findIndex(c => c.name === change.column);
                        }
                    }
                    
                    if (colIndex !== undefined && colIndex >= 0) {
                        // +1 for row number column
                        const cell = row.children[colIndex + 1];
                        if (cell) {
                            cell.textContent = change.originalValue === null ? 'NULL' : String(change.originalValue);
                            if (change.originalValue === null) {
                                cell.classList.add('null-value');
                            } else {
                                cell.classList.remove('null-value');
                            }
                            cell.classList.remove('cell-modified');
                            cell.style.padding = '0 8px'; // Restore padding
                        }
                    }
                }
            }
        }
    }

    // Remove the change from pending list
    changes.splice(changeIndex, 1);
    if (changes.length === 0) {
        pendingChanges.delete(resultSetIndex);
    }

    // Update UI
    updatePendingChangesCount();
    renderPendingChanges();
}

/**
 * Revert all pending changes
 */
function revertAllChanges() {
    if (pendingChanges.size === 0) {
        return;
    }

    const totalChanges = Array.from(pendingChanges.values()).reduce((sum, changes) => sum + changes.length, 0);
    
    // Use vscode modal instead of confirm (which is blocked in sandboxed webview)
    vscode.postMessage({
        type: 'confirmAction',
        message: `Revert all ${totalChanges} pending changes?`,
        action: 'revertAll'
    });
}

function executeRevertAll() {
    console.log('[EDIT] Executing revert all changes');
    
    // Store changes to revert before clearing
    const changesToRevert = new Map(pendingChanges);
    
    // Clear pending changes first
    pendingChanges.clear();
    
    // Revert data changes and refresh table displays
    changesToRevert.forEach((changes, resultSetIndex) => {
        changes.forEach(change => {
            // Revert logic similar to revertChange but for all
            // We can reuse the logic if we iterate
            // But we need to be careful about indices if we were splicing.
            // Here we are clearing the map so we can just process the copy.
            
             const resultSetContainers = document.querySelectorAll('.result-set-container');
            if (resultSetContainers[resultSetIndex]) {
                const table = resultSetContainers[resultSetIndex].querySelector('.ag-grid-table');
                if (table) {
                    const tbody = table.querySelector('.ag-grid-tbody');
                    const row = tbody?.querySelector(`tr[data-row-index="${change.rowIndex}"]`);
                    
                    if (row) {
                        if (change.type === 'DELETE') {
                            row.classList.remove('row-marked-for-deletion');
                            row.querySelectorAll('td').forEach(cell => {
                                cell.style.backgroundColor = '';
                                cell.style.textDecoration = '';
                                cell.style.color = '';
                            });
                        } else {
                            let colIndex = change.colIndex;
                            
                            if (colIndex === undefined) {
                                const metadata = resultSetMetadata[resultSetIndex];
                                if (metadata && metadata.columns) {
                                    colIndex = metadata.columns.findIndex(c => c.name === change.column);
                                }
                            }
                            
                            if (colIndex !== undefined && colIndex >= 0) {
                                const cell = row.children[colIndex + 1];
                                if (cell) {
                                    cell.textContent = change.originalValue === null ? 'NULL' : String(change.originalValue);
                                    if (change.originalValue === null) {
                                        cell.classList.add('null-value');
                                    } else {
                                        cell.classList.remove('null-value');
                                    }
                                    cell.classList.remove('cell-modified');
                                }
                            }
                        }
                    }
                }
            }
        });
    });
    
    // Update UI
    updatePendingChangesCount();
    
    // Switch to results tab if currently on pending changes
    if (currentTab === 'pendingChanges') {
        const resultsTab = document.querySelector('.results-tab[data-tab="results"]');
        if (resultsTab) resultsTab.click();
    }
}

function updateQuickSaveButton() {
    const quickSaveButton = document.getElementById('quickSaveButton');
    const tooltip = document.getElementById('quickSaveTooltip');
    
    if (!quickSaveButton) return;
    
    const totalChanges = Array.from(pendingChanges.values()).reduce((sum, changes) => sum + changes.length, 0);
    
    if (totalChanges > 0) {
        quickSaveButton.style.display = 'inline-flex';
        
        if (tooltip) {
            // Generate preview text
            if (totalChanges <= 5) {
                tooltip.textContent = `Save ${totalChanges} pending change${totalChanges !== 1 ? 's' : ''}`;
            } else {
                tooltip.textContent = `Save ${totalChanges} pending changes`;
            }
            
            // Try to generate SQL preview for tooltip
            try {
                const updateStatements = [];
                pendingChanges.forEach((changes, resultSetIndex) => {
                    const metadata = resultSetMetadata[resultSetIndex];
                    changes.forEach(change => {
                        if (change.type !== 'DELETE') {
                             // Prepare change object for generateUpdateStatement
                            let colMetadata = null;
                            if (metadata && metadata.columns) {
                                colMetadata = metadata.columns.find(c => c.name === change.column);
                            }
                            
                            const changeForSql = {
                                ...change,
                                columnName: change.column,
                                sourceColumn: change.column,
                                sourceTable: colMetadata ? colMetadata.tableName : null,
                                sourceSchema: colMetadata ? colMetadata.schemaName : null,
                                primaryKeyValues: change.pk
                            };
                            
                            try {
                                updateStatements.push(generateUpdateStatement(changeForSql, metadata));
                            } catch (e) {
                                // Ignore errors for tooltip
                            }
                        }
                    });
                });
                
                if (updateStatements.length > 0) {
                    const preview = updateStatements.slice(0, 3).join('\n');
                    const more = updateStatements.length > 3 ? `\n... and ${updateStatements.length - 3} more` : '';
                    tooltip.textContent += `\n\n${preview}${more}`;
                }
            } catch (e) {
                // Ignore
            }
        }
    } else {
        quickSaveButton.style.display = 'none';
    }
}

function previewUpdateStatements() {
    console.log('[PREVIEW] previewUpdateStatements called');
    if (pendingChanges.size === 0) {
        console.log('[PREVIEW] No pending changes');
        return;
    }

    try {
        const updateStatements = [];
        
        pendingChanges.forEach((changes, resultSetIndex) => {
            const metadata = resultSetMetadata[resultSetIndex];
            console.log(`[PREVIEW] Processing result set ${resultSetIndex}, changes:`, changes.length);
            
            changes.forEach(change => {
                 // Prepare change object for generateUpdateStatement
                let colMetadata = null;
                if (metadata && metadata.columns) {
                    colMetadata = metadata.columns.find(c => c.name === change.column);
                }
                
                const changeForSql = {
                    ...change,
                    columnName: change.column,
                    sourceColumn: change.column,
                    sourceTable: colMetadata ? colMetadata.tableName : null,
                    sourceSchema: colMetadata ? colMetadata.schemaName : null,
                    primaryKeyValues: change.pk
                };
                
                try {
                    const sql = generateUpdateStatement(changeForSql, metadata);
                    updateStatements.push(sql);
                } catch (error) {
                    console.error('[PREVIEW] Error generating SQL:', error);
                    updateStatements.push(`-- Error generating SQL for ${change.column}: ${error.message}`);
                }
            });
        });
        
        console.log('[PREVIEW] Generated statements:', updateStatements.length);
        
        // Show in a modal or new document
        // Since we can't easily create a modal, let's send it to the extension to open in a new editor
        vscode.postMessage({
            type: 'openInNewEditor',
            content: updateStatements.join('\n'),
            language: 'sql'
        });
        
    } catch (error) {
        console.error('Failed to generate preview:', error);
        vscode.postMessage({
            type: 'error',
            error: 'Failed to generate SQL preview: ' + error.message
        });
    }
}

function commitAllChanges() {
    if (pendingChanges.size === 0) return;
    
    const allChanges = [];
    const updateStatements = [];
    
    pendingChanges.forEach((changes, resultSetIndex) => {
        const metadata = resultSetMetadata[resultSetIndex];
        
        changes.forEach(change => {
            // Add resultSetIndex to each change
            allChanges.push({
                ...change,
                resultSetIndex
            });
            
            // Generate SQL
             // Prepare change object for generateUpdateStatement
            let colMetadata = null;
            if (metadata && metadata.columns) {
                // Try exact match first, then case-insensitive
                colMetadata = metadata.columns.find(c => c.name === change.column) || 
                              metadata.columns.find(c => c.name.toLowerCase() === change.column.toLowerCase());
            }
            
            // Fallback to result set metadata if column metadata doesn't have table info
            let tableNameVal = colMetadata && colMetadata.tableName ? colMetadata.tableName : (metadata ? metadata.sourceTable : null);
            let schemaNameVal = colMetadata && colMetadata.schemaName ? colMetadata.schemaName : (metadata ? metadata.sourceSchema : 'dbo');

            const changeForSql = {
                ...change,
                columnName: change.column,
                sourceColumn: change.column,
                sourceTable: tableNameVal,
                sourceSchema: schemaNameVal,
                primaryKeyValues: change.pk
            };
            
            try {
                const sql = generateUpdateStatement(changeForSql, metadata);
                updateStatements.push(sql);
            } catch (error) {
                console.error('Error generating SQL for commit:', error);
            }
        });
    });
    
    if (allChanges.length === 0) return;
    
    vscode.postMessage({
        type: 'commitChanges',
        changes: allChanges,
        statements: updateStatements,
        originalQuery: originalQuery
    });
}

function getPrimaryKeyValues(row, metadata) {
    const pks = {};
    if (metadata && metadata.columns) {
        metadata.columns.forEach((col, index) => {
            if (col.isPrimaryKey) {
                // Check if row is an array (indexed by position) or object (indexed by name)
                if (Array.isArray(row)) {
                    pks[col.name] = row[index];
                } else {
                    pks[col.name] = row[col.name];
                }
            }
        });
    }
    return pks;
}

// Context menu functionality
let contextMenu = null;
let contextMenuData = null;
let rowContextMenu = null;
let columnHeaderContextMenu = null;

// Create context menu HTML for table cells
function createContextMenu(cellData) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.display = 'none';
    
    // Determine labels based on selection
    const hasMultipleSelections = globalSelection.selections && globalSelection.selections.length > 1;
    
    let cellLabel = 'Copy Cell';
    let rowLabel = 'Copy Row';
    let rowHeaderLabel = 'Copy Row with Headers';
    let columnLabel = 'Copy Column';
    
    if (hasMultipleSelections) {
        if (globalSelection.type === 'cell') {
            const selectionCount = globalSelection.selections.length;
            cellLabel = `Copy ${selectionCount} Cells`;
        } else if (globalSelection.type === 'row') {
            // Count unique row indices for proper row count
            const uniqueRowIndices = [...new Set(globalSelection.selections.map(sel => sel.rowIndex))];
            const rowCount = uniqueRowIndices.length;
            rowLabel = `Copy ${rowCount} Rows`;
            rowHeaderLabel = `Copy ${rowCount} Rows with Headers`;
        } else if (globalSelection.type === 'column') {
            // Count unique column indices for proper column count
            const uniqueColumnIndices = [...new Set(globalSelection.selections.map(sel => sel.columnIndex))];
            const columnCount = uniqueColumnIndices.length;
            columnLabel = `Copy ${columnCount} Columns`;
        }
    }
    
    menu.innerHTML = `
        <div class="context-menu-item" data-action="copy-cell">${cellLabel}</div>
        <div class="context-menu-item" data-action="copy-row">${rowLabel}</div>
        <div class="context-menu-item" data-action="copy-row-header">${rowHeaderLabel}</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="copy-column">${columnLabel}</div>
        <div class="context-menu-item" data-action="copy-table">Copy Table</div>
    `;
    document.body.appendChild(menu);
    
    // Prevent default context menu on the custom menu itself
    menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = item.dataset.action;
            handleContextMenuAction(action);
            hideContextMenu();
        });
    });
    
    return menu;
}

// Create context menu HTML for row number cells
function createRowContextMenu(metadata, resultSetIndex, rowIndex, tableId) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.display = 'none';
    
    // Determine labels based on selection
    let rowLabel = 'Copy Row';
    let rowHeaderLabel = 'Copy Row with Headers';
    let deleteLabel = 'Delete Row';
    
    if (globalSelection && globalSelection.selections && globalSelection.type === 'row') {
        // Count unique row indices for proper row count
        const uniqueRowIndices = [...new Set(globalSelection.selections.map(sel => sel.rowIndex))];
        const rowCount = uniqueRowIndices.length;
        
        if (rowCount > 1) {
            rowLabel = `Copy ${rowCount} Rows`;
            rowHeaderLabel = `Copy ${rowCount} Rows with Headers`;
            deleteLabel = `Delete ${rowCount} Rows`;
        }
    }
    
    // Check if delete should be available (single table only)
    const isSingleTable = metadata && !metadata.hasMultipleTables && metadata.isEditable;
    
    let menuHtml = `
        <div class="context-menu-item" data-action="copy-row">${rowLabel}</div>
        <div class="context-menu-item" data-action="copy-row-header">${rowHeaderLabel}</div>
    `;
    
    if (isSingleTable) {
        menuHtml += `
            <div class="context-menu-separator"></div>
            <div class="context-menu-item context-menu-item-delete" data-action="delete-row">${deleteLabel}</div>
        `;
    }

    // Check expansion state
    if (typeof getRowExpansionState === 'function' && rowIndex !== undefined && tableId) {
        const state = getRowExpansionState(tableId, rowIndex);
        
        if (state.hasExpanded) {
            menuHtml += `
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="collapse-row">Collapse Row</div>
            `;
        } else if (state.hasCollapsed) {
            menuHtml += `
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="expand-row">Expand Row</div>
            `;
        }
    }
    
    menu.innerHTML = menuHtml;
    menu.dataset.resultSetIndex = resultSetIndex;
    menu.dataset.metadata = JSON.stringify(metadata);
    document.body.appendChild(menu);
    
    // Prevent default context menu on the custom menu itself
    menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = item.dataset.action;
            handleContextMenuAction(action);
            hideRowContextMenu();
        });
    });
    
    return menu;
}

// Create context menu HTML for column headers
function createColumnHeaderContextMenu() {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.display = 'none';
    
    // Determine labels based on selection
    let columnLabel = 'Copy Column';
    let columnHeaderLabel = 'Copy Column with Header';
    let distinctLabel = 'Copy Distinct Values';
    
    if (globalSelection && globalSelection.selections && globalSelection.type === 'column') {
        // Count unique column indices for proper column count
        const uniqueColumnIndices = [...new Set(globalSelection.selections.map(sel => sel.columnIndex))];
        const columnCount = uniqueColumnIndices.length;
        
        if (columnCount > 1) {
            columnLabel = `Copy ${columnCount} Columns`;
            columnHeaderLabel = `Copy ${columnCount} Columns with Headers`;
        }
    }
    
    menu.innerHTML = `
        <div class="context-menu-item" data-action="copy-column">${columnLabel}</div>
        <div class="context-menu-item" data-action="copy-column-header">${columnHeaderLabel}</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="copy-column-distinct">${distinctLabel}</div>
    `;
    document.body.appendChild(menu);
    
    // Prevent default context menu on the custom menu itself
    menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = item.dataset.action;
            handleContextMenuAction(action);
            hideColumnHeaderContextMenu();
        });
    });
    
    return menu;
}

function showContextMenu(e, cellData) {
    e.preventDefault();
    
    // Remove existing menu to recreate with updated labels
    if (contextMenu) {
        contextMenu.remove();
    }
    
    contextMenu = createContextMenu(cellData);
    contextMenuData = cellData;
    
    // Position menu at cursor
    contextMenu.style.display = 'block';
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    
    // Adjust if menu goes off screen
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        contextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        contextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
    }
    contextMenuData = null;
}

function showRowContextMenu(e, cellData) {
    e.preventDefault();
    
    const { table, rowIndex, data, columnDefs } = cellData;
    
    // Check if right-clicked row is part of current selection
    const isRowSelected = globalSelection.type === 'row' && 
                         globalSelection.selections && 
                         globalSelection.selections.some(sel => sel.rowIndex === rowIndex);
    
    // If right-clicked on unselected row, clear selection and select only this row
    if (!isRowSelected) {
        clearAllSelections();
        
        // Select the right-clicked row
        globalSelection = {
            type: 'row',
            tableContainer: table.closest('.ag-grid-viewport').parentElement,
            selections: [{ rowIndex }],
            data: data,
            columnDefs: columnDefs,
            lastClickedIndex: rowIndex,
            resultSetIndex: cellData.resultSetIndex,
            metadata: cellData.metadata
        };
        
        // Apply highlighting
        const tbody = table.querySelector('.ag-grid-tbody');
        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            if (rowIndex < rows.length) {
                rows[rowIndex].classList.add('selected');
                rows[rowIndex].style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #04395e)';
            }
        }
    }
    
    // Remove existing menu to recreate with updated labels
    if (rowContextMenu) {
        rowContextMenu.remove();
    }
    
    rowContextMenu = createRowContextMenu(cellData.metadata, cellData.resultSetIndex, cellData.rowIndex, cellData.table.id);
    contextMenuData = cellData;
    
    // Position menu at cursor
    rowContextMenu.style.display = 'block';
    rowContextMenu.style.left = e.pageX + 'px';
    rowContextMenu.style.top = e.pageY + 'px';
    
    // Adjust if menu goes off screen
    const rect = rowContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        rowContextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        rowContextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideRowContextMenu() {
    if (rowContextMenu) {
        rowContextMenu.style.display = 'none';
    }
    contextMenuData = null;
}

function showColumnHeaderContextMenu(e, cellData) {
    e.preventDefault();
    
    // Remove existing menu to recreate with updated labels
    if (columnHeaderContextMenu) {
        columnHeaderContextMenu.remove();
    }
    
    columnHeaderContextMenu = createColumnHeaderContextMenu();
    contextMenuData = cellData;
    
    // Position menu at cursor
    columnHeaderContextMenu.style.display = 'block';
    columnHeaderContextMenu.style.left = e.pageX + 'px';
    columnHeaderContextMenu.style.top = e.pageY + 'px';
    
    // Adjust if menu goes off screen
    const rect = columnHeaderContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        columnHeaderContextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        columnHeaderContextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideColumnHeaderContextMenu() {
    if (columnHeaderContextMenu) {
        columnHeaderContextMenu.style.display = 'none';
    }
    contextMenuData = null;
}

function handleContextMenuAction(action) {
    if (!contextMenuData) return;
    
    const { table, rowIndex, columnIndex, columnDefs, data } = contextMenuData;
    let textToCopy = '';
    
    switch (action) {
        case 'collapse-row':
            if (typeof collapseRowRelations === 'function') {
                collapseRowRelations(table.id, rowIndex);
            }
            return;
            
        case 'expand-row':
            if (typeof expandRowRelations === 'function') {
                expandRowRelations(table.id, rowIndex);
            }
            return;

        case 'copy-cell':
            if (globalSelection && globalSelection.selections && globalSelection.selections.length > 1 && globalSelection.type === 'cell') {
                // Copy all selected cells (tab-separated on same row, newline for different rows)
                const cellsByRow = {};
                globalSelection.selections.forEach(sel => {
                    if (!cellsByRow[sel.rowIndex]) cellsByRow[sel.rowIndex] = [];
                    cellsByRow[sel.rowIndex].push({ col: sel.columnIndex, val: sel.cellValue });
                });
                
                textToCopy = Object.keys(cellsByRow).sort((a, b) => a - b).map(rowIdx => {
                    return cellsByRow[rowIdx].sort((a, b) => a.col - b.col).map(cell => {
                        return cell.val === null ? 'NULL' : String(cell.val);
                    }).join('\t');
                }).join('\n');
            } else {
                const cellValue = data[rowIndex][columnDefs[columnIndex].field];
                textToCopy = cellValue === null ? 'NULL' : String(cellValue);
            }
            break;
            
        case 'copy-row':
            if (globalSelection && globalSelection.selections && globalSelection.type === 'row') {
                // For rows, check if we have multiple distinct rows
                const uniqueRowIndices = [...new Set(globalSelection.selections.map(sel => sel.rowIndex))];
                
                if (uniqueRowIndices.length > 1) {
                    // Copy all selected rows (multiple distinct rows)
                    textToCopy = uniqueRowIndices.sort((a, b) => a - b).map(rowIndex => {
                        const row = data[rowIndex];
                        return columnDefs.map(col => {
                            const val = row[col.field];
                            return val === null ? 'NULL' : String(val);
                        }).join('\t');
                    }).join('\n');
                } else {
                    // Single row (even though selections array has multiple items for each column)
                    const row = data[uniqueRowIndices[0]];
                    textToCopy = columnDefs.map(col => {
                        const val = row[col.field];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                }
            } else {
                const row = data[rowIndex];
                textToCopy = columnDefs.map(col => {
                    const val = row[col.field];
                    return val === null ? 'NULL' : String(val);
                }).join('\t');
            }
            break;
            
        case 'copy-row-header':
            const headers = columnDefs.map(col => col.headerName).join('\t');
            if (globalSelection && globalSelection.selections && globalSelection.type === 'row') {
                // For rows, check if we have multiple distinct rows
                const uniqueRowIndices = [...new Set(globalSelection.selections.map(sel => sel.rowIndex))];
                
                if (uniqueRowIndices.length > 1) {
                    // Copy all selected rows with header (multiple distinct rows)
                    const rowsData = uniqueRowIndices.sort((a, b) => a - b).map(rowIndex => {
                        const row = data[rowIndex];
                        return columnDefs.map(col => {
                            const val = row[col.field];
                            return val === null ? 'NULL' : String(val);
                        }).join('\t');
                    }).join('\n');
                    textToCopy = headers + '\n' + rowsData;
                } else {
                    // Single row with header
                    const row = data[uniqueRowIndices[0]];
                    const rowData = columnDefs.map(col => {
                        const val = row[col.field];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                    textToCopy = headers + '\n' + rowData;
                }
            } else {
                const rowData = columnDefs.map(col => {
                    const val = data[rowIndex][col.field];
                    return val === null ? 'NULL' : String(val);
                }).join('\t');
                textToCopy = headers + '\n' + rowData;
            }
            break;
            
        case 'copy-column':
            if (globalSelection && globalSelection.selections && globalSelection.type === 'column') {
                // For columns, check if we have multiple distinct columns
                const uniqueColumnIndices = [...new Set(globalSelection.selections.map(sel => sel.columnIndex))];
                
                if (uniqueColumnIndices.length > 1) {
                    // Copy all selected columns (multiple distinct columns, tab-separated)
                    const columnValues = data.map(row => {
                        return uniqueColumnIndices.sort((a, b) => a - b).map(colIndex => {
                            const colField = columnDefs[colIndex].field;
                            const val = row[colField];
                            return val === null ? 'NULL' : String(val);
                        }).join('\t');
                    }).join('\n');
                    textToCopy = columnValues;
                } else {
                    // Single column (even though selections array has multiple items for each row)
                    const colField = columnDefs[uniqueColumnIndices[0]].field;
                    textToCopy = data.map(row => {
                        const val = row[colField];
                        return val === null ? 'NULL' : String(val);
                    }).join('\n');
                }
            } else {
                const colField = columnDefs[columnIndex].field;
                textToCopy = data.map(row => {
                    const val = row[colField];
                    return val === null ? 'NULL' : String(val);
                }).join('\n');
            }
            break;
            
        case 'copy-column-header':
            if (hasMultipleSelections && globalSelection.type === 'column') {
                // Copy all selected columns with headers
                const colHeaders = globalSelection.selections.map(sel => {
                    return columnDefs[sel.columnIndex].headerName;
                }).join('\t');
                const columnValues = data.map(row => {
                    return globalSelection.selections.map(sel => {
                        const colField = columnDefs[sel.columnIndex].field;
                        const val = row[colField];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                }).join('\n');
                textToCopy = colHeaders + '\n' + columnValues;
            } else {
                const colFieldWithHeader = columnDefs[columnIndex].field;
                const colHeaderName = columnDefs[columnIndex].headerName;
                const columnValues = data.map(row => {
                    const val = row[colFieldWithHeader];
                    return val === null ? 'NULL' : String(val);
                }).join('\n');
                textToCopy = colHeaderName + '\n' + columnValues;
            }
            break;
            
        case 'copy-column-distinct':
            const colFieldDistinct = columnDefs[columnIndex].field;
            const distinctValues = [...new Set(data.map(row => {
                const val = row[colFieldDistinct];
                return val === null ? 'NULL' : String(val);
            }))].sort().join('\n');
            textToCopy = distinctValues;
            break;
            
        case 'copy-table':
            const tableHeaders = columnDefs.map(col => col.headerName).join('\t');
            const tableRows = data.map(row => {
                return columnDefs.map(col => {
                    const val = row[col.field];
                    return val === null ? 'NULL' : String(val);
                }).join('\t');
            }).join('\n');
            textToCopy = tableHeaders + '\n' + tableRows;
            break;
            
        case 'delete-row':
            // Get metadata and resultSetIndex from context menu
            const menu = document.querySelector('.context-menu');
            if (!menu) return;
            
            const resultSetIndex = parseInt(menu.dataset.resultSetIndex);
            const metadata = JSON.parse(menu.dataset.metadata);
            
            if (hasMultipleSelections && globalSelection.type === 'row') {
                // Delete multiple selected rows
                globalSelection.selections.forEach(sel => {
                    const row = data[sel.rowIndex];
                    recordRowDeletion(resultSetIndex, sel.rowIndex, row, metadata);
                    // Mark row for deletion visually
                    markRowForDeletion(table, sel.rowIndex);
                });
            } else {
                // Delete single row
                const row = data[rowIndex];
                recordRowDeletion(resultSetIndex, rowIndex, row, metadata);
                // Mark row for deletion visually
                markRowForDeletion(table, rowIndex);
            }
            return; // Don't copy to clipboard for delete action
    }
    
    // Copy to clipboard (skip for delete action)
    if (action !== 'delete-row') {
        navigator.clipboard.writeText(textToCopy).then(() => {
            console.log('[CONTEXT-MENU] Copied to clipboard:', action);
        }).catch(err => {
            console.error('[CONTEXT-MENU] Failed to copy:', err);
        });
    }
}

// Setup global keyboard handlers for copy functionality
function setupGlobalKeyboardHandlers() {
    document.addEventListener('keydown', (e) => {
        // Handle CTRL+C (or CMD+C on Mac)
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            // Check if cursor is in Monaco editor
            if (isMonacoEditorFocused()) {
                // Let Monaco handle the copy operation
                console.log('[KEYBOARD] CTRL+C ignored - Monaco editor has focus');
                return;
            }
            
            // Check if we have any table selection
            if (globalSelection && globalSelection.selections && globalSelection.selections.length > 0) {
                // Prevent default copy behavior
                e.preventDefault();
                e.stopPropagation();
                
                // Copy the selection
                copySelectionToClipboard();
                console.log('[KEYBOARD] CTRL+C handled - copied table selection');
            }
        }
    });
}

// Check if Monaco editor currently has focus
function isMonacoEditorFocused() {
    if (!editor) return false;
    
    // Check if the editor container or any of its elements has focus
    const editorElement = document.getElementById('editor');
    if (!editorElement) return false;
    
    // Check if the focused element is within the editor container
    const focusedElement = document.activeElement;
    if (!focusedElement) return false;
    
    // Monaco creates various internal elements, check if any of them is focused
    return editorElement.contains(focusedElement) || 
           focusedElement === editorElement ||
           focusedElement.classList.contains('monaco-editor') ||
           focusedElement.closest('.monaco-editor') !== null ||
           editor.hasTextFocus();
}

// Copy current table selection to clipboard using CTRL+C
function copySelectionToClipboard() {
    if (!globalSelection || !globalSelection.selections || globalSelection.selections.length === 0) {
        console.log('[COPY] No selection to copy');
        return;
    }
    
    let textToCopy = '';
    
    try {
        switch (globalSelection.type) {
            case 'cell':
                if (globalSelection.selections.length > 1) {
                    // Copy all selected cells (tab-separated on same row, newline for different rows)
                    const cellsByRow = {};
                    globalSelection.selections.forEach(sel => {
                        if (!cellsByRow[sel.rowIndex]) cellsByRow[sel.rowIndex] = [];
                        cellsByRow[sel.rowIndex].push({ col: sel.columnIndex, val: sel.cellValue });
                    });
                    
                    textToCopy = Object.keys(cellsByRow).sort((a, b) => a - b).map(rowIdx => {
                        return cellsByRow[rowIdx].sort((a, b) => a.col - b.col).map(cell => {
                            return cell.val === null ? 'NULL' : String(cell.val);
                        }).join('\t');
                    }).join('\n');
                } else {
                    // Single cell
                    const cellValue = globalSelection.selections[0].cellValue;
                    textToCopy = cellValue === null ? 'NULL' : String(cellValue);
                }
                break;
                
            case 'row':
                // For rows, check if we have multiple distinct rows
                const uniqueRowIndices = [...new Set(globalSelection.selections.map(sel => sel.rowIndex))];
                
                if (uniqueRowIndices.length > 1) {
                    // Copy all selected rows (multiple distinct rows)
                    textToCopy = uniqueRowIndices.sort((a, b) => a - b).map(rowIndex => {
                        const row = globalSelection.data[rowIndex];
                        return globalSelection.columnDefs.map(col => {
                            const val = row[col.field];
                            return val === null ? 'NULL' : String(val);
                        }).join('\t');
                    }).join('\n');
                } else {
                    // Single row (even though selections array has multiple items for each column)
                    const row = globalSelection.data[uniqueRowIndices[0]];
                    textToCopy = globalSelection.columnDefs.map(col => {
                        const val = row[col.field];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                }
                break;
                
            case 'column':
                // For columns, check if we have multiple distinct columns
                const uniqueColumnIndices = [...new Set(globalSelection.selections.map(sel => sel.columnIndex))];
                
                if (uniqueColumnIndices.length > 1) {
                    // Copy all selected columns (multiple distinct columns, tab-separated)
                    const columnValues = globalSelection.data.map(row => {
                        return uniqueColumnIndices.sort((a, b) => a - b).map(colIndex => {
                            const colField = globalSelection.columnDefs[colIndex].field;
                            const val = row[colField];
                            return val === null ? 'NULL' : String(val);
                        }).join('\t');
                    }).join('\n');
                    textToCopy = columnValues;
                } else {
                    // Single column (even though selections array has multiple items for each row)
                    const colField = globalSelection.columnDefs[uniqueColumnIndices[0]].field;
                    textToCopy = globalSelection.data.map(row => {
                        const val = row[colField];
                        return val === null ? 'NULL' : String(val);
                    }).join('\n');
                }
                break;
                
            default:
                console.log('[COPY] Unknown selection type:', globalSelection.type);
                return;
        }
        
        // Copy to clipboard
        navigator.clipboard.writeText(textToCopy).then(() => {
            console.log('[COPY] Successfully copied selection to clipboard:', globalSelection.type, globalSelection.selections.length, 'items');
        }).catch(err => {
            console.error('[COPY] Failed to copy to clipboard:', err);
        });
        
    } catch (error) {
        console.error('[COPY] Error while preparing text for clipboard:', error);
    }
}

// Global helper functions for selection management across all tables
function clearAllSelections() {
    // Find all result tables, including nested ones
    // .result-set-table .ag-grid-table finds main tables
    // .nested-table-container .ag-grid-table finds nested tables
    // We want to clear ALL tables.
    const allTables = document.querySelectorAll('.ag-grid-table');
    
    allTables.forEach(table => {
        // Clear column highlights
        // Use direct children selectors to avoid clearing nested tables if they are not part of the selection
        // But actually, we want to clear EVERYTHING, so querySelectorAll is fine here as it goes deep.
        // However, if we want to be precise, we can iterate.
        // The issue reported was about SELECTION, not clearing.
        // But let's make sure we don't accidentally clear styles we shouldn't.
        // For clearing, it's safer to clear everything to be sure.
        
        const allCells = table.querySelectorAll('th, td');
        allCells.forEach(cell => {
            if (!cell.classList.contains('ag-grid-row-number-cell') && 
                !cell.classList.contains('ag-grid-row-number-header')) {
                cell.style.backgroundColor = '';
                cell.classList.remove('selected-cell');
            }
        });
        
        // Clear row selections
        // Use direct children to avoid clearing nested tables' rows if we are iterating main tables
        // But wait, allTables includes nested tables too because they have .ag-grid-table class?
        // Let's check how allTables is selected: document.querySelectorAll('.result-set-table .ag-grid-table');
        // Nested tables are in .nested-table-container .ag-grid-table.
        // .result-set-table is the container for the main table.
        // So allTables might NOT include nested tables if they are not direct descendants of .result-set-table or if the selector is specific.
        // Actually, nested tables are inside .result-set-table (deeply).
        // So allTables includes nested tables.
        
        const allRows = table.querySelectorAll('tbody tr');
        allRows.forEach(row => {
            row.classList.remove('selected');
            row.style.backgroundColor = '';
        });
        
        // Reset row number cells
        const rowNumCells = table.querySelectorAll('.ag-grid-row-number-cell');
        rowNumCells.forEach(cell => {
            cell.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
        });
    });
    
    // Clear aggregation stats
    updateAggregationStats();
}

function reapplySelection() {
    if (!globalSelection.type || !globalSelection.tableContainer || !globalSelection.selections.length) {
        return;
    }
    
    globalSelection.selections.forEach(sel => {
        if (globalSelection.type === 'column' && sel.columnIndex !== undefined) {
            applyColumnHighlightGlobal(globalSelection.tableContainer, sel.columnIndex);
        } else if (globalSelection.type === 'row' && sel.rowIndex !== undefined) {
            applyRowHighlightGlobal(globalSelection.tableContainer, sel.rowIndex);
        } else if (globalSelection.type === 'cell' && sel.rowIndex !== undefined && sel.columnIndex !== undefined) {
            applyCellHighlightGlobal(globalSelection.tableContainer, sel.rowIndex, sel.columnIndex);
        }
    });
}

function applyColumnHighlightGlobal(containerEl, colIndex) {
    const table = containerEl.querySelector('.ag-grid-table');
    if (!table) return;
    
    // Highlight the selected column (colIndex + 2 because row number is column 1)
    // Use direct children selectors to avoid selecting cells in nested tables
    // Note: :scope is not supported in all contexts in querySelectorAll in some browsers/environments, 
    // but in VS Code webview (Chromium) it should be fine.
    // Alternatively, we can iterate rows and select children.
    
    // Using :scope > ...
    try {
        const columnCells = table.querySelectorAll(`:scope > thead > tr > th:nth-child(${colIndex + 2}), :scope > tbody > tr > td:nth-child(${colIndex + 2})`);
        columnCells.forEach(cell => {
            cell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
        });
    } catch (e) {
        // Fallback if :scope is not supported (unlikely in VS Code)
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
            // Check if row is direct child of thead or tbody of THIS table
            if (row.parentElement.parentElement === table) {
                const cell = row.children[colIndex + 1]; // +1 because row number is 0-th index in children collection? No, row number is 1st child.
                // nth-child is 1-based. children array is 0-based.
                // colIndex + 2 in nth-child means index + 1 in children array.
                if (cell) {
                    cell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
                }
            }
        });
    }
}

// Select all columns when clicking on row number header "#"
function selectAllColumns(colDefs, containerEl, data) {
    console.log('[SELECTION] Selecting all columns');
    
    // Clear all existing selections
    clearAllSelections();
    
    // Create selection for all columns
    const allColumnSelections = [];
    for (let colIndex = 0; colIndex < colDefs.length; colIndex++) {
        // Add all cells from this column
        for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
            allColumnSelections.push({
                rowIndex: rowIndex,
                columnIndex: colIndex,
                cellValue: data[rowIndex][colDefs[colIndex].field]
            });
        }
        
        // Apply highlighting for this column
        applyColumnHighlightGlobal(containerEl, colIndex);
    }
    
    // Set global selection state for all columns
    globalSelection = {
        type: 'column',
        tableContainer: containerEl,
        selections: allColumnSelections,
        data: data,
        columnDefs: colDefs,
        lastClickedIndex: null // No specific last clicked since we selected all
    };
    
    // Update aggregation stats
    updateAggregationStats();
    
    console.log('[SELECTION] Selected all', colDefs.length, 'columns with', allColumnSelections.length, 'total cells');
}

// Show export menu when clicking on export header
function showExportMenu(headerEl, colDefs, data, containerEl, sortCfg, filters) {
    console.log('[EXPORT] Showing export menu');
    
    // Remove any existing export menu
    const existingMenu = document.querySelector('.export-dropdown-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    // Create dropdown menu
    const menu = document.createElement('div');
    menu.className = 'export-dropdown-menu';
    menu.innerHTML = `
        <div class="export-menu-item" data-action="autofit">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M7 8h10" />
                <path d="M7 12h10" />
                <path d="M7 16h10" />
            </svg>
            Auto-fit all columns
        </div>
        <div style="height: 1px; background-color: var(--vscode-menu-separatorBackground); margin: 4px 0;"></div>
        <div class="export-menu-item" data-action="copy">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>
            Copy to clipboard
        </div>
        <div class="export-menu-item" data-action="json">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14,2 14,8 20,8"/>
                <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/>
                <path d="M14 12a1 1 0 0 1 1 1v1a1 1 0 0 0 1 1 1 1 0 0 0-1 1v1a1 1 0 0 1-1 1"/>
            </svg>
            Export to JSON
        </div>
        <div class="export-menu-item" data-action="csv">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                <path d="M7 16.5a1.5 1.5 0 0 0 -3 0v3a1.5 1.5 0 0 0 3 0" />
                <path d="M10 20.25c0 .414 .336 .75 .75 .75h1.25a1 1 0 0 0 1 -1v-1a1 1 0 0 0 -1 -1h-1a1 1 0 0 1 -1 -1v-1a1 1 0 0 1 1 -1h1.25a.75 .75 0 0 1 .75 .75" />
                <path d="M16 15l2 6l2 -6" />
            </svg>
            Export to CSV
        </div>
        <div class="export-menu-item" data-action="excel">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                <path d="M4 15l4 6" />
                <path d="M4 21l4 -6" />
                <path d="M17 20.25c0 .414 .336 .75 .75 .75h1.25a1 1 0 0 0 1 -1v-1a1 1 0 0 0 -1 -1h-1a1 1 0 0 1 -1 -1v-1a1 1 0 0 1 1 -1h1.25a.75 .75 0 0 1 .75 .75" />
                <path d="M11 15v6h3" />
            </svg>
            Export to Excel
        </div>
        <div class="export-menu-item" data-action="markdown">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" />
                <path d="M7 15v-6l2 2l2 -2v6" />
                <path d="M14 13l2 2l2 -2m-2 2v-6" />
            </svg>
            Export to Markdown
        </div>
        <div class="export-menu-item" data-action="xml">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                <path d="M4 15l4 6" />
                <path d="M4 21l4 -6" />
                <path d="M19 15v6h3" />
                <path d="M11 21v-6l2.5 3l2.5 -3v6" />
            </svg>
            Export to XML
        </div>
        <div class="export-menu-item" data-action="html">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                <path d="M2 21v-6" />
                <path d="M5 15v6" />
                <path d="M2 18h3" />
                <path d="M20 15v6h2" />
                <path d="M13 21v-6l2 3l2 -3v6" />
                <path d="M7.5 15h3" />
                <path d="M9 15v6" />
            </svg>
            Export to HTML
        </div>
    `;
    
    // Position the menu
    const rect = headerEl.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '2000';
    
    // Add to document
    document.body.appendChild(menu);
    
    // Add event listeners to menu items
    menu.querySelectorAll('.export-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = e.currentTarget.getAttribute('data-action');
            if (action === 'autofit') {
                autoFitAllColumns(colDefs, sortCfg, filters, containerEl, data);
            } else {
                handleExport(action, colDefs, data);
            }
            menu.remove();
        });
    });
    
    // Close menu when clicking outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target) && !headerEl.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    
    // Add a small delay to prevent immediate closure
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 100);
}

// Auto-fit single column (global function)
function autoFitSingleColumn(colIndex, colDefs, containerEl, data) {
    const col = colDefs[colIndex];
    if (!col) return;
    
    console.log(`[AUTO-FIT] Auto-fitting column "${col.headerName}" (index: ${colIndex})`);
    
    function calculateOptimalColumnWidthGlobal(columnName, columnData, type) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = '13px var(--vscode-font-family, "Segoe UI", sans-serif)';
        
        const headerWidth = context.measureText(columnName).width;
        let maxContentWidth = 0;
        
        const sampleSize = Math.min(100, columnData.length);
        const step = Math.max(1, Math.floor(columnData.length / sampleSize));
        
        for (let i = 0; i < columnData.length; i += step) {
            const value = columnData[i];
            let displayValue = '';
            
            if (value === null || value === undefined) {
                displayValue = 'NULL';
            } else if (type === 'boolean') {
                displayValue = value ? '✓' : '✗';
            } else if (type === 'number') {
                displayValue = typeof value === 'number' ? value.toLocaleString() : String(value);
            } else {
                displayValue = String(value);
            }
            
            const contentWidth = context.measureText(displayValue).width;
            if (contentWidth > maxContentWidth) {
                maxContentWidth = contentWidth;
            }
        }
        
        const padding = 32;
        const iconSpace = 80;
        const optimalWidth = Math.max(headerWidth + iconSpace, maxContentWidth + padding);
        const minWidth = 80;
        const maxWidth = 400;
        
        return Math.round(Math.min(Math.max(optimalWidth, minWidth), maxWidth));
    }
    
    // Extract column data and calculate new width
    const columnData = data.map(row => row[col.field]);
    const newWidth = calculateOptimalColumnWidthGlobal(col.headerName, columnData, col.type);
    
    // Update column definition
    col.width = newWidth;
    
    // Update header
    const th = containerEl.querySelector(`th[data-field="${col.field}"]`);
    if (th) {
        th.style.width = newWidth + 'px';
        th.style.minWidth = newWidth + 'px';
        th.style.maxWidth = newWidth + 'px';
    }
    
    // Update all cells in this column (+2 because row number is first column)
    const cells = containerEl.querySelectorAll(`td:nth-child(${colIndex + 2})`);
    cells.forEach(cell => {
        cell.style.width = newWidth + 'px';
        cell.style.minWidth = newWidth + 'px';
        cell.style.maxWidth = newWidth + 'px';
    });
    
    // Update total table width
    const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
    const table = containerEl.querySelector('.ag-grid-table');
    if (table) {
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
    }
    
    console.log(`[AUTO-FIT] Column "${col.headerName}" resized to ${newWidth}px`);
}

// Auto-fit all columns (global function for use outside initAgGridTable)
function autoFitAllColumns(colDefs, sortCfg, filters, containerEl, data) {
    console.log('[AUTO-FIT] Auto-fitting all columns (global)');
    
    // We need to find and use the calculateOptimalColumnWidth function from the table context
    // For now, we'll use a simplified version that recreates the logic
    
    function calculateOptimalColumnWidthGlobal(columnName, columnData, type) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = '13px var(--vscode-font-family, "Segoe UI", sans-serif)';
        
        const headerWidth = context.measureText(columnName).width;
        let maxContentWidth = 0;
        
        const sampleSize = Math.min(100, columnData.length);
        const step = Math.max(1, Math.floor(columnData.length / sampleSize));
        
        for (let i = 0; i < columnData.length; i += step) {
            const value = columnData[i];
            let displayValue = '';
            
            if (value === null || value === undefined) {
                displayValue = 'NULL';
            } else if (type === 'boolean') {
                displayValue = value ? '✓' : '✗';
            } else if (type === 'number') {
                displayValue = typeof value === 'number' ? value.toLocaleString() : String(value);
            } else {
                displayValue = String(value);
            }
            
            const contentWidth = context.measureText(displayValue).width;
            if (contentWidth > maxContentWidth) {
                maxContentWidth = contentWidth;
            }
        }
        
        const padding = 32;
        const iconSpace = 80;
        const optimalWidth = Math.max(headerWidth + iconSpace, maxContentWidth + padding);
        const minWidth = 80;
        const maxWidth = 400;
        
        return Math.round(Math.min(Math.max(optimalWidth, minWidth), maxWidth));
    }
    
    // Calculate new widths for all columns
    colDefs.forEach((col, index) => {
        const columnData = data.map(row => row[col.field]);
        const newWidth = calculateOptimalColumnWidthGlobal(col.headerName, columnData, col.type);
        col.width = newWidth;
    });
    
    // Update all header widths
    colDefs.forEach((col, index) => {
        const th = containerEl.querySelector(`th[data-field="${col.field}"]`);
        if (th) {
            th.style.width = col.width + 'px';
            th.style.minWidth = col.width + 'px';
            th.style.maxWidth = col.width + 'px';
        }
        
        // Update all cells in this column (+2 because row number is first column)
        const cells = containerEl.querySelectorAll(`td:nth-child(${index + 2})`);
        cells.forEach(cell => {
            cell.style.width = col.width + 'px';
            cell.style.minWidth = col.width + 'px';
            cell.style.maxWidth = col.width + 'px';
        });
    });
    
    // Update total table width
    const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
    const table = containerEl.querySelector('.ag-grid-table');
    if (table) {
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
    }
    
    console.log('[AUTO-FIT] All columns auto-fitted (global)');
}

// Handle export actions
function handleExport(action, colDefs, data) {
    console.log('[EXPORT] Handling export action:', action);
    
    try {
        switch (action) {
            case 'copy':
                copyDataToClipboard(colDefs, data);
                break;
            case 'json':
                exportToJson(colDefs, data);
                break;
            case 'csv':
                exportToCsv(colDefs, data);
                break;
            case 'excel':
                exportToExcel(colDefs, data);
                break;
            case 'markdown':
                exportToMarkdown(colDefs, data);
                break;
            case 'xml':
                exportToXml(colDefs, data);
                break;
            case 'html':
                exportToHtml(colDefs, data);
                break;
            default:
                console.warn('[EXPORT] Unknown export action:', action);
        }
    } catch (error) {
        console.error('[EXPORT] Error during export:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Extension will handle showing error messages via saveFile response
        console.error(`[EXPORT] ${action} export failed: ${errorMessage}`);
    }
}

// Copy data to clipboard as tab-separated values
function copyDataToClipboard(colDefs, data) {
    const headers = colDefs.map(col => col.headerName || col.field).join('\t');
    const rows = data.map(row => 
        colDefs.map(col => {
            const value = row[col.field];
            return value === null || value === undefined ? '' : String(value);
        }).join('\t')
    );
    
    const clipboardData = [headers, ...rows].join('\n');
    
    navigator.clipboard.writeText(clipboardData).then(() => {
        console.log('[EXPORT] Data copied to clipboard');
        // Show info message for clipboard copy (this works in webview)
        const statusLabel = document.getElementById('statusLabel');
        if (statusLabel) {
            const originalText = statusLabel.textContent;
            statusLabel.textContent = `Copied ${data.length} rows to clipboard`;
            setTimeout(() => {
                statusLabel.textContent = originalText;
            }, 3000);
        }
    }).catch(error => {
        console.error('[EXPORT] Failed to copy to clipboard:', error);
        const statusLabel = document.getElementById('statusLabel');
        if (statusLabel) {
            const originalText = statusLabel.textContent;
            statusLabel.textContent = 'Failed to copy to clipboard';
            setTimeout(() => {
                statusLabel.textContent = originalText;
            }, 3000);
        }
    });
}

// Export data as JSON
function exportToJson(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to JSON format`);
    
    const jsonData = data.map(row => {
        const obj = {};
        colDefs.forEach(col => {
            obj[col.headerName || col.field] = row[col.field];
        });
        return obj;
    });
    
    const jsonString = JSON.stringify(jsonData, null, 2);
    
    vscode.postMessage({
        type: 'saveFile',
        content: jsonString,
        defaultFileName: 'results.json',
        fileType: 'JSON'
    });
}

// Export data as CSV
function exportToCsv(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to CSV format`);
    
    const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };
    
    const headers = colDefs.map(col => escapeCSV(col.headerName || col.field)).join(',');
    const rows = data.map(row => 
        colDefs.map(col => escapeCSV(row[col.field])).join(',')
    );
    
    const csvData = [headers, ...rows].join('\n');
    
    vscode.postMessage({
        type: 'saveFile',
        content: csvData,
        defaultFileName: 'results.csv',
        fileType: 'CSV'
    });
}

// Export data as Excel (TSV format for Excel compatibility)
function exportToExcel(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to Excel format (XLSX)`);
    
    try {
        // Check if SheetJS is available
        if (typeof XLSX === 'undefined') {
            // Fallback to CSV if SheetJS is not loaded
            console.warn('[EXPORT] SheetJS not available, falling back to CSV format');
            exportToExcelFallback(colDefs, data);
            return;
        }
        
        // Prepare data for SheetJS
        const wsData = [];
        
        // Add headers
        const headers = colDefs.map(col => col.headerName || col.field);
        wsData.push(headers);
        
        // Add data rows
        data.forEach(row => {
            const rowData = colDefs.map(col => {
                const value = row[col.field];
                if (value === null || value === undefined) return '';
                return value;
            });
            wsData.push(rowData);
        });
        
        // Create workbook and worksheet
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        
        // Auto-size columns
        const colWidths = [];
        for (let i = 0; i < headers.length; i++) {
            let maxWidth = headers[i].length;
            for (let j = 1; j < wsData.length; j++) {
                const cellValue = wsData[j][i];
                if (cellValue && cellValue.toString().length > maxWidth) {
                    maxWidth = cellValue.toString().length;
                }
            }
            colWidths.push({ wch: Math.min(maxWidth + 2, 50) }); // Max width 50 chars
        }
        ws['!cols'] = colWidths;
        
        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(wb, ws, 'Query Results');
        
        // Generate Excel file as base64
        const xlsxData = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
        
        vscode.postMessage({
            type: 'saveFile',
            content: xlsxData,
            defaultFileName: 'results.xlsx',
            fileType: 'Excel',
            encoding: 'base64'
        });
        
    } catch (error) {
        console.error('[EXPORT] Excel export failed:', error);
        // Fallback to CSV
        exportToExcelFallback(colDefs, data);
    }
}

// Fallback function for CSV export when XLSX library is not available
function exportToExcelFallback(colDefs, data) {
    console.log(`[EXPORT] Using CSV fallback for Excel export`);
    
    const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };
    
    const headers = colDefs.map(col => escapeCSV(col.headerName || col.field)).join(',');
    const rows = data.map(row => 
        colDefs.map(col => escapeCSV(row[col.field])).join(',')
    );
    
    const csvData = [headers, ...rows].join('\n');
    
    vscode.postMessage({
        type: 'saveFile',
        content: csvData,
        defaultFileName: 'results.csv',
        fileType: 'Excel'
    });
}

// Export data as Markdown table
function exportToMarkdown(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to Markdown format`);
    
    const headers = colDefs.map(col => col.headerName || col.field);
    const separator = headers.map(() => '---');
    
    const escapeMarkdown = (value) => {
        if (value === null || value === undefined) return '';
        return String(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    };
    
    const headerRow = '| ' + headers.join(' | ') + ' |';
    const separatorRow = '| ' + separator.join(' | ') + ' |';
    const dataRows = data.map(row => 
        '| ' + colDefs.map(col => escapeMarkdown(row[col.field])).join(' | ') + ' |'
    );
    
    const markdownData = [headerRow, separatorRow, ...dataRows].join('\n');
    
    vscode.postMessage({
        type: 'saveFile',
        content: markdownData,
        defaultFileName: 'results.md',
        fileType: 'Markdown'
    });
}

// Export data as XML
function exportToXml(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to XML format`);
    
    const escapeXml = (value) => {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };
    
    const sanitizeElementName = (name) => {
        // Replace invalid XML element name characters with underscores
        return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^[^a-zA-Z_]/, '_$&');
    };
    
    let xmlData = '<?xml version="1.0" encoding="UTF-8"?>\n<results>\n';
    
    data.forEach(row => {
        xmlData += '  <row>\n';
        colDefs.forEach(col => {
            const elementName = sanitizeElementName(col.headerName || col.field);
            const value = escapeXml(row[col.field]);
            xmlData += `    <${elementName}>${value}</${elementName}>\n`;
        });
        xmlData += '  </row>\n';
    });
    
    xmlData += '</results>';
    
    vscode.postMessage({
        type: 'saveFile',
        content: xmlData,
        defaultFileName: 'results.xml',
        fileType: 'XML'
    });
}

// Export data as HTML table
function exportToHtml(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to HTML format`);
    
    const escapeHtml = (value) => {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };
    
    let htmlData = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Results</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
            font-size: 24px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 12px 8px;
            text-align: left;
        }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #495057;
        }
        tr:nth-child(even) {
            background-color: #f8f9fa;
        }
        tr:hover {
            background-color: #e9ecef;
        }
        .stats {
            margin-top: 15px;
            color: #6c757d;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Query Results</h1>
        <table>
            <thead>
                <tr>
`;
    
    // Add table headers
    colDefs.forEach(col => {
        htmlData += `                    <th>${escapeHtml(col.headerName || col.field)}</th>\n`;
    });
    
    htmlData += `                </tr>
            </thead>
            <tbody>
`;
    
    // Add table rows
    data.forEach(row => {
        htmlData += `                <tr>\n`;
        colDefs.forEach(col => {
            const value = escapeHtml(row[col.field]);
            htmlData += `                    <td>${value}</td>\n`;
        });
        htmlData += `                </tr>\n`;
    });
    
    htmlData += `            </tbody>
        </table>
        <div class="stats">
            <strong>Total rows:</strong> ${data.length} | <strong>Columns:</strong> ${colDefs.length}
        </div>
    </div>
</body>
</html>`;
    
    vscode.postMessage({
        type: 'saveFile',
        content: htmlData,
        defaultFileName: 'results.html',
        fileType: 'HTML'
    });
}

function applyRowHighlightGlobal(containerEl, rowIndex) {
    const table = containerEl.querySelector('.ag-grid-table');
    if (!table) return;
    
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    // Find the row by data attribute
    const targetRow = tbody.querySelector(`tr[data-row-index="${rowIndex}"]`);
    if (targetRow) {
        targetRow.classList.add('selected');
        targetRow.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
        
        const rowNumCell = targetRow.querySelector('.ag-grid-row-number-cell');
        if (rowNumCell) {
            rowNumCell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
        }
    }
}

function applyCellHighlightGlobal(containerEl, rowIndex, colIndex) {
    const table = containerEl.querySelector('.ag-grid-table');
    if (!table) return;
    
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    // Find the row by data attribute
    const targetRow = tbody.querySelector(`tr[data-row-index="${rowIndex}"]`);
    if (targetRow) {
        // Find the cell (colIndex + 2 because row number is column 1, and nth-child is 1-indexed)
        const targetCell = targetRow.querySelector(`td:nth-child(${colIndex + 2})`);
        if (targetCell) {
            targetCell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
            targetCell.classList.add('selected-cell');
        }
    }
}

// Helper function to determine SQL data type category
function getDataTypeCategory(sqlType) {
    if (!sqlType) return 'unknown';
    
    const type = sqlType.toLowerCase();
    
    // Numeric types
    if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(type)) {
        return 'numeric';
    }
    
    // Boolean/bit type
    if (type === 'bit') {
        return 'boolean';
    }
    
    // Date/time types
    if (['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'].includes(type)) {
        return 'datetime';
    }
    
    // Text types
    if (['char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext'].includes(type)) {
        return 'text';
    }
    
    // Binary types
    if (['binary', 'varbinary', 'image'].includes(type)) {
        return 'binary';
    }
    
    // Default to text for unknown types
    return 'text';
}

// Calculate statistics for numeric values
function calculateNumericStats(values) {
    if (values.length === 0) return null;
    
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    return {
        sum: sum.toFixed(2),
        avg: avg.toFixed(2),
        min: min,
        max: max
    };
}

// Calculate statistics for text values
function calculateTextStats(values) {
    if (values.length === 0) return null;
    
    const distinctValues = new Set(values);
    const lengths = values.map(v => String(v).length);
    const minLength = Math.min(...lengths);
    const maxLength = Math.max(...lengths);
    
    return {
        distinct: distinctValues.size,
        minLength: minLength,
        maxLength: maxLength
    };
}

// Calculate statistics for boolean values
function calculateBooleanStats(values) {
    if (values.length === 0) return null;
    
    let trueCount = 0;
    let falseCount = 0;
    
    for (const val of values) {
        // Handle different boolean representations
        if (val === true || val === 1 || String(val).toLowerCase() === 'true') {
            trueCount++;
        } else if (val === false || val === 0 || String(val).toLowerCase() === 'false') {
            falseCount++;
        }
    }
    
    return {
        trueCount: trueCount,
        falseCount: falseCount
    };
}

// Calculate statistics for datetime values
function calculateDateTimeStats(values) {
    if (values.length === 0) return null;
    
    const dates = values.map(v => {
        if (v instanceof Date) return v;
        return new Date(v);
    }).filter(d => !isNaN(d.getTime()));
    
    if (dates.length === 0) return null;
    
    // Sort timestamps to find min, min2, and max
    const timestamps = dates.map(d => d.getTime()).sort((a, b) => a - b);
    const min = new Date(timestamps[0]);
    const max = new Date(timestamps[timestamps.length - 1]);
    
    // Check if min is the default date (0001-01-01)
    const defaultDateThreshold = new Date('0001-01-02').getTime(); // Anything before this is considered default
    const isMinDefault = timestamps[0] < defaultDateThreshold;
    
    let min2 = null;
    let rangeStart = min;
    
    if (isMinDefault && timestamps.length > 1) {
        // Find the second minimum that's not the default date
        for (let i = 1; i < timestamps.length; i++) {
            if (timestamps[i] >= defaultDateThreshold) {
                min2 = new Date(timestamps[i]);
                rangeStart = min2; // Use min2 for range calculation
                break;
            }
        }
    }
    
    const totalDays = Math.ceil((max - rangeStart) / (1000 * 60 * 60 * 24)); // days
    
    // Format range in a human-readable way
    let rangeText;
    if (totalDays >= 365) {
        const years = Math.floor(totalDays / 365);
        const remainingDays = totalDays % 365;
        rangeText = years === 1 
            ? `1 year ${remainingDays} days` 
            : `${years} years ${remainingDays} days`;
    } else {
        rangeText = `${totalDays} days`;
    }
    
    return {
        min: min.toISOString().slice(0, 19).replace('T', ' '),
        min2: min2 ? min2.toISOString().slice(0, 19).replace('T', ' ') : null,
        max: max.toISOString().slice(0, 19).replace('T', ' '),
        range: rangeText
    };
}

function updateAggregationStats() {
    const statsPanel = document.getElementById('aggregationStats');
    if (!statsPanel) return;
    
    // If no selection or no data, hide the panel
    if (!globalSelection || !globalSelection.selections || globalSelection.selections.length === 0) {
        statsPanel.style.display = 'none';
        return;
    }
    
    const selections = globalSelection.selections;
    const columnDefs = globalSelection.columnDefs;
    const data = globalSelection.data;
    const resultSetIndex = globalSelection.resultSetIndex !== undefined ? globalSelection.resultSetIndex : 0;
    
    // Collect values and analyze data types
    const valuesByColumn = new Map(); // Map<columnIndex, {values: [], sqlType: string}>
    let nullCount = 0;
    let totalCount = 0;
    
    for (const selection of selections) {
        totalCount++;
        const value = selection.cellValue;
        
        // Count nulls
        if (value === null || value === undefined) {
            nullCount++;
            continue;
        }
        
        // Group by column if we have column information
        if (selection.columnIndex !== undefined && columnDefs) {
            if (!valuesByColumn.has(selection.columnIndex)) {
                const colDef = columnDefs[selection.columnIndex];
                
                // Try to get SQL type from metadata
                let sqlType = 'unknown';
                
                // Get metadata from globalSelection (for nested tables) or global store
                let metadata = globalSelection.metadata;
                if (!metadata && resultSetMetadata && resultSetIndex >= 0 && resultSetIndex < resultSetMetadata.length) {
                    metadata = resultSetMetadata[resultSetIndex];
                }

                if (metadata) {
                    let colMetadata = null;

                    // Check if field is an index (numeric string) - Array Mode
                    if (/^\d+$/.test(colDef.field)) {
                        const index = parseInt(colDef.field, 10);
                        if (metadata.columns && index < metadata.columns.length) {
                            colMetadata = metadata.columns[index];
                        }
                    } 
                    
                    // Fallback to name lookup if not found by index (or if field is not an index) - Object Mode
                    if (!colMetadata && metadata.columns) {
                         colMetadata = metadata.columns.find(c => c.name === colDef.field);
                    }

                    if (colMetadata) {
                        sqlType = colMetadata.type;
                    }
                }
                
                valuesByColumn.set(selection.columnIndex, {
                    values: [],
                    sqlType: sqlType,
                    columnName: colDef.field
                });
            }
            valuesByColumn.get(selection.columnIndex).values.push(value);
        }
    }
    
    const nonNullCount = totalCount - nullCount;
    
    // Build statistics text
    let statsText = `Count: ${nonNullCount}`;
    
    if (nullCount > 0) {
        statsText += ` | NULL: ${nullCount}`;
    }
    
    // Determine if we're selecting a single column or multiple columns/mixed selection
    if (valuesByColumn.size === 1 && globalSelection.type === 'column') {
        // Single column selection - show type-specific statistics
        const [columnIndex, columnData] = Array.from(valuesByColumn.entries())[0];
        const values = columnData.values;
        const dataTypeCategory = getDataTypeCategory(columnData.sqlType);
        
        if (dataTypeCategory === 'numeric') {
            // Numeric statistics
            const numericValues = [];
            for (const val of values) {
                if (val !== '') {
                    const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
                    if (!isNaN(num)) {
                        numericValues.push(num);
                    }
                }
            }
            
            if (numericValues.length > 0) {
                const stats = calculateNumericStats(numericValues);
                statsText += ` | Avg: ${stats.avg} | Sum: ${stats.sum} | Min: ${stats.min} | Max: ${stats.max}`;
            }
            
        } else if (dataTypeCategory === 'text') {
            // Text statistics
            const stats = calculateTextStats(values);
            if (stats) {
                statsText += ` | Distinct: ${stats.distinct} | Min Length: ${stats.minLength} | Max Length: ${stats.maxLength}`;
            }
            
        } else if (dataTypeCategory === 'boolean') {
            // Boolean statistics
            const stats = calculateBooleanStats(values);
            if (stats) {
                statsText += ` | True: ${stats.trueCount} | False: ${stats.falseCount}`;
            }
            
        } else if (dataTypeCategory === 'datetime') {
            // DateTime statistics
            const stats = calculateDateTimeStats(values);
            if (stats) {
                statsText += ` | Min: ${stats.min}`;
                if (stats.min2) {
                    statsText += ` | Min2: ${stats.min2}`;
                }
                statsText += ` | Max: ${stats.max} | Range: ${stats.range}`;
            }
            
        } else {
            // Unknown type - show distinct count only
            const distinctValues = new Set(values);
            statsText += ` | Distinct: ${distinctValues.size}`;
        }
        
    } else {
        // Multiple columns or mixed selection - show general statistics
        // Calculate distinct count across all selected values
        const allValues = [];
        for (const [_, columnData] of valuesByColumn.entries()) {
            allValues.push(...columnData.values);
        }
        
        if (allValues.length > 0) {
            const distinctValues = new Set(allValues.map(v => String(v)));
            statsText += ` | Distinct: ${distinctValues.size}`;
        }
    }
    
    statsPanel.textContent = statsText;
    statsPanel.style.display = 'block';
}

// Hide context menu when clicking elsewhere
document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
        hideContextMenu();
    }
    if (rowContextMenu && !rowContextMenu.contains(e.target)) {
        hideRowContextMenu();
    }
    if (columnHeaderContextMenu && !columnHeaderContextMenu.contains(e.target)) {
        hideColumnHeaderContextMenu();
    }
});

// Hide context menu on scroll
document.addEventListener('scroll', () => {
    hideContextMenu();
    hideRowContextMenu();
    hideColumnHeaderContextMenu();
}, true);

// Query Plan Display Functions
function displayResults(resultSets, planXml, columnNames) {
    console.log('[SQL EDITOR] displayResults called with', resultSets.length, 'result set(s)');
    console.log('[SQL EDITOR] planXml present:', !!planXml, 'length:', planXml ? planXml.length : 0);
    const resultsContent = document.getElementById('resultsContent');
    console.log('[SQL EDITOR] resultsContent element:', resultsContent);

    if (!resultSets || resultSets.length === 0) {
        resultsContent.innerHTML = '<div class="no-results">No rows returned</div>';
        return;
    }

    // Clear previous content
    resultsContent.innerHTML = '';
    
    // Determine if we should use single-result-set mode (100% height)
    const isSingleResultSet = resultSets.length === 1 && !planXml;
    
    // Add appropriate class to resultsContent
    if (isSingleResultSet) {
        resultsContent.classList.add('single-result-set');
        resultsContent.classList.remove('multiple-result-sets');
    } else {
        resultsContent.classList.add('multiple-result-sets');
        resultsContent.classList.remove('single-result-set');
    }

    // Create a table for each result set
    resultSets.forEach((results, index) => {
        if (!results || results.length === 0) {
            // Even if empty, we might want to show headers if we have columnNames
            if (!columnNames || !columnNames[index] || columnNames[index].length === 0) {
                return;
            }
        }

        // Create container for this result set
        const resultSetContainer = document.createElement('div');
        resultSetContainer.className = 'result-set-container';
        if (isSingleResultSet) {
            resultSetContainer.classList.add('full-height');
        }

        // Create table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'result-set-table';
        if (isSingleResultSet) {
            tableContainer.classList.add('full-height');
        }
        
        // Initialize AG-Grid-like table for this result set
        console.log('[SQL EDITOR] Creating table for result set', index + 1, 'with', results.length, 'rows');
        const metadata = resultSetMetadata[index];
        const columns = columnNames ? columnNames[index] : null;
        initAgGridTable(results, tableContainer, isSingleResultSet, index, metadata, columns);
        
        resultSetContainer.appendChild(tableContainer);
        resultsContent.appendChild(resultSetContainer);
    });
    
    // Add execution plan as a separate result set if present
    if (planXml) {
        const planContainer = document.createElement('div');
        planContainer.className = 'result-set-container';
        planContainer.style.marginTop = '20px';
        
        const planTitle = document.createElement('h3');
        planTitle.textContent = 'Execution Plan (XML)';
        planTitle.style.marginBottom = '10px';
        planContainer.appendChild(planTitle);
        
        const planTableContainer = document.createElement('div');
        planTableContainer.className = 'result-set-table';
        
        // Create a single-cell table with the XML plan
        const planData = [{ 'Microsoft SQL Server 2005 XML Showplan': planXml }];
        initAgGridTable(planData, planTableContainer, false);
        
        planContainer.appendChild(planTableContainer);
        resultsContent.appendChild(planContainer);
    }
    
    // Check if the results content parent has overflow
    const resultsContainer = document.getElementById('resultsContainer');
    console.log('[SQL EDITOR] resultsContainer height:', resultsContainer?.offsetHeight);
    console.log('[SQL EDITOR] resultsContent height:', resultsContent?.offsetHeight, 'scrollHeight:', resultsContent?.scrollHeight);
}

// ===== FK/PK EXPANSION FUNCTIONS =====
// Moved to relationExpansion.js

// Export functions for global access
window.renderPendingChanges = renderPendingChanges;
window.updatePendingChangesCount = updatePendingChangesCount;
window.commitAllChanges = commitAllChanges;
window.previewUpdateStatements = previewUpdateStatements;
window.executeRevertAll = executeRevertAll;

