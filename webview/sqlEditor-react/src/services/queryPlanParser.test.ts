import { describe, it, expect } from 'vitest';
import {
  parseQueryPlan,
  getTopOperations,
  calculatePlanStats,
  getOperationStyle,
} from './queryPlanParser';

// Sample execution plan XML for testing
const samplePlanXml = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.6">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM Users WHERE Id = 1" StatementId="1">
          <QueryPlan CachedPlanSize="16" CompileTime="1" CompileCPU="1" CompileMemory="128">
            <RelOp NodeId="0" PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek"
                   EstimateRows="1" EstimatedRowsRead="1" EstimateIO="0.003125" EstimateCPU="0.0001581"
                   EstimatedTotalSubtreeCost="0.0032831">
              <IndexScan>
                <Object Database="TestDB" Schema="dbo" Table="Users" Index="PK_Users" />
                <SeekPredicates>
                  <ScalarOperator ScalarString="[TestDB].[dbo].[Users].[Id]=1" />
                </SeekPredicates>
              </IndexScan>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

const complexPlanXml = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.6">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT u.*, o.* FROM Users u JOIN Orders o ON u.Id = o.UserId" StatementId="1">
          <QueryPlan CachedPlanSize="32" CompileTime="5" CompileCPU="3" CompileMemory="256">
            <RelOp NodeId="0" PhysicalOp="Hash Match" LogicalOp="Inner Join"
                   EstimateRows="100" EstimateIO="0.1" EstimateCPU="0.05"
                   EstimatedTotalSubtreeCost="0.5">
              <Hash>
                <ProbeResidual>
                  <ScalarOperator ScalarString="[u].[Id]=[o].[UserId]" />
                </ProbeResidual>
              </Hash>
              <RelOp NodeId="1" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan"
                     EstimateRows="50" EstimateIO="0.05" EstimateCPU="0.02"
                     EstimatedTotalSubtreeCost="0.2">
                <IndexScan>
                  <Object Database="TestDB" Schema="dbo" Table="Users" Index="PK_Users" />
                </IndexScan>
              </RelOp>
              <RelOp NodeId="2" PhysicalOp="Index Scan" LogicalOp="Index Scan"
                     EstimateRows="200" EstimateIO="0.08" EstimateCPU="0.03"
                     EstimatedTotalSubtreeCost="0.25">
                <IndexScan>
                  <Object Database="TestDB" Schema="dbo" Table="Orders" Index="IX_Orders_UserId" />
                </IndexScan>
              </RelOp>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

const planWithWarningsXml = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.6">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM LargeTable" StatementId="1">
          <QueryPlan>
            <Warnings>
              <PlanAffectingConvert ConvertIssue="Cardinality Estimate" Expression="CONVERT_IMPLICIT(int,[@param])" />
            </Warnings>
            <RelOp NodeId="0" PhysicalOp="Table Scan" LogicalOp="Table Scan"
                   EstimateRows="1000000" EstimateIO="10.0" EstimateCPU="5.0"
                   EstimatedTotalSubtreeCost="15.0">
              <Warnings>
                <NoJoinPredicate />
              </Warnings>
              <TableScan>
                <Object Database="TestDB" Schema="dbo" Table="LargeTable" />
              </TableScan>
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

describe('queryPlanParser', () => {
  describe('parseQueryPlan', () => {
    it('parses simple execution plan', () => {
      const result = parseQueryPlan(samplePlanXml);
      
      expect(result.plans.length).toBe(1);
      expect(result.parseErrors.length).toBe(0);
      
      const plan = result.plans[0];
      expect(plan.statementText).toContain('SELECT * FROM Users');
      expect(plan.root.physicalOp).toBe('Clustered Index Seek');
      expect(plan.root.logicalOp).toBe('Clustered Index Seek');
      expect(plan.root.estimatedRows).toBe(1);
    });
    
    it('parses complex plan with joins', () => {
      const result = parseQueryPlan(complexPlanXml);
      
      expect(result.plans.length).toBe(1);
      
      const plan = result.plans[0];
      expect(plan.root.physicalOp).toBe('Hash Match');
      expect(plan.root.children.length).toBe(2);
      expect(plan.root.children[0].physicalOp).toBe('Clustered Index Scan');
      expect(plan.root.children[1].physicalOp).toBe('Index Scan');
    });
    
    it('extracts object information', () => {
      const result = parseQueryPlan(samplePlanXml);
      const plan = result.plans[0];
      
      expect(plan.root.object).toBeDefined();
      expect(plan.root.object?.table).toBe('Users');
      expect(plan.root.object?.schema).toBe('dbo');
      expect(plan.root.object?.index).toBe('PK_Users');
    });
    
    it('handles invalid XML', () => {
      const result = parseQueryPlan('<invalid>not valid xml');
      
      expect(result.plans.length).toBe(0);
      expect(result.parseErrors.length).toBeGreaterThan(0);
    });
    
    it('handles empty XML', () => {
      const result = parseQueryPlan('');
      
      expect(result.plans.length).toBe(0);
    });
    
    it('calculates estimated total cost', () => {
      const result = parseQueryPlan(samplePlanXml);
      const plan = result.plans[0];
      
      expect(plan.estimatedTotalCost).toBeGreaterThan(0);
    });
    
    it('parses plan with warnings', () => {
      const result = parseQueryPlan(planWithWarningsXml);
      
      expect(result.plans.length).toBe(1);
      const plan = result.plans[0];
      
      expect(plan.root.physicalOp).toBe('Table Scan');
      expect(plan.root.warnings).toBeDefined();
      expect(plan.root.warnings!.length).toBeGreaterThan(0);
    });
  });
  
  describe('getTopOperations', () => {
    it('returns operations sorted by cost', () => {
      const result = parseQueryPlan(complexPlanXml);
      const topOps = getTopOperations(result.plans[0], 10);
      
      expect(topOps.length).toBe(3);
      // Should be sorted by cost descending
      for (let i = 1; i < topOps.length; i++) {
        expect(topOps[i - 1].estimatedCost).toBeGreaterThanOrEqual(topOps[i].estimatedCost);
      }
    });
    
    it('limits number of operations returned', () => {
      const result = parseQueryPlan(complexPlanXml);
      const topOps = getTopOperations(result.plans[0], 2);
      
      expect(topOps.length).toBe(2);
    });
    
    it('returns empty array for empty plan', () => {
      const emptyPlan = {
        statementText: '',
        estimatedTotalCost: 0,
        root: {
          id: '0',
          nodeId: 0,
          physicalOp: 'Empty',
          logicalOp: 'Empty',
          estimatedRows: 0,
          estimatedCost: 0,
          estimatedSubtreeCost: 0,
          estimatedIO: 0,
          estimatedCPU: 0,
          children: [],
        },
        isActual: false,
        statementType: '',
      };
      
      const topOps = getTopOperations(emptyPlan, 10);
      expect(topOps.length).toBe(1);
    });
  });
  
  describe('calculatePlanStats', () => {
    it('counts total operations', () => {
      const result = parseQueryPlan(complexPlanXml);
      const stats = calculatePlanStats(result.plans[0]);
      
      expect(stats.totalOperations).toBe(3);
    });
    
    it('calculates max depth', () => {
      const result = parseQueryPlan(complexPlanXml);
      const stats = calculatePlanStats(result.plans[0]);
      
      expect(stats.maxDepth).toBe(1); // Root + one level of children
    });
    
    it('detects warnings', () => {
      const result = parseQueryPlan(planWithWarningsXml);
      const stats = calculatePlanStats(result.plans[0]);
      
      expect(stats.hasWarnings).toBe(true);
    });
    
    it('counts operation types', () => {
      const result = parseQueryPlan(complexPlanXml);
      const stats = calculatePlanStats(result.plans[0]);
      
      expect(stats.indexScans).toBe(2);
      expect(stats.hashJoins).toBe(1);
    });
    
    it('calculates estimated total rows', () => {
      const result = parseQueryPlan(complexPlanXml);
      const stats = calculatePlanStats(result.plans[0]);
      
      expect(stats.estimatedTotalRows).toBeGreaterThan(0);
    });
  });
  
  describe('getOperationStyle', () => {
    it('returns correct style for index seek', () => {
      const style = getOperationStyle('Clustered Index Seek');
      
      expect(style.icon).toBeDefined();
      expect(style.color).toBe('#4caf50'); // Green for seeks
      expect(style.category).toBe('Seek');
    });
    
    it('returns correct style for index scan', () => {
      const style = getOperationStyle('Clustered Index Scan');
      
      expect(style.color).toBe('#ff9800'); // Orange for scans
      expect(style.category).toBe('Scan');
    });
    
    it('returns correct style for table scan', () => {
      const style = getOperationStyle('Table Scan');
      
      expect(style.color).toBe('#f44336'); // Red for table scans
      expect(style.category).toBe('Table Scan');
    });
    
    it('returns correct style for hash match', () => {
      const style = getOperationStyle('Hash Match');
      
      expect(style.category).toBe('Hash Join');
    });
    
    it('returns correct style for nested loops', () => {
      const style = getOperationStyle('Nested Loops');

      expect(style.category).toBe('Nested Loops');
    });
    
    it('returns default style for unknown operation', () => {
      const style = getOperationStyle('Unknown Operation XYZ');
      
      expect(style.icon).toBeDefined();
      expect(style.color).toBeDefined();
      expect(style.category).toBe('Other');
    });
  });
});
