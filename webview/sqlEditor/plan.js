
function showQueryPlan(planXml, executionTime, messages, resultSets) {
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusLabel = document.getElementById('statusLabel');
    const resizer = document.getElementById('resizer');
    
    // Stop the loading timer
    if (typeof stopLoadingTimer === 'function') {
        stopLoadingTimer();
    }
    
    // Enable buttons
    if (executeButton) executeButton.disabled = false;
    if (cancelButton) cancelButton.disabled = true;
    
    // Parse the XML plan
    const planData = parseQueryPlan(planXml);
    window.currentQueryPlan = planData;
    
    // Show plan tabs
    document.querySelectorAll('.results-tab').forEach(tab => {
        if (tab.dataset.tab === 'queryPlan' || tab.dataset.tab === 'planTree' || tab.dataset.tab === 'topOperations') {
            tab.style.display = 'block';
        }
    });
    
    // Update status
    if (statusLabel) {
        statusLabel.textContent = resultSets ? `Query completed with execution plan` : `Estimated execution plan generated`;
    }
    
    const resultsContainer = document.getElementById('resultsContainer');
    if (resultsContainer) {
        resultsContainer.classList.add('visible');
        // Show results panel if not visible
        if (!resultsContainer.style.flex) {
            resultsContainer.style.flex = '0 0 400px';
        }
    }
    
    if (resizer) {
        resizer.classList.add('visible');
    }
    
    // Display the plan in different views
    displayQueryPlanGraphical(planData);
    displayPlanTree(planData);
    displayTopOperations(planData);
    
    // If we have result sets (actual plan), display them
    if (resultSets && resultSets.length > 0) {
        if (typeof displayResults === 'function') {
            displayResults(resultSets, planXml);
        }
        if (typeof displayMessages === 'function') {
            displayMessages(messages);
        }
        
        // Switch to results tab first
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        const resultsTab = document.querySelector('.results-tab[data-tab="results"]');
        if (resultsTab) resultsTab.classList.add('active');
        
        window.currentTab = 'results';
        
        const resultsContent = document.getElementById('resultsContent');
        const messagesContent = document.getElementById('messagesContent');
        const queryPlanContent = document.getElementById('queryPlanContent');
        const planTreeContent = document.getElementById('planTreeContent');
        const topOperationsContent = document.getElementById('topOperationsContent');
        
        if (resultsContent) resultsContent.style.display = 'block';
        if (messagesContent) messagesContent.style.display = 'none';
        if (queryPlanContent) queryPlanContent.style.display = 'none';
        if (planTreeContent) planTreeContent.style.display = 'none';
        if (topOperationsContent) topOperationsContent.style.display = 'none';
    } else {
        // For estimated plan, show XML in results
        const resultsContent = document.getElementById('resultsContent');
        if (resultsContent) {
            resultsContent.innerHTML = `
                <div style="padding: 12px;">
                    <h3 style="margin-top: 0; font-size: 14px;">ShowPlanXML</h3>
                    <pre style="background-color: var(--vscode-editor-background); padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: auto; font-family: 'Courier New', monospace; font-size: 12px;">${escapeHtml(planXml)}</pre>
                </div>
            `;
        }
        
        if (typeof displayMessages === 'function') {
            displayMessages(messages);
        }
        
        // Switch to Query Plan tab
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        const queryPlanTab = document.querySelector('.results-tab[data-tab="queryPlan"]');
        if (queryPlanTab) queryPlanTab.classList.add('active');
        
        window.currentTab = 'queryPlan';
        
        const messagesContent = document.getElementById('messagesContent');
        const queryPlanContent = document.getElementById('queryPlanContent');
        const planTreeContent = document.getElementById('planTreeContent');
        const topOperationsContent = document.getElementById('topOperationsContent');
        
        if (resultsContent) resultsContent.style.display = 'none';
        if (messagesContent) messagesContent.style.display = 'none';
        if (queryPlanContent) queryPlanContent.style.display = 'block';
        if (planTreeContent) planTreeContent.style.display = 'none';
        if (topOperationsContent) topOperationsContent.style.display = 'none';
    }
}

function parseQueryPlan(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    
    const planData = {
        operations: [],
        hierarchicalOperations: [],
        topOperations: [],
        totalCost: 0
    };
    
    // Get statement info for root SELECT node
    const stmtSimple = xmlDoc.querySelector('StmtSimple');
    const statementText = stmtSimple?.getAttribute('StatementText') || 'SELECT';
    const statementCost = parseFloat(stmtSimple?.getAttribute('StatementSubTreeCost') || '0');
    
    // Find the root RelOp (usually under QueryPlan > RelOp)
    const rootRelOp = xmlDoc.querySelector('QueryPlan > RelOp, StmtSimple > QueryPlan > RelOp');
    
    if (!rootRelOp) {
        return planData;
    }
    
    // Set total cost from statement
    planData.totalCost = statementCost;
    
    let operationId = 0;
    
    // Create artificial SELECT root node
    const selectNode = {
        id: operationId++,
        level: 0,
        parent: null,
        physicalOp: 'SELECT',
        logicalOp: 'SELECT',
        estimatedCost: 0,
        estimatedRows: parseFloat(stmtSimple?.getAttribute('StatementEstRows') || '0'),
        estimatedSubtreeCost: statementCost,
        estimatedCPU: 0,
        estimatedIO: 0,
        avgRowSize: 0,
        estimatedExecutions: 1,
        actualRows: 0,
        actualExecutions: 0,
        children: [],
        details: { statement: statementText }
    };
    
    planData.operations.push(selectNode);
    
    // Recursive function to parse operation tree
    function parseOperation(relOpElement, level = 1, parent = selectNode) {
        const estimatedSubtreeCost = parseFloat(relOpElement.getAttribute('EstimatedTotalSubtreeCost') || '0');
        
        const operation = {
            id: operationId++,
            level: level,
            parent: parent,
            physicalOp: relOpElement.getAttribute('PhysicalOp') || 'Unknown',
            logicalOp: relOpElement.getAttribute('LogicalOp') || 'Unknown',
            estimatedCost: 0, // Will be calculated later
            estimatedRows: parseFloat(relOpElement.getAttribute('EstimateRows') || '0'),
            estimatedSubtreeCost: estimatedSubtreeCost,
            estimatedCPU: parseFloat(relOpElement.getAttribute('EstimateCPU') || '0'),
            estimatedIO: parseFloat(relOpElement.getAttribute('EstimateIO') || '0'),
            avgRowSize: parseInt(relOpElement.getAttribute('AvgRowSize') || '0'),
            estimatedExecutions: parseFloat(relOpElement.getAttribute('EstimateRewinds') || '0') + parseFloat(relOpElement.getAttribute('EstimateRebinds') || '0') + 1,
            actualRows: 0,
            actualExecutions: 0,
            children: [],
            details: {}
        };
        
        // Extract specific operation details
        const indexScan = relOpElement.querySelector(':scope > IndexScan, :scope > TableScan, :scope > ClusteredIndexScan');
        if (indexScan) {
            const object = indexScan.querySelector('Object');
            if (object) {
                operation.details.table = object.getAttribute('Table')?.replace(/[\[\]]/g, '') || '';
                operation.details.index = object.getAttribute('Index')?.replace(/[\[\]]/g, '') || '';
                operation.details.schema = object.getAttribute('Schema')?.replace(/[\[\]]/g, '') || 'dbo';
            }
        }
        
        // Extract actual execution stats if present (for actual plans)
        const runTimeInfo = relOpElement.querySelector(':scope > RunTimeInformation');
        if (runTimeInfo) {
            const rowCount = runTimeInfo.querySelector('RunTimeCountersPerThread');
            if (rowCount) {
                operation.actualRows = parseInt(rowCount.getAttribute('ActualRows') || '0');
                operation.actualExecutions = parseInt(rowCount.getAttribute('ActualExecutions') || '0');
            }
        }
        
        planData.operations.push(operation);
        
        // Parse child operations recursively
        const childRelOps = [];
        
        // Check for operation-specific child locations
        const nestedLoops = relOpElement.querySelector(':scope > NestedLoops');
        const merge = relOpElement.querySelector(':scope > Merge');
        const hash = relOpElement.querySelector(':scope > Hash');
        const sort = relOpElement.querySelector(':scope > Sort');
        const top = relOpElement.querySelector(':scope > Top');
        
        if (nestedLoops) {
            childRelOps.push(...nestedLoops.querySelectorAll(':scope > RelOp'));
        } else if (merge) {
            childRelOps.push(...merge.querySelectorAll(':scope > RelOp'));
        } else if (hash) {
            childRelOps.push(...hash.querySelectorAll(':scope > RelOp'));
        } else if (sort) {
            childRelOps.push(...sort.querySelectorAll(':scope > RelOp'));
        } else if (top) {
            childRelOps.push(...top.querySelectorAll(':scope > RelOp'));
        } else {
            // General case: look for direct RelOp children
            childRelOps.push(...relOpElement.querySelectorAll(':scope > RelOp'));
        }
        
        childRelOps.forEach(childRelOp => {
            const childOp = parseOperation(childRelOp, level + 1, operation);
            operation.children.push(childOp);
        });
        
        // Calculate operator cost as subtree cost minus children costs
        const childrenCost = operation.children.reduce((sum, child) => sum + child.estimatedSubtreeCost, 0);
        operation.estimatedCost = Math.max(0, operation.estimatedSubtreeCost - childrenCost);
        
        return operation;
    }
    
    // Parse the entire operation tree starting from root RelOp
    const rootOperation = parseOperation(rootRelOp, 1, selectNode);
    selectNode.children.push(rootOperation);
    
    // Flatten the tree for hierarchical display (depth-first traversal)
    function flattenTree(operation, result = []) {
        result.push(operation);
        operation.children.forEach(child => flattenTree(child, result));
        return result;
    }
    
    planData.hierarchicalOperations = flattenTree(selectNode);
    
    // Sort by cost for top operations (exclude SELECT node)
    planData.topOperations = [...planData.operations]
        .filter(op => op.physicalOp !== 'SELECT')
        .sort((a, b) => b.estimatedCost - a.estimatedCost)
        .slice(0, 20);
    
    return planData;
}

function displayQueryPlanGraphical(planData) {
    const queryPlanContent = document.getElementById('queryPlanContent');
    
    if (!planData || !planData.hierarchicalOperations || planData.hierarchicalOperations.length === 0) {
        if (queryPlanContent) queryPlanContent.innerHTML = '<div class="no-results">No query plan available</div>';
        return;
    }
    
    // Clear previous content
    if (queryPlanContent) queryPlanContent.innerHTML = '';
    
    // Node dimensions
    const nodeWidth = 180;
    const nodeHeight = 100;
    const horizontalSpacing = 60;
    const verticalSpacing = 40;
    
    // Create D3 hierarchy from our data
    const root = d3.hierarchy(convertToHierarchy(planData.hierarchicalOperations[0]), d => d.children);
    
    // Custom left-to-right layout
    let nodeId = 0;
    root.eachBefore(node => {
        node.id = nodeId++;
    });
    
    function calculateLayout(node, x = 0, y = 0) {
        node.x = x;
        node.y = y;
        
        if (node.children) {
            if (node.children.length === 1) {
                calculateLayout(node.children[0], x + nodeWidth + horizontalSpacing, y);
            } else {
                const totalHeight = (node.children.length - 1) * (nodeHeight + verticalSpacing);
                let currentY = y - totalHeight / 2;
                
                node.children.forEach(child => {
                    calculateLayout(child, x + nodeWidth + horizontalSpacing, currentY);
                    currentY += nodeHeight + verticalSpacing;
                });
            }
        }
    }
    
    calculateLayout(root);
    
    // Calculate bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    root.each(node => {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x + nodeWidth);
        minY = Math.min(minY, node.y);
        maxY = Math.max(maxY, node.y + nodeHeight);
    });
    
    const padding = 40;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    
    const svg = d3.select(queryPlanContent)
        .append('svg')
        .attr('class', 'query-plan-svg')
        .attr('width', '100%')
        .attr('height', Math.max(600, height))
        .attr('viewBox', [0, 0, width, height]);
    
    const g = svg.append('g')
        .attr('transform', `translate(${padding - minX}, ${padding - minY})`);
    
    // Draw links with arrows - data flows from right (children) to left (parent)
    const linkGroup = g.append('g').attr('class', 'links');
    
    root.each(node => {
        if (node.children) {
            const parentX = node.x;
            const parentY = node.y + nodeHeight / 2;
            
            if (node.children.length === 1) {
                // Single child - straight horizontal line with arrow at parent
                const child = node.children[0];
                const childX = child.x;
                const childY = child.y + nodeHeight / 2;
                
                linkGroup.append('line')
                    .attr('class', 'plan-link')
                    .attr('x1', childX)
                    .attr('y1', childY)
                    .attr('x2', parentX + nodeWidth + 10)
                    .attr('y2', parentY);
                
                // Arrow pointing RIGHT to parent (only if not root)
                if (node.depth > 0) {
                    linkGroup.append('polygon')
                        .attr('class', 'arrow')
                        .attr('points', `${parentX + nodeWidth + 10},${parentY - 6} ${parentX + nodeWidth},${parentY} ${parentX + nodeWidth + 10},${parentY + 6}`)
                        .style('fill', 'var(--connection-color, #808080)');
                }
            } else {
                // Multiple children - branching with vertical connector
                // Branch point is in the middle between children and parent
                const firstChild = node.children[0];
                const branchX = (firstChild.x + parentX + nodeWidth) / 2;
                
                // Draw vertical line connecting all children
                const firstChildY = node.children[0].y + nodeHeight / 2;
                const lastChildY = node.children[node.children.length - 1].y + nodeHeight / 2;
                
                linkGroup.append('line')
                    .attr('class', 'plan-link')
                    .attr('x1', branchX)
                    .attr('y1', firstChildY)
                    .attr('x2', branchX)
                    .attr('y2', lastChildY);
                
                // Draw horizontal line from branch point to parent
                linkGroup.append('line')
                    .attr('class', 'plan-link')
                    .attr('x1', branchX)
                    .attr('y1', parentY)
                    .attr('x2', parentX + nodeWidth + 10)
                    .attr('y2', parentY);
                
                // Arrow pointing RIGHT to parent (only if not root)
                if (node.depth > 0) {
                    linkGroup.append('polygon')
                        .attr('class', 'arrow')
                        .attr('points', `${parentX + nodeWidth + 10},${parentY - 6} ${parentX + nodeWidth},${parentY} ${parentX + nodeWidth + 10},${parentY + 6}`)
                        .style('fill', 'var(--connection-color, #808080)');
                }
                
                // Draw horizontal lines from each child to branch point
                node.children.forEach(child => {
                    const childX = child.x;
                    const childY = child.y + nodeHeight / 2;
                    
                    linkGroup.append('line')
                        .attr('class', 'plan-link')
                        .attr('x1', childX)
                        .attr('y1', childY)
                        .attr('x2', branchX)
                        .attr('y2', childY);
                });
            }
        }
    });
    
    // Create nodes
    const nodes = g.append('g').attr('class', 'nodes')
        .selectAll('.plan-node')
        .data(root.descendants())
        .join('g')
        .attr('class', d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100) : 0;
            return `plan-node ${costPercent > 10 ? 'high-cost' : ''}`;
        })
        .attr('transform', d => `translate(${d.x},${d.y})`)
        .on('click', function(event, d) {
            event.stopPropagation();
            
            const isSelected = d3.select(this).classed('selected');
            
            if (isSelected) {
                // Unclick - remove selection and hide tooltip
                g.selectAll('.plan-node').classed('selected', false);
                g.selectAll('.node-selection-outline').style('stroke', 'transparent');
                hideTooltip();
            } else {
                // Click - remove other selections, select this node, show tooltip
                g.selectAll('.plan-node').classed('selected', false);
                g.selectAll('.node-selection-outline').style('stroke', 'transparent');
                d3.select(this).classed('selected', true);
                d3.select(this).select('.node-selection-outline')
                    .style('stroke', 'var(--vscode-button-background)');
                showTooltip(event, d.data);
            }
        });
    
    // Add main rectangles for nodes
    nodes.append('rect')
        .attr('class', 'node-main-rect')
        .attr('width', nodeWidth)
        .attr('height', nodeHeight)
        .attr('rx', 4)
        .style('fill', 'var(--vscode-input-background)')
        .style('stroke', 'var(--vscode-panel-border)')
        .style('stroke-width', 1);
    
    // Add selection outline (dashed border on entire node)
    nodes.append('rect')
        .attr('class', 'node-selection-outline')
        .attr('width', nodeWidth)
        .attr('height', nodeHeight)
        .attr('rx', 4)
        .style('fill', 'none')
        .style('stroke', 'transparent')
        .style('stroke-width', 3)
        .style('stroke-dasharray', '5,5')
        .style('pointer-events', 'none');
    
    // Add operation name
    nodes.append('text')
        .attr('class', 'node-title')
        .attr('text-anchor', 'middle')
        .attr('x', nodeWidth / 2)
        .attr('y', 30)
        .style('fill', 'var(--vscode-editor-foreground)')
        .style('font-size', '12px')
        .style('font-weight', '600')
        .text(d => d.data.physicalOp);
    
    // Add subtitle if exists (table/index name)
    nodes.filter(d => d.data.details && (d.data.details.table || d.data.details.index))
        .append('text')
        .attr('class', 'node-subtitle')
        .attr('text-anchor', 'middle')
        .attr('x', nodeWidth / 2)
        .attr('y', 45)
        .style('fill', '#858585')
        .style('font-size', '10px')
        .text(d => {
            const table = d.data.details.table ? `[${d.data.details.schema || 'dbo'}].[${d.data.details.table}]` : '';
            const index = d.data.details.index ? `[${d.data.details.index}]` : '';
            const text = table + (index ? ' ' + index : '');
            return text.length > 30 ? text.substring(0, 27) + '...' : text;
        });
    
    // Add cost percentage badge
    nodes.append('rect')
        .attr('class', d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100) : 0;
            return costPercent >= 50 ? 'cost-badge high' : costPercent >= 10 ? 'cost-badge medium' : 'cost-badge low';
        })
        .attr('x', nodeWidth / 2 - 20)
        .attr('y', 60)
        .attr('width', 40)
        .attr('height', 18)
        .attr('rx', 9)
        .style('fill', d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100) : 0;
            if (costPercent >= 50) return '#d73027';
            if (costPercent >= 10) return '#fc8d59';
            return '#4575b4';
        });
    
    nodes.append('text')
        .attr('class', 'cost-text')
        .attr('text-anchor', 'middle')
        .attr('x', nodeWidth / 2)
        .attr('y', 73)
        .style('fill', '#ffffff')
        .style('font-size', '10px')
        .style('font-weight', '600')
        .text(d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100).toFixed(0) : 0;
            return `${costPercent}%`;
        });
    
    // Add row count in bottom right
    nodes.append('text')
        .attr('class', 'row-count')
        .attr('text-anchor', 'end')
        .attr('x', nodeWidth - 10)
        .attr('y', nodeHeight - 10)
        .style('fill', '#858585')
        .style('font-size', '11px')
        .text(d => d.data.estimatedRows.toLocaleString());
    
    // Add zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => {
            g.attr('transform', `translate(${padding - minX}, ${padding - minY}) ${event.transform}`);
        });
    
    svg.call(zoom);
    
    // Click outside to deselect and hide tooltip
    if (queryPlanContent) {
        queryPlanContent.addEventListener('click', function(event) {
            if (event.target === queryPlanContent || event.target.tagName === 'svg') {
                g.selectAll('.plan-node').classed('selected', false);
                hideTooltip();
            }
        });
    }
    
    // Create tooltip element
    let tooltip = d3.select('body').select('.plan-tooltip');
    if (tooltip.empty()) {
        tooltip = d3.select('body')
            .append('div')
            .attr('class', 'plan-tooltip')
            .style('display', 'none')
            .style('position', 'fixed');
    }
    
    function showTooltip(event, operation) {
        let html = `<h4>${operation.physicalOp}</h4>`;
        html += '<div class="plan-tooltip-grid">';
        
        html += `<div class="plan-tooltip-label">Logical Op:</div><div class="plan-tooltip-value">${operation.logicalOp}</div>`;
        html += `<div class="plan-tooltip-label">Est. Cost:</div><div class="plan-tooltip-value">${operation.estimatedCost.toFixed(4)}</div>`;
        html += `<div class="plan-tooltip-label">Est. Subtree:</div><div class="plan-tooltip-value">${operation.estimatedSubtreeCost.toFixed(4)}</div>`;
        html += `<div class="plan-tooltip-label">Est. Rows:</div><div class="plan-tooltip-value">${operation.estimatedRows.toLocaleString()}</div>`;
        html += `<div class="plan-tooltip-label">Est. Executions:</div><div class="plan-tooltip-value">${operation.estimatedExecutions}</div>`;
        html += `<div class="plan-tooltip-label">Est. CPU:</div><div class="plan-tooltip-value">${operation.estimatedCPU.toFixed(6)}</div>`;
        html += `<div class="plan-tooltip-label">Est. I/O:</div><div class="plan-tooltip-value">${operation.estimatedIO.toFixed(6)}</div>`;
        html += `<div class="plan-tooltip-label">Avg Row Size:</div><div class="plan-tooltip-value">${operation.avgRowSize} bytes</div>`;
        
        if (operation.actualRows > 0) {
            html += `<div class="plan-tooltip-label">Actual Rows:</div><div class="plan-tooltip-value">${operation.actualRows.toLocaleString()}</div>`;
            html += `<div class="plan-tooltip-label">Actual Executions:</div><div class="plan-tooltip-value">${operation.actualExecutions}</div>`;
        }
        
        if (operation.details.table) {
            html += `<div class="plan-tooltip-label">Object:</div><div class="plan-tooltip-value">${operation.details.schema}.${operation.details.table}</div>`;
        }
        if (operation.details.index) {
            html += `<div class="plan-tooltip-label">Index:</div><div class="plan-tooltip-value">${operation.details.index}</div>`;
        }
        
        html += '</div>';
        
        tooltip
            .html(html)
            .style('display', 'block');
        
        // Position tooltip next to the node
        positionTooltip(event);
    }
    
    function positionTooltip(event) {
        const tooltipNode = tooltip.node();
        const tooltipWidth = 400;
        const tooltipHeight = tooltipNode.offsetHeight;
        
        // Get the clicked element's position
        const nodeRect = event.target.closest('g').getBoundingClientRect();
        
        let left = nodeRect.right + 15;
        let top = nodeRect.top;
        
        // Keep tooltip on screen - if it would go off right edge, put it on left side
        if (left + tooltipWidth > window.innerWidth) {
            left = nodeRect.left - tooltipWidth - 15;
        }
        
        // If still off screen on left, just position with some margin
        if (left < 0) {
            left = nodeRect.right + 15;
        }
        
        // Adjust vertical position if needed
        if (top + tooltipHeight > window.innerHeight) {
            top = window.innerHeight - tooltipHeight - 10;
        }
        if (top < 0) {
            top = 10;
        }
        
        tooltip
            .style('left', left + 'px')
            .style('top', top + 'px');
    }
    
    function hideTooltip() {
        tooltip.style('display', 'none');
    }
}

// Helper function to convert flat hierarchical array to nested tree structure
function convertToHierarchy(rootOp) {
    if (!rootOp) return null;
    
    return {
        ...rootOp,
        children: rootOp.children && rootOp.children.length > 0 
            ? rootOp.children.map(child => convertToHierarchy(child))
            : undefined
    };
}

function displayPlanTree(planData) {
    const planTreeContent = document.getElementById('planTreeContent');
    
    if (!planData || !planData.hierarchicalOperations || planData.hierarchicalOperations.length === 0) {
        if (planTreeContent) planTreeContent.innerHTML = '<div class="no-results">No plan tree available</div>';
        return;
    }
    
    let html = '<table class="plan-tree-table">';
    html += '<thead><tr>';
    html += '<th>Operation</th>';
    html += '<th>Estimated Cost %</th>';
    html += '<th>Estimated Subtree Cost</th>';
    html += '<th>Estimated Rows</th>';
    html += '<th>Average Row Size</th>';
    html += '<th>Estimated CPU Cost</th>';
    html += '<th>Estimated I/O Cost</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    planData.hierarchicalOperations.forEach((op) => {
        const costPercent = planData.totalCost > 0 ? ((op.estimatedCost / planData.totalCost) * 100).toFixed(0) : 0;
        const indentPixels = op.level * 24; // 24 pixels per level
        
        html += '<tr>';
        html += `<td><span class="plan-tree-indent" style="display: inline-block; width: ${indentPixels}px;"></span>${op.physicalOp}</td>`;
        html += `<td>${costPercent}%</td>`;
        html += `<td>${op.estimatedSubtreeCost.toFixed(4)}</td>`;
        html += `<td>${op.estimatedRows.toLocaleString()}</td>`;
        html += `<td>${op.avgRowSize}</td>`;
        html += `<td>${op.estimatedCPU.toFixed(6)}</td>`;
        html += `<td>${op.estimatedIO.toFixed(6)}</td>`;
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    if (planTreeContent) planTreeContent.innerHTML = html;
}

function displayOperationDetails(operation) {
    const detailsPanel = document.getElementById('planDetailsPanel');
    
    let html = `<h3>Operation Details: ${operation.physicalOp}</h3>`;
    html += '<div class="plan-details-grid">';
    
    html += `<div class="plan-details-label">Physical Operation:</div><div class="plan-details-value">${operation.physicalOp}</div>`;
    html += `<div class="plan-details-label">Logical Operation:</div><div class="plan-details-value">${operation.logicalOp}</div>`;
    html += `<div class="plan-details-label">Estimated Cost:</div><div class="plan-details-value">${operation.estimatedCost.toFixed(4)}</div>`;
    html += `<div class="plan-details-label">Estimated Subtree Cost:</div><div class="plan-details-value">${operation.estimatedSubtreeCost.toFixed(4)}</div>`;
    html += `<div class="plan-details-label">Estimated Rows:</div><div class="plan-details-value">${operation.estimatedRows.toLocaleString()}</div>`;
    html += `<div class="plan-details-label">Estimated Executions:</div><div class="plan-details-value">${operation.estimatedExecutions}</div>`;
    html += `<div class="plan-details-label">Estimated CPU Cost:</div><div class="plan-details-value">${operation.estimatedCPU.toFixed(6)}</div>`;
    html += `<div class="plan-details-label">Estimated I/O Cost:</div><div class="plan-details-value">${operation.estimatedIO.toFixed(6)}</div>`;
    html += `<div class="plan-details-label">Average Row Size:</div><div class="plan-details-value">${operation.avgRowSize} bytes</div>`;
    
    if (operation.actualRows > 0) {
        html += `<div class="plan-details-label">Actual Rows:</div><div class="plan-details-value">${operation.actualRows.toLocaleString()}</div>`;
        html += `<div class="plan-details-label">Actual Executions:</div><div class="plan-details-value">${operation.actualExecutions}</div>`;
    }
    
    if (operation.details.table) {
        html += `<div class="plan-details-label">Object:</div><div class="plan-details-value">${operation.details.schema}.${operation.details.table}</div>`;
    }
    if (operation.details.index) {
        html += `<div class="plan-details-label">Index:</div><div class="plan-details-value">${operation.details.index}</div>`;
    }
    
    html += '</div>';
    
    if (detailsPanel) {
        detailsPanel.innerHTML = html;
        detailsPanel.style.display = 'block';
    }
}

function displayTopOperations(planData) {
    const topOperationsContent = document.getElementById('topOperationsContent');
    
    if (!planData || !planData.topOperations || planData.topOperations.length === 0) {
        if (topOperationsContent) topOperationsContent.innerHTML = '<div class="no-results">No operations available</div>';
        return;
    }
    
    let html = '<table class="top-operations-table">';
    html += '<thead><tr>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'operation\')">Operation</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'cost\')">Estimated Cost %</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'subtreeCost\')">Estimated Subtree Cost</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'rows\')">Estimated Rows</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'executions\')">Estimated Executions</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'cpu\')">Estimated CPU Cost</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'io\')">Estimated I/O Cost</th>';
    html += '<th>Object</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    planData.topOperations.forEach(op => {
        const costPercent = planData.totalCost > 0 ? ((op.estimatedCost / planData.totalCost) * 100).toFixed(1) : 0;
        const objectName = op.details.table ? `${op.details.schema}.${op.details.table}` : '-';
        
        html += '<tr>';
        html += `<td>${op.physicalOp}</td>`;
        html += `<td>${costPercent}%</td>`;
        html += `<td>${op.estimatedSubtreeCost.toFixed(4)}</td>`;
        html += `<td>${op.estimatedRows.toLocaleString()}</td>`;
        html += `<td>${op.estimatedExecutions}</td>`;
        html += `<td>${op.estimatedCPU.toFixed(6)}</td>`;
        html += `<td>${op.estimatedIO.toFixed(6)}</td>`;
        html += `<td>${objectName}</td>`;
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    if (topOperationsContent) topOperationsContent.innerHTML = html;
}

function selectPlanNode(opId) {
    // Remove previous selection
    document.querySelectorAll('.plan-node.selected').forEach(node => {
        node.classList.remove('selected');
    });
    
    // Select new node
    const node = document.querySelector(`.plan-node[data-op-id="${opId}"]`);
    if (node) {
        node.classList.add('selected');
    }
    
    // Show details - find operation in hierarchicalOperations
    let operation = null;
    if (window.currentQueryPlan && window.currentQueryPlan.hierarchicalOperations) {
        operation = window.currentQueryPlan.hierarchicalOperations.find(op => op.id === opId);
    } else if (window.currentQueryPlan && window.currentQueryPlan.operations) {
        operation = window.currentQueryPlan.operations.find(op => op.id === opId);
    }
    
    if (operation) {
        displayOperationDetails(operation);
    }
}

// Make functions available globally
window.showQueryPlan = showQueryPlan;
window.parseQueryPlan = parseQueryPlan;
window.displayQueryPlanGraphical = displayQueryPlanGraphical;
window.displayPlanTree = displayPlanTree;
window.displayTopOperations = displayTopOperations;
window.selectPlanNode = selectPlanNode;

// Sorting function for top operations (simple implementation)
window.sortTopOperations = function(column) {
    // This is a placeholder - in a full implementation, you would re-sort and re-render
    console.log('Sort by:', column);
};
