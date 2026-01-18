/**
 * Query Plan Parser - parses SQL Server execution plan XML into structured data
 */

export interface PlanNode {
  id: string;
  nodeId: number;
  physicalOp: string;
  logicalOp: string;
  estimatedRows: number;
  actualRows?: number;
  estimatedCost: number;
  estimatedSubtreeCost: number;
  estimatedIO: number;
  estimatedCPU: number;
  actualElapsedMs?: number;
  warnings?: string[];
  outputList?: string[];
  object?: {
    database?: string;
    schema?: string;
    table?: string;
    index?: string;
    alias?: string;
  };
  seekPredicates?: string;
  predicate?: string;
  children: PlanNode[];
  // Layout properties
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface QueryPlan {
  statementText: string;
  statementType: string;
  queryHash?: string;
  compiletime?: number;
  estimatedTotalCost: number;
  root: PlanNode;
  isActual: boolean;
  cachedPlanSize?: number;
  compileMemory?: number;
  compileCPU?: number;
}

export interface ParsedPlanResult {
  plans: QueryPlan[];
  parseErrors: string[];
  error?: string;
}

let nodeCounter = 0;

/**
 * Parse SQL Server execution plan XML
 */
export function parseQueryPlan(xml: string): ParsedPlanResult {
  const result: ParsedPlanResult = {
    plans: [],
    parseErrors: [],
  };
  
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    
    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      result.parseErrors.push(`XML Parse Error: ${parseError.textContent}`);
      return result;
    }
    
    // Find all StmtSimple elements (each represents a statement in the batch)
    const statements = doc.querySelectorAll('StmtSimple');
    
    nodeCounter = 0;
    
    statements.forEach((stmt) => {
      const plan = parseStatement(stmt);
      if (plan) {
        result.plans.push(plan);
      }
    });
    
    // If no statements found, try to parse as a single query plan
    if (result.plans.length === 0) {
      const queryPlan = doc.querySelector('QueryPlan');
      if (queryPlan) {
        const plan = parseSinglePlan(queryPlan, '', 'SELECT');
        if (plan) {
          result.plans.push(plan);
        }
      }
    }
    
  } catch (error) {
    result.parseErrors.push(`Parse Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return result;
}

function parseStatement(stmt: Element): QueryPlan | null {
  const statementText = stmt.getAttribute('StatementText') || '';
  const statementType = stmt.getAttribute('StatementType') || 'UNKNOWN';
  const queryHash = stmt.getAttribute('QueryHash') || undefined;
  
  const queryPlan = stmt.querySelector('QueryPlan');
  if (!queryPlan) {
    return null;
  }
  
  return parseSinglePlan(queryPlan, statementText, statementType, queryHash);
}

function parseSinglePlan(
  queryPlan: Element, 
  statementText: string, 
  statementType: string,
  queryHash?: string
): QueryPlan | null {
  const compiletime = parseFloat(queryPlan.getAttribute('CompileTime') || '0');
  const cachedPlanSize = parseInt(queryPlan.getAttribute('CachedPlanSize') || '0', 10);
  const compileMemory = parseInt(queryPlan.getAttribute('CompileMemory') || '0', 10);
  const compileCPU = parseInt(queryPlan.getAttribute('CompileCPU') || '0', 10);
  
  // Find the root RelOp
  const relOp = queryPlan.querySelector('RelOp');
  if (!relOp) {
    return null;
  }
  
  const root = parseRelOp(relOp);
  const isActual = queryPlan.querySelector('[ActualRows]') !== null;
  
  return {
    statementText,
    statementType,
    queryHash,
    compiletime,
    estimatedTotalCost: root.estimatedSubtreeCost,
    root,
    isActual,
    cachedPlanSize: cachedPlanSize || undefined,
    compileMemory: compileMemory || undefined,
    compileCPU: compileCPU || undefined,
  };
}

function parseRelOp(relOp: Element): PlanNode {
  nodeCounter++;
  const nodeId = parseInt(relOp.getAttribute('NodeId') || String(nodeCounter), 10);
  const physicalOp = relOp.getAttribute('PhysicalOp') || 'Unknown';
  const logicalOp = relOp.getAttribute('LogicalOp') || physicalOp;
  const estimatedRows = parseFloat(relOp.getAttribute('EstimateRows') || '0');
  const actualRows = relOp.getAttribute('ActualRows') 
    ? parseInt(relOp.getAttribute('ActualRows')!, 10) 
    : undefined;
  const estimatedCost = parseFloat(relOp.getAttribute('EstimatedTotalSubtreeCost') || '0');
  const estimatedSubtreeCost = estimatedCost;
  const estimatedIO = parseFloat(relOp.getAttribute('EstimateIO') || '0');
  const estimatedCPU = parseFloat(relOp.getAttribute('EstimateCPU') || '0');
  const actualElapsedMs = relOp.getAttribute('ActualElapsedms')
    ? parseInt(relOp.getAttribute('ActualElapsedms')!, 10)
    : undefined;
  
  // Parse warnings
  const warnings: string[] = [];
  const warningsEl = relOp.querySelector('Warnings');
  if (warningsEl) {
    warningsEl.querySelectorAll('*').forEach(w => {
      const warningType = w.tagName;
      if (warningType === 'NoJoinPredicate') {
        warnings.push('No Join Predicate');
      } else if (warningType === 'SpillToTempDb') {
        warnings.push('Spill to TempDb');
      } else if (warningType === 'ColumnsWithNoStatistics') {
        warnings.push('Missing Statistics');
      } else {
        warnings.push(warningType);
      }
    });
  }
  
  // Parse output list
  const outputList: string[] = [];
  const outputListEl = relOp.querySelector('OutputList');
  if (outputListEl) {
    outputListEl.querySelectorAll('ColumnReference').forEach(col => {
      const colName = col.getAttribute('Column') || '';
      const table = col.getAttribute('Table') || '';
      outputList.push(table ? `${table}.${colName}` : colName);
    });
  }
  
  // Parse object (for scans, seeks, etc.)
  let object: PlanNode['object'] | undefined;
  const objectEl = relOp.querySelector('Object');
  if (objectEl) {
    object = {
      database: objectEl.getAttribute('Database') || undefined,
      schema: objectEl.getAttribute('Schema') || undefined,
      table: objectEl.getAttribute('Table') || undefined,
      index: objectEl.getAttribute('Index') || undefined,
      alias: objectEl.getAttribute('Alias') || undefined,
    };
  }
  
  // Parse IndexScan/TableScan object
  const scanEl = relOp.querySelector('IndexScan, TableScan, ClusteredIndexScan, ClusteredIndexSeek, IndexSeek');
  if (scanEl && !object) {
    const scanObject = scanEl.querySelector('Object');
    if (scanObject) {
      object = {
        database: scanObject.getAttribute('Database') || undefined,
        schema: scanObject.getAttribute('Schema') || undefined,
        table: scanObject.getAttribute('Table') || undefined,
        index: scanObject.getAttribute('Index') || undefined,
        alias: scanObject.getAttribute('Alias') || undefined,
      };
    }
  }
  
  // Parse predicates
  let predicate: string | undefined;
  let seekPredicates: string | undefined;
  
  const predicateEl = relOp.querySelector('Predicate');
  if (predicateEl) {
    predicate = extractPredicateText(predicateEl);
  }
  
  const seekPredicateEl = relOp.querySelector('SeekPredicates');
  if (seekPredicateEl) {
    seekPredicates = extractPredicateText(seekPredicateEl);
  }
  
  // Parse children (nested RelOp elements)
  const children: PlanNode[] = [];
  
  relOp.querySelectorAll(':scope > * > RelOp, :scope > RelOp').forEach(childRelOp => {
    children.push(parseRelOp(childRelOp));
  });
  
  return {
    id: `node-${nodeId}`,
    nodeId,
    physicalOp,
    logicalOp,
    estimatedRows,
    actualRows,
    estimatedCost: estimatedIO + estimatedCPU,
    estimatedSubtreeCost,
    estimatedIO,
    estimatedCPU,
    actualElapsedMs,
    warnings: warnings.length > 0 ? warnings : undefined,
    outputList: outputList.length > 0 ? outputList : undefined,
    object,
    predicate,
    seekPredicates,
    children,
  };
}

function extractPredicateText(el: Element): string {
  const parts: string[] = [];
  
  el.querySelectorAll('ScalarOperator').forEach(scalar => {
    const scalarString = scalar.getAttribute('ScalarString');
    if (scalarString) {
      parts.push(scalarString);
    }
  });
  
  if (parts.length > 0) {
    return parts.join(' AND ');
  }
  
  // Fallback: extract column references
  el.querySelectorAll('ColumnReference').forEach(col => {
    const colName = col.getAttribute('Column') || '';
    const table = col.getAttribute('Table') || '';
    parts.push(table ? `${table}.${colName}` : colName);
  });
  
  return parts.join(', ');
}

/**
 * Get the top N most expensive operations
 */
export function getTopOperations(plan: QueryPlan, limit = 20): PlanNode[] {
  const operations: PlanNode[] = [];
  
  function collectNodes(node: PlanNode) {
    operations.push(node);
    node.children.forEach(collectNodes);
  }
  
  collectNodes(plan.root);
  
  // Sort by cost (descending)
  operations.sort((a, b) => b.estimatedCost - a.estimatedCost);
  
  return operations.slice(0, limit);
}

/**
 * Calculate plan statistics
 */
export function calculatePlanStats(plan: QueryPlan): {
  totalOperations: number;
  maxDepth: number;
  hasWarnings: boolean;
  estimatedTotalRows: number;
  indexScans: number;
  indexSeeks: number;
  tableScans: number;
  sorts: number;
  hashJoins: number;
  nestedLoops: number;
  mergeJoins: number;
  parallelism: boolean;
} {
  let totalOperations = 0;
  let maxDepth = 0;
  let hasWarnings = false;
  let totalEstimatedRows = 0;
  let indexScans = 0;
  let indexSeeks = 0;
  let tableScans = 0;
  let sorts = 0;
  let hashJoins = 0;
  let nestedLoops = 0;
  let mergeJoins = 0;
  
  function traverse(node: PlanNode, depth: number) {
    totalOperations++;
    maxDepth = Math.max(maxDepth, depth);
    totalEstimatedRows += node.estimatedRows;
    
    if (node.warnings && node.warnings.length > 0) {
      hasWarnings = true;
    }
    
    const op = node.physicalOp.toLowerCase();
    if (op.includes('index scan')) indexScans++;
    if (op.includes('index seek')) indexSeeks++;
    if (op.includes('table scan')) tableScans++;
    if (op.includes('sort')) sorts++;
    if (op.includes('hash')) hashJoins++;
    if (op.includes('nested loops')) nestedLoops++;
    if (op.includes('merge join')) mergeJoins++;
    
    node.children.forEach(child => traverse(child, depth + 1));
  }
  
  traverse(plan.root, 0);
  
  return {
    totalOperations,
    maxDepth,
    hasWarnings,
    estimatedTotalRows: totalEstimatedRows,
    indexScans,
    indexSeeks,
    tableScans,
    sorts,
    hashJoins,
    nestedLoops,
    mergeJoins,
    parallelism: false, // TODO: detect parallelism from plan
  };
}

/**
 * Get icon/color for operation type
 */
export function getOperationStyle(physicalOp: string): {
  icon: string;
  color: string;
  category: string;
} {
  const op = physicalOp.toLowerCase();
  
  if (op.includes('clustered index seek') || op.includes('index seek')) {
    return { icon: '🎯', color: '#4caf50', category: 'Seek' };
  }
  if (op.includes('clustered index scan') || op.includes('index scan')) {
    return { icon: '📋', color: '#ff9800', category: 'Scan' };
  }
  if (op.includes('table scan')) {
    return { icon: '📋', color: '#f44336', category: 'Table Scan' };
  }
  if (op.includes('hash match') || op.includes('hash join')) {
    return { icon: '🔗', color: '#9c27b0', category: 'Hash Join' };
  }
  if (op.includes('nested loops')) {
    return { icon: '🔄', color: '#2196f3', category: 'Nested Loops' };
  }
  if (op.includes('merge join')) {
    return { icon: '🔀', color: '#00bcd4', category: 'Merge Join' };
  }
  if (op.includes('sort')) {
    return { icon: '📊', color: '#ff5722', category: 'Sort' };
  }
  if (op.includes('compute scalar')) {
    return { icon: '🔢', color: '#607d8b', category: 'Compute' };
  }
  if (op.includes('filter')) {
    return { icon: '🔍', color: '#795548', category: 'Filter' };
  }
  if (op.includes('aggregate') || op.includes('stream aggregate') || op.includes('hash aggregate')) {
    return { icon: '∑', color: '#673ab7', category: 'Aggregate' };
  }
  if (op.includes('parallelism')) {
    return { icon: '⚡', color: '#ffc107', category: 'Parallelism' };
  }
  if (op.includes('key lookup') || op.includes('rid lookup')) {
    return { icon: '🔑', color: '#e91e63', category: 'Lookup' };
  }
  if (op.includes('top')) {
    return { icon: '⬆️', color: '#03a9f4', category: 'Top' };
  }
  if (op.includes('insert') || op.includes('update') || op.includes('delete')) {
    return { icon: '✏️', color: '#ff5722', category: 'DML' };
  }
  if (op.includes('select')) {
    return { icon: '📤', color: '#4caf50', category: 'Select' };
  }
  
  return { icon: '⚙️', color: '#9e9e9e', category: 'Other' };
}
