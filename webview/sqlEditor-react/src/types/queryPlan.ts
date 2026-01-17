// Query Plan Types

export interface QueryPlanData {
  operations: PlanOperation[];
  hierarchicalOperations: PlanOperation[];
  topOperations: PlanOperation[];
  totalCost: number;
}

export interface PlanOperation {
  id: number;
  level: number;
  parent: PlanOperation | null;
  physicalOp: string;
  logicalOp: string;
  estimatedCost: number;
  estimatedRows: number;
  estimatedSubtreeCost: number;
  estimatedCPU: number;
  estimatedIO: number;
  avgRowSize: number;
  estimatedExecutions: number;
  actualRows: number;
  actualExecutions: number;
  children: PlanOperation[];
  details: PlanOperationDetails;
}

export interface PlanOperationDetails {
  statement?: string;
  table?: string;
  index?: string;
  schema?: string;
  predicate?: string;
  seekPredicate?: string;
  outputList?: string[];
}

export type PlanViewMode = 'graphical' | 'tree' | 'topOperations';
