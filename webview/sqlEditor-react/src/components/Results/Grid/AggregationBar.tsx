import { useMemo } from 'react';
import './AggregationBar.css';

interface AggregationBarProps {
  /** Selected cell values to aggregate */
  selectedValues: unknown[];
  /** Whether to show the bar */
  visible: boolean;
}

interface AggregationResult {
  count: number;
  numericCount: number;
  sum: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
  nullCount: number;
}

function calculateAggregations(values: unknown[]): AggregationResult {
  const numericValues: number[] = [];
  let nullCount = 0;
  
  for (const val of values) {
    if (val === null || val === undefined) {
      nullCount++;
      continue;
    }
    
    const num = Number(val);
    if (!isNaN(num) && typeof val !== 'boolean') {
      numericValues.push(num);
    }
  }
  
  const count = values.length;
  const numericCount = numericValues.length;
  
  if (numericCount === 0) {
    return {
      count,
      numericCount: 0,
      sum: null,
      average: null,
      min: null,
      max: null,
      nullCount,
    };
  }
  
  const sum = numericValues.reduce((a, b) => a + b, 0);
  const average = sum / numericCount;
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  
  return {
    count,
    numericCount,
    sum,
    average,
    min,
    max,
    nullCount,
  };
}

function formatNumber(value: number | null): string {
  if (value === null) return '-';
  
  // Format with appropriate precision
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  
  // For decimals, show up to 4 decimal places
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function AggregationBar({ selectedValues, visible }: AggregationBarProps) {
  const aggregations = useMemo(() => {
    if (!visible || selectedValues.length === 0) {
      return null;
    }
    return calculateAggregations(selectedValues);
  }, [selectedValues, visible]);
  
  if (!visible || !aggregations || aggregations.count === 0) {
    return null;
  }
  
  const hasNumeric = aggregations.numericCount > 0;
  
  return (
    <div className="aggregation-bar" data-testid="aggregation-bar">
      <div className="aggregation-item">
        <span className="aggregation-label">Count:</span>
        <span className="aggregation-value">{aggregations.count}</span>
      </div>
      
      {aggregations.nullCount > 0 && (
        <div className="aggregation-item">
          <span className="aggregation-label">Nulls:</span>
          <span className="aggregation-value null-value">{aggregations.nullCount}</span>
        </div>
      )}
      
      {hasNumeric && (
        <>
          <div className="aggregation-separator" />
          
          <div className="aggregation-item">
            <span className="aggregation-label">Sum:</span>
            <span className="aggregation-value">{formatNumber(aggregations.sum)}</span>
          </div>
          
          <div className="aggregation-item">
            <span className="aggregation-label">Avg:</span>
            <span className="aggregation-value">{formatNumber(aggregations.average)}</span>
          </div>
          
          <div className="aggregation-item">
            <span className="aggregation-label">Min:</span>
            <span className="aggregation-value">{formatNumber(aggregations.min)}</span>
          </div>
          
          <div className="aggregation-item">
            <span className="aggregation-label">Max:</span>
            <span className="aggregation-value">{formatNumber(aggregations.max)}</span>
          </div>
        </>
      )}
    </div>
  );
}
