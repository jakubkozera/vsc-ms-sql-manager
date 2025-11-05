// Initialize VS Code API
const vscode = acquireVsCodeApi();
console.log('[Diagram] VS Code API initialized');

const tables = TABLES_DATA;
const relationships = RELATIONSHIPS_DATA;

// Diagram settings
let diagramSettings = {
    showDatatypes: true,
    showKeys: true,
    showReferences: true,
    lineColor: '#4fc3f7',
    arrowColor: '#4fc3f7',
    arrowHeadStyle: 'arrow',
    lineStyle: 'solid',
    lineWidth: 2,
    headWidth: 1,
    headerStyle: 'color',
    headerColor: '#264f78',
    textColor: '#cccccc',
    datatypeColor: '#cccccc'
};

console.log('Tables loaded:', tables);
console.log('Relationships loaded:', relationships);
console.log('Tables count:', tables ? tables.length : 0);

// Check if d3 is loaded
if (typeof d3 === 'undefined') {
    console.error('D3.js is not loaded!');
    document.body.innerHTML = '<div style="color: white; padding: 20px;">Error: D3.js library failed to load</div>';
}

// Check if dagre is loaded
if (typeof dagre === 'undefined') {
    console.error('Dagre.js is not loaded!');
    document.body.innerHTML = '<div style="color: white; padding: 20px;">Error: Dagre.js library failed to load</div>';
}

if (!tables || tables.length === 0) {
    console.warn('No tables to display');
    document.body.innerHTML = '<div style="color: white; padding: 20px;">No tables found in database</div>';
}

const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select('#diagram')
    .attr('width', width)
    .attr('height', height);

// Define arrowhead markers (will be updated based on settings)
const defs = svg.append('defs');

function updateArrowheadMarkers() {
    defs.selectAll('marker').remove();
    
    const markerColor = diagramSettings.arrowColor;
    const arrowStyle = diagramSettings.arrowHeadStyle;
    const headScale = diagramSettings.headWidth;
    
    if (arrowStyle === 'arrow') {
        // Open arrow - two lines forming >
        const baseSize = 8;
        const scaledSize = baseSize * headScale;
        const marker = defs.append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 9)
            .attr('refY', 5)
            .attr('orient', 'auto')
            .attr('markerWidth', scaledSize)
            .attr('markerHeight', scaledSize)
            .attr('markerUnits', 'userSpaceOnUse');
        
        marker.append('path')
            .attr('d', 'M 0,0 L 10,5 L 0,10')
            .attr('fill', 'none')
            .attr('stroke', markerColor)
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            .attr('vector-effect', 'non-scaling-stroke');
    } else if (arrowStyle === 'triangle') {
        const baseSize = 8;
        const scaledSize = baseSize * headScale;
        defs.append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '-0 -5 10 10')
            .attr('refX', 8)
            .attr('refY', 0)
            .attr('orient', 'auto')
            .attr('markerWidth', scaledSize)
            .attr('markerHeight', scaledSize)
            .append('path')
            .attr('d', 'M 0,-5 L 10,0 L 0,5')
            .attr('fill', markerColor);
    } else if (arrowStyle === 'circle') {
        const baseSize = 8;
        const scaledSize = baseSize * headScale;
        defs.append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 5)
            .attr('refY', 5)
            .attr('orient', 'auto')
            .attr('markerWidth', scaledSize)
            .attr('markerHeight', scaledSize)
            .append('circle')
            .attr('cx', 5)
            .attr('cy', 5)
            .attr('r', 4)
            .attr('fill', markerColor);
    } else if (arrowStyle === 'diamond') {
        const baseSize = 8;
        const scaledSize = baseSize * headScale;
        defs.append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 5)
            .attr('refY', 5)
            .attr('orient', 'auto')
            .attr('markerWidth', scaledSize)
            .attr('markerHeight', scaledSize)
            .append('path')
            .attr('d', 'M 5,0 L 10,5 L 5,10 L 0,5 Z')
            .attr('fill', markerColor);
    }
    // For 'none', we don't add any marker
}

updateArrowheadMarkers();

// Create container for zoom/pan
const container = svg.append('g');

// Zoom behavior
const zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
        container.attr('transform', event.transform);
    });

svg.call(zoom);

// Calculate table dimensions
const minTableWidth = 250;
const maxTableWidth = 500;
const headerHeight = 40;
const rowHeight = 25;

// Helper function to estimate text width (approximate)
function estimateTextWidth(text, fontSize = 12) {
    return text.length * fontSize * 0.6;
}

// Calculate table heights and widths dynamically
tables.forEach((table) => {
    table.height = headerHeight + table.columns.length * rowHeight;
    
    // Check if any column has PK or FK (now we use 1 icon for both cases)
    const hasAnyKey = table.columns.some(col => col.isPrimaryKey || col.isForeignKey);
    
    // Calculate icon space needed
    const iconSize = 16;
    let iconSpace = 10; // Base padding
    if (hasAnyKey) {
        iconSpace += iconSize + 2; // Space for 1 icon (even if both PK and FK)
    }
    
    // Calculate max content width needed
    const tableTitleWidth = estimateTextWidth(`${table.schema}.${table.name}`, 14);
    let maxContentWidth = tableTitleWidth;
    
    table.columns.forEach(col => {
        const columnNameWidth = estimateTextWidth(col.name, 12);
        const columnTypeWidth = estimateTextWidth(col.type, 12);
        const totalContentWidth = iconSpace + columnNameWidth + 20 + columnTypeWidth + 10; // 20 = gap, 10 = right padding
        maxContentWidth = Math.max(maxContentWidth, totalContentWidth);
    });
    
    // Set table width with constraints
    table.width = Math.max(minTableWidth, Math.min(maxTableWidth, maxContentWidth));
    table.iconSpace = iconSpace;
    table.hasAnyKey = hasAnyKey;
});

// Use Dagre for automatic layout
const g = new dagre.graphlib.Graph();
g.setGraph({
    rankdir: 'TB', // Top to Bottom
    nodesep: 80,   // Horizontal spacing between nodes
    ranksep: 100,  // Vertical spacing between ranks
    marginx: 50,
    marginy: 50
});
g.setDefaultEdgeLabel(() => ({}));

// Add nodes (tables) to graph
tables.forEach(table => {
    const tableKey = `${table.schema}.${table.name}`;
    g.setNode(tableKey, {
        label: tableKey,
        width: table.width,
        height: table.height
    });
});

// Add edges (relationships) to graph
relationships.forEach(rel => {
    g.setEdge(rel.from, rel.to);
});

// Run Dagre layout algorithm
dagre.layout(g);

// Apply calculated positions to tables
tables.forEach(table => {
    const tableKey = `${table.schema}.${table.name}`;
    const node = g.node(tableKey);
    if (node) {
        // Dagre gives us the center position, convert to top-left
        table.x = node.x - table.width / 2;
        table.y = node.y - table.height / 2;
    }
});

// Create table map for relationship drawing
const tableMap = new Map();
tables.forEach(table => {
    tableMap.set(`${table.schema}.${table.name}`, table);
    table.visible = true; // All tables visible by default
    
    // Mark columns that are part of FK relationships
    table.columns.forEach(col => {
        col.isForeignKey = false;
        col.isReferenced = false;
    });
});

// Mark FK and referenced columns
relationships.forEach(rel => {
    const fromTable = tableMap.get(rel.from);
    const toTable = tableMap.get(rel.to);
    
    if (fromTable) {
        const fromCol = fromTable.columns.find(c => c.name === rel.fromColumn);
        if (fromCol) fromCol.isForeignKey = true;
    }
    
    if (toTable) {
        const toCol = toTable.columns.find(c => c.name === rel.toColumn);
        if (toCol) toCol.isReferenced = true;
    }
});

// Populate filter list
const filterList = document.getElementById('filterList');
tables.forEach((table, index) => {
    const tableKey = `${table.schema}.${table.name}`;
    const item = document.createElement('div');
    item.className = 'filter-item';
    item.setAttribute('data-table-name', tableKey.toLowerCase());
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `table-${index}`;
    checkbox.checked = true;
    checkbox.onchange = () => toggleTableVisibility(tableKey, checkbox.checked);
    
    const label = document.createElement('label');
    label.htmlFor = `table-${index}`;
    label.textContent = tableKey;
    
    item.appendChild(checkbox);
    item.appendChild(label);
    filterList.appendChild(item);
});

// Create relationship and table groups
const relationshipGroup = container.append('g').attr('class', 'relationships');
const tableGroup = container.append('g').attr('class', 'tables');

// Define drag behavior once
const drag = d3.drag()
    .on('start', function(event, d) {
        d3.select(this).raise();
    })
    .on('drag', function(event, d) {
        d.x = event.x;
        d.y = event.y;
        d3.select(this).attr('transform', `translate(${d.x}, ${d.y})`);
        
        // Update relationship lines during drag
        updateRelationships();
    })
    .on('end', function(event, d) {
        // Ensure final position is set
        updateRelationships();
    });

// Initial draw of tables and relationships
drawTables();
updateRelationships();

function drawTables() {
    // Clear existing tables
    tableGroup.selectAll('*').remove();

    // Filter visible tables
    const visibleTables = tables.filter(t => t.visible);

    visibleTables.forEach(table => {
        const tableG = tableGroup.append('g')
            .attr('class', 'table')
            .attr('transform', `translate(${table.x}, ${table.y})`)
            .datum(table)
            .call(drag);

        // Table header
        const headerRect = tableG.append('rect')
            .attr('class', 'table-header')
            .attr('width', table.width)
            .attr('height', headerHeight)
            .attr('rx', 4)
            .attr('stroke', 'var(--vscode-panel-border, #454545)')
            .attr('stroke-width', 2);
        
        // Apply header style
        if (diagramSettings.headerStyle === 'color') {
            headerRect.attr('fill', diagramSettings.headerColor)
                .attr('stroke-dasharray', 'none');
        } else if (diagramSettings.headerStyle === 'transparent') {
            headerRect.attr('fill', 'none')
                .attr('stroke-dasharray', 'none');
        } else if (diagramSettings.headerStyle === 'dotted') {
            headerRect.attr('fill', 'none')
                .attr('stroke', diagramSettings.textColor)
                .attr('stroke-dasharray', '2,2');
        } else if (diagramSettings.headerStyle === 'dashed') {
            headerRect.attr('fill', 'none')
                .attr('stroke', diagramSettings.textColor)
                .attr('stroke-dasharray', '8,4');
        }

        tableG.append('text')
            .attr('class', 'table-name')
            .attr('x', table.width / 2)
            .attr('y', headerHeight / 2 + 5)
            .attr('text-anchor', 'middle')
            .attr('fill', diagramSettings.textColor)
            .text(`${table.schema}.${table.name}`);

        // Table body
        tableG.append('rect')
            .attr('class', 'table-body')
            .attr('y', headerHeight)
            .attr('width', table.width)
            .attr('height', table.columns.length * rowHeight)
            .attr('rx', 4);

        // Columns
        table.columns.forEach((column, i) => {
            const y = headerHeight + i * rowHeight + rowHeight / 2 + 5;
            const iconStartX = 10;
            const iconSize = 16;
            let currentX = iconStartX;

            // Show key indicator - one icon for PK, FK, or both (only if showKeys is enabled)
            if (diagramSettings.showKeys && (column.isPrimaryKey || column.isForeignKey)) {
                const keyIcon = tableG.append('g')
                    .attr('transform', `translate(${currentX}, ${y - 8})`);
                
                // Determine icon class based on key type
                // If both PK and FK - use PK icon but with FK color (blue)
                const iconClass = (column.isPrimaryKey && column.isForeignKey) ? 'pk-fk-indicator' : 
                                 column.isPrimaryKey ? 'pk-indicator' : 'fk-indicator';
                
                // For PK or PK+FK, use key icon
                if (column.isPrimaryKey) {
                    keyIcon.append('path')
                        .attr('class', iconClass)
                        .attr('d', 'M8.278 1.922l1.801 1.801a1.439 1.439 0 0 1 0 2.035l-1.322 1.322a1.439 1.439 0 0 1 -2.035 0l-.15 -.15l-3.279 3.279a1 1 0 0 1 -.62 .289l-.087 .004h-.586a.5.5 0 0 1 -.497 -.442l-.003 -.058v-.586a1 1 0 0 1 .234 -.642l.059 -.065l.207 -.207h1v-1h1v-1l1.072 -1.072l-.15 -.15a1.439 1.439 0 0 1 0 -2.035l1.322 -1.322a1.439 1.439 0 0 1 2.035 0z')
                        .attr('transform', 'scale(0.8)');
                    
                    keyIcon.append('path')
                        .attr('class', iconClass)
                        .attr('d', 'M7.5 4.5h.005')
                        .attr('transform', 'scale(0.8)');
                } else {
                    // For FK only, use FK icon
                    keyIcon.append('path')
                        .attr('class', iconClass)
                        .attr('d', 'M10.5 5h-4.175C5.915 3.835 4.805 3 3.5 3c-1.655 0-3 1.345-3 3s1.345 3 3 3c1.305 0 2.415-.835 2.825-2H6.5l1 1 1-1 1 1 2-2.02zM3.5 7.5c-.825 0-1.5-.675-1.5-1.5s.675-1.5 1.5-1.5 1.5.675 1.5 1.5-.675 1.5-1.5 1.5')
                        .attr('transform', 'scale(0.8)');
                }
                
                currentX += iconSize;
            }
            
            // Calculate text position based on table's icon space
            // This ensures consistent alignment for all columns in the table
            let alignedTextX;
            if (table.hasAnyKey) {
                // Reserve space for 1 icon
                alignedTextX = iconStartX + iconSize + 2;
            } else {
                // No icons in this table
                alignedTextX = iconStartX;
            }
                
            // Column name - always aligned at the same position
            tableG.append('text')
                .attr('class', 'column-text')
                .attr('x', alignedTextX)
                .attr('y', y)
                .attr('fill', diagramSettings.textColor)
                .text(`${column.name}`);

            // Column type (right-aligned) - only if showDatatypes is enabled
            if (diagramSettings.showDatatypes) {
                tableG.append('text')
                    .attr('class', 'column-text')
                    .attr('x', table.width - 10)
                    .attr('y', y)
                    .attr('text-anchor', 'end')
                    .attr('fill', diagramSettings.datatypeColor)
                    .style('opacity', 0.7)
                    .text(`${column.type}`);
            }
        });
    });
}

function getColumnYPosition(table, columnName) {
    // Find the column index in the table
    const columnIndex = table.columns.findIndex(col => col.name === columnName);
    if (columnIndex === -1) {
        // If column not found, return middle of table
        return table.y + headerHeight + (table.columns.length * rowHeight) / 2;
    }
    // Return Y position of the specific column (middle of the row)
    return table.y + headerHeight + columnIndex * rowHeight + rowHeight / 2;
}

function updateRelationships() {
    // Redraw all relationship lines based on current table positions
    relationshipGroup.selectAll('path').remove();
    
    // Skip drawing if references are hidden
    if (!diagramSettings.showReferences) {
        return;
    }
    
    relationships.forEach(rel => {
        const fromTable = tableMap.get(rel.from);
        const toTable = tableMap.get(rel.to);

        if (fromTable && toTable && fromTable.visible && toTable.visible) {
            // Get Y positions for specific columns
            const fromY = getColumnYPosition(fromTable, rel.fromColumn);
            const toY = getColumnYPosition(toTable, rel.toColumn);
            
            // Always connect from sides (left/right edges)
            let x1, y1, x2, y2;
            
            // Determine which side to connect from based on relative X positions
            if (fromTable.x < toTable.x) {
                // From is left of To - connect from right edge of From to left edge of To
                x1 = fromTable.x + fromTable.width;
                x2 = toTable.x;
            } else {
                // From is right of To - connect from left edge of From to right edge of To
                x1 = fromTable.x;
                x2 = toTable.x + toTable.width;
            }
            
            y1 = fromY;
            y2 = toY;
            
            // Bezier curve for smooth connections
            const midX = (x1 + x2) / 2;
            const line = relationshipGroup.append('path')
                .attr('class', 'relationship-line')
                .attr('d', `M ${x1},${y1} C ${midX},${y1} ${midX},${y2} ${x2},${y2}`)
                .attr('stroke', diagramSettings.lineColor)
                .attr('stroke-width', diagramSettings.lineWidth);
            
            // Apply line style
            if (diagramSettings.lineStyle === 'dashed') {
                line.attr('stroke-dasharray', '8,4');
            } else if (diagramSettings.lineStyle === 'dotted') {
                line.attr('stroke-dasharray', '2,4');
            }
            
            // Add marker only if arrowHeadStyle is not 'none'
            if (diagramSettings.arrowHeadStyle !== 'none') {
                line.attr('marker-end', 'url(#arrowhead)');
            }
            
            line.append('title')
                .text(`${rel.name}: ${rel.fromColumn} → ${rel.toColumn}`);
        }
    });
}

function resetZoom() {
    // Instead of just resetting to identity, fit to the current visible tables
    fitToScreen();
}

function fitToScreen() {
    try {
        const containerNode = container.node();
        if (!containerNode) {
            console.warn('Container node not found');
            return;
        }
        
        const bounds = containerNode.getBBox();
        const fullWidth = bounds.width;
        const fullHeight = bounds.height;
        const midX = bounds.x + fullWidth / 2;
        const midY = bounds.y + fullHeight / 2;

        if (fullWidth === 0 || fullHeight === 0) {
            console.warn('Container has zero dimensions');
            return;
        }

        // Calculate scale with some padding (0.85 instead of 0.9 for more breathing room)
        const scale = 0.85 / Math.max(fullWidth / width, fullHeight / height);
        const translate = [width / 2 - scale * midX, height / 2 - scale * midY];

        svg.transition().duration(750).call(
            zoom.transform,
            d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
        );
    } catch (error) {
        console.error('Error in fitToScreen:', error);
    }
}

// Initial fit to screen only if we have tables
if (tables && tables.length > 0) {
    setTimeout(() => {
        updateRelationships(); // Ensure relationships are drawn
        fitToScreen();
    }, 100);
}

// Filter panel functions
function toggleFilterPanel() {
    const panel = document.getElementById('filterPanel');
    panel.classList.toggle('visible');
}

function filterTableList() {
    const searchInput = document.getElementById('filterSearch');
    const searchTerm = searchInput.value.toLowerCase();
    const items = document.querySelectorAll('.filter-item');
    
    items.forEach(item => {
        const tableName = item.getAttribute('data-table-name');
        if (tableName.includes(searchTerm)) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
}

function selectAllTables() {
    const checkboxes = document.querySelectorAll('.filter-item:not(.hidden) input[type="checkbox"]');
    let changed = false;
    
    checkboxes.forEach(cb => {
        if (!cb.checked) {
            cb.checked = true;
            // Update visibility directly
            const label = cb.nextElementSibling;
            if (label) {
                const tableKey = label.textContent;
                const table = tableMap.get(tableKey);
                if (table) {
                    table.visible = true;
                    changed = true;
                }
            }
        }
    });
    
    if (changed) {
        recalculateLayout();
        redrawDiagram();
    }
}

function deselectAllTables() {
    const checkboxes = document.querySelectorAll('.filter-item:not(.hidden) input[type="checkbox"]');
    let changed = false;
    
    checkboxes.forEach(cb => {
        if (cb.checked) {
            cb.checked = false;
            // Update visibility directly
            const label = cb.nextElementSibling;
            if (label) {
                const tableKey = label.textContent;
                const table = tableMap.get(tableKey);
                if (table) {
                    table.visible = false;
                    changed = true;
                }
            }
        }
    });
    
    if (changed) {
        recalculateLayout();
        redrawDiagram();
    }
}

function toggleTableVisibility(tableKey, visible) {
    const table = tableMap.get(tableKey);
    if (table) {
        table.visible = visible;
        recalculateLayout();
        redrawDiagram();
    }
}

function recalculateLayout() {
    // Filter visible tables
    const visibleTables = tables.filter(t => t.visible);
    
    if (visibleTables.length === 0) {
        return;
    }

    // Create new Dagre graph for visible tables only
    const g = new dagre.graphlib.Graph();
    g.setGraph({
        rankdir: 'TB',
        nodesep: 80,
        ranksep: 100,
        marginx: 50,
        marginy: 50
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add only visible nodes
    visibleTables.forEach(table => {
        const tableKey = `${table.schema}.${table.name}`;
        g.setNode(tableKey, {
            label: tableKey,
            width: table.width,
            height: table.height
        });
    });

    // Add only edges between visible tables
    relationships.forEach(rel => {
        const fromTable = tableMap.get(rel.from);
        const toTable = tableMap.get(rel.to);
        if (fromTable && toTable && fromTable.visible && toTable.visible) {
            g.setEdge(rel.from, rel.to);
        }
    });

    // Run Dagre layout
    dagre.layout(g);

    // Apply new positions
    visibleTables.forEach(table => {
        const tableKey = `${table.schema}.${table.name}`;
        const node = g.node(tableKey);
        if (node) {
            table.x = node.x - table.width / 2;
            table.y = node.y - table.height / 2;
        }
    });
}

function redrawDiagram() {
    // Redraw tables and relationships
    drawTables();
    updateRelationships();
}

// Settings panel functions
function toggleSettingsPanel() {
    const panel = document.getElementById('settingsPanel');
    panel.classList.toggle('visible');
}

function toggleSettingsGroup(groupId) {
    const content = document.getElementById(groupId + 'Content');
    const toggle = document.getElementById(groupId + 'Toggle');
    
    content.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
}

function updateDiagramSettings() {
    // Read settings from UI
    diagramSettings.showDatatypes = document.getElementById('showDatatypes').checked;
    diagramSettings.showKeys = document.getElementById('showKeys').checked;
    diagramSettings.showReferences = document.getElementById('showReferences').checked;
    diagramSettings.lineColor = document.getElementById('lineColor').value;
    diagramSettings.arrowColor = document.getElementById('arrowColor').value;
    diagramSettings.arrowHeadStyle = document.getElementById('arrowHeadStyle').value;
    diagramSettings.lineStyle = document.getElementById('lineStyle').value;
    diagramSettings.lineWidth = parseFloat(document.getElementById('lineWidth').value);
    diagramSettings.headWidth = parseFloat(document.getElementById('headWidth').value);
    diagramSettings.headerStyle = document.getElementById('headerStyle').value;
    diagramSettings.headerColor = document.getElementById('headerColor').value;
    diagramSettings.textColor = document.getElementById('textColor').value;
    diagramSettings.datatypeColor = document.getElementById('datatypeColor').value;
    
    // Show/hide header color picker based on header style
    const headerColorContainer = document.getElementById('headerColorContainer');
    if (diagramSettings.headerStyle === 'color') {
        headerColorContainer.style.display = 'flex';
    } else {
        headerColorContainer.style.display = 'none';
    }
    
    // Update arrow markers
    updateArrowheadMarkers();
    
    // Redraw the entire diagram
    redrawDiagram();
}

// Export function
function exportAsSVG() {
    console.log('[Export] SVG export function called');
    
    try {
        console.log('[Export] Starting SVG export...');
        // Clone the SVG
        const svgElement = document.getElementById('diagram');
        if (!svgElement) {
            console.error('[Export] SVG element not found!');
            return;
        }
        console.log('[Export] SVG element found, cloning...');
        const svgClone = svgElement.cloneNode(true);
        
        // Get computed styles and apply them inline
        console.log('[Export] Applying computed styles...');
        const applyComputedStyles = (original, clone) => {
            const origElements = original.querySelectorAll('*');
            const cloneElements = clone.querySelectorAll('*');
            
            for (let i = 0; i < origElements.length; i++) {
                const origEl = origElements[i];
                const cloneEl = cloneElements[i];
                const computedStyle = window.getComputedStyle(origEl);
                
                // Apply relevant styles inline
                if (cloneEl.tagName === 'rect') {
                    cloneEl.setAttribute('fill', computedStyle.fill);
                    cloneEl.setAttribute('stroke', computedStyle.stroke);
                    cloneEl.setAttribute('stroke-width', computedStyle.strokeWidth);
                } else if (cloneEl.tagName === 'text') {
                    cloneEl.setAttribute('fill', computedStyle.fill);
                    cloneEl.setAttribute('font-family', computedStyle.fontFamily);
                    cloneEl.setAttribute('font-size', computedStyle.fontSize);
                    cloneEl.setAttribute('font-weight', computedStyle.fontWeight);
                } else if (cloneEl.tagName === 'path') {
                    cloneEl.setAttribute('stroke', computedStyle.stroke);
                    cloneEl.setAttribute('stroke-width', computedStyle.strokeWidth);
                    cloneEl.setAttribute('fill', computedStyle.fill);
                    if (computedStyle.strokeDasharray !== 'none') {
                        cloneEl.setAttribute('stroke-dasharray', computedStyle.strokeDasharray);
                    }
                }
            }
        };
        
        applyComputedStyles(svgElement, svgClone);
        
        // Apply current diagram settings to the clone
        // Update colors and styles based on current settings
        const cloneRelationships = svgClone.querySelectorAll('.relationship-line');
        cloneRelationships.forEach(rel => {
            rel.setAttribute('stroke', diagramSettings.lineColor);
            rel.setAttribute('stroke-width', diagramSettings.lineWidth);
            
            // Apply line style
            if (diagramSettings.lineStyle === 'dashed') {
                rel.setAttribute('stroke-dasharray', '8,4');
            } else if (diagramSettings.lineStyle === 'dotted') {
                rel.setAttribute('stroke-dasharray', '2,4');
            }
            
            if (diagramSettings.arrowHeadStyle === 'none') {
                rel.removeAttribute('marker-end');
            }
        });
        
        // Update marker colors in defs
        const cloneDefs = svgClone.querySelector('defs');
        if (cloneDefs) {
            const markers = cloneDefs.querySelectorAll('marker');
            markers.forEach(marker => {
                const paths = marker.querySelectorAll('path');
                const circles = marker.querySelectorAll('circle');
                paths.forEach(p => {
                    if (p.getAttribute('fill') && p.getAttribute('fill') !== 'none') {
                        p.setAttribute('fill', diagramSettings.arrowColor);
                    }
                    if (p.getAttribute('stroke')) {
                        p.setAttribute('stroke', diagramSettings.arrowColor);
                    }
                });
                circles.forEach(c => c.setAttribute('fill', diagramSettings.arrowColor));
            });
        }
        
        // Get the bounding box of visible content
        const bounds = container.node().getBBox();
        
        // Set viewBox to show only visible tables
        svgClone.setAttribute('viewBox', `${bounds.x - 20} ${bounds.y - 20} ${bounds.width + 40} ${bounds.height + 40}`);
        svgClone.setAttribute('width', bounds.width + 40);
        svgClone.setAttribute('height', bounds.height + 40);
        
        // Add background
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', bounds.x - 20);
        bgRect.setAttribute('y', bounds.y - 20);
        bgRect.setAttribute('width', bounds.width + 40);
        bgRect.setAttribute('height', bounds.height + 40);
        bgRect.setAttribute('fill', '#1e1e1e');
        svgClone.insertBefore(bgRect, svgClone.firstChild);
        
        // Serialize to string
        console.log('[Export] Serializing SVG...');
        const serializer = new XMLSerializer();
        let svgString = serializer.serializeToString(svgClone);
        console.log('[Export] SVG serialized, length:', svgString.length);
        
        // Add XML declaration
        svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
        
        // Send to VS Code extension host for saving
        console.log('[Export] Sending SVG data to extension host...');
        vscode.postMessage({
            command: 'exportDiagram',
            format: 'svg',
            data: svgString,
            defaultFilename: `database-diagram-${DATABASE_NAME}-${Date.now()}.svg`
        });
        
        console.log('[Export] SVG export message sent');
    } catch (error) {
        console.error('[Export] Error exporting SVG:', error);
        vscode.postMessage({
            command: 'error',
            message: 'Failed to export SVG: ' + error.message
        });
    }
}
