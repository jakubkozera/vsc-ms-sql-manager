import { useMemo } from 'react';
import './AggregationBar.css';

interface AggregationBarProps {
  /** Selected cell values to aggregate */
  selectedValues: unknown[];
  /** Whether to show the bar */
  visible: boolean;
  /** SQL column type for type-aware stats */
  columnType?: string;
  /** Right-align the bar contents */
  rightAlign?: boolean;
}

type DataCategory = 'numeric' | 'boolean' | 'datetime' | 'text' | 'binary' | 'unknown';

function getDataTypeCategory(sqlType: string | undefined): DataCategory {
  if (!sqlType) return 'unknown';
  const type = sqlType.toLowerCase();
  if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(type)) return 'numeric';
  if (type === 'bit') return 'boolean';
  if (['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'].includes(type)) return 'datetime';
  if (['char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext'].includes(type)) return 'text';
  if (['binary', 'varbinary', 'image'].includes(type)) return 'binary';
  return 'text';
}

interface AggregationResult {
  count: number;
  nullCount: number;
  category: DataCategory;
  // Numeric
  sum?: number;
  average?: number;
  min?: number;
  max?: number;
  // Text
  distinct?: number;
  minLength?: number;
  maxLength?: number;
  // Boolean
  trueCount?: number;
  falseCount?: number;
  // DateTime
  dateMin?: string;
  dateMin2?: string | null;
  dateMax?: string;
  dateRange?: string;
}

function calculateAggregations(values: unknown[], columnType?: string): AggregationResult {
  let nullCount = 0;
  const nonNullValues: unknown[] = [];

  for (const val of values) {
    if (val === null || val === undefined) {
      nullCount++;
    } else {
      nonNullValues.push(val);
    }
  }

  let category = getDataTypeCategory(columnType);
  
  // Auto-detect category when SQL type is unknown
  if (category === 'unknown' && nonNullValues.length > 0) {
    // Check if all non-null values are numeric (or numeric strings)
    const allNumeric = nonNullValues.every(v => {
      if (typeof v === 'boolean') return false;
      const num = Number(v);
      return !isNaN(num) && v !== '';
    });
    if (allNumeric) {
      category = 'numeric';
    }
  }

  const base: AggregationResult = { count: nonNullValues.length, nullCount, category };

  if (nonNullValues.length === 0) return base;

  if (category === 'numeric') {
    const nums: number[] = [];
    for (const val of nonNullValues) {
      const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
      if (!isNaN(num)) nums.push(num);
    }
    if (nums.length > 0) {
      base.sum = nums.reduce((a, b) => a + b, 0);
      base.average = base.sum / nums.length;
      base.min = Math.min(...nums);
      base.max = Math.max(...nums);
    }
  } else if (category === 'boolean') {
    let trueCount = 0, falseCount = 0;
    for (const val of nonNullValues) {
      if (val === true || val === 1 || String(val).toLowerCase() === 'true') trueCount++;
      else if (val === false || val === 0 || String(val).toLowerCase() === 'false') falseCount++;
    }
    base.trueCount = trueCount;
    base.falseCount = falseCount;
  } else if (category === 'datetime') {
    const dates = nonNullValues.map(v => v instanceof Date ? v : new Date(v as string)).filter(d => !isNaN(d.getTime()));
    if (dates.length > 0) {
      const timestamps = dates.map(d => d.getTime()).sort((a, b) => a - b);
      const minDate = new Date(timestamps[0]);
      const maxDate = new Date(timestamps[timestamps.length - 1]);
      const defaultDateThreshold = new Date('0001-01-02').getTime();
      const isMinDefault = timestamps[0] < defaultDateThreshold;

      let min2: Date | null = null;
      let rangeStart = minDate;
      if (isMinDefault && timestamps.length > 1) {
        for (let i = 1; i < timestamps.length; i++) {
          if (timestamps[i] >= defaultDateThreshold) {
            min2 = new Date(timestamps[i]);
            rangeStart = min2;
            break;
          }
        }
      }

      const totalDays = Math.ceil((maxDate.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24));
      let rangeText: string;
      if (totalDays >= 365) {
        const years = Math.floor(totalDays / 365);
        const remainingDays = totalDays % 365;
        rangeText = years === 1 ? `1 year ${remainingDays} days` : `${years} years ${remainingDays} days`;
      } else {
        rangeText = `${totalDays} days`;
      }

      base.dateMin = minDate.toISOString().slice(0, 19).replace('T', ' ');
      base.dateMin2 = min2 ? min2.toISOString().slice(0, 19).replace('T', ' ') : null;
      base.dateMax = maxDate.toISOString().slice(0, 19).replace('T', ' ');
      base.dateRange = rangeText;
    }
  } else if (category === 'text') {
    const distinctValues = new Set(nonNullValues.map(v => String(v)));
    const lengths = nonNullValues.map(v => String(v).length);
    base.distinct = distinctValues.size;
    base.minLength = Math.min(...lengths);
    base.maxLength = Math.max(...lengths);
  } else {
    // Unknown/mixed - show distinct only
    const distinctValues = new Set(nonNullValues.map(v => String(v)));
    base.distinct = distinctValues.size;
  }

  return base;
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

export function AggregationBar({ selectedValues, visible, columnType, rightAlign }: AggregationBarProps) {
  const aggregations = useMemo(() => {
    if (!visible || selectedValues.length === 0) {
      return null;
    }
    return calculateAggregations(selectedValues, columnType);
  }, [selectedValues, visible, columnType]);
  
  if (!visible || !aggregations || (aggregations.count === 0 && aggregations.nullCount === 0)) {
    return null;
  }
  
  return (
    <div className={`aggregation-bar${rightAlign ? ' aggregation-bar--right' : ''}`} data-testid="aggregation-bar">
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
      
      {aggregations.category === 'numeric' && aggregations.sum !== undefined && (
        <>
          <div className="aggregation-separator" />
          <div className="aggregation-item">
            <span className="aggregation-label">Sum:</span>
            <span className="aggregation-value">{formatNumber(aggregations.sum)}</span>
          </div>
          <div className="aggregation-item">
            <span className="aggregation-label">Avg:</span>
            <span className="aggregation-value">{formatNumber(aggregations.average!)}</span>
          </div>
          <div className="aggregation-item">
            <span className="aggregation-label">Min:</span>
            <span className="aggregation-value">{formatNumber(aggregations.min!)}</span>
          </div>
          <div className="aggregation-item">
            <span className="aggregation-label">Max:</span>
            <span className="aggregation-value">{formatNumber(aggregations.max!)}</span>
          </div>
        </>
      )}

      {aggregations.category === 'text' && aggregations.distinct !== undefined && (
        <>
          <div className="aggregation-separator" />
          <div className="aggregation-item">
            <span className="aggregation-label">Distinct:</span>
            <span className="aggregation-value">{aggregations.distinct}</span>
          </div>
          <div className="aggregation-item">
            <span className="aggregation-label">Min Length:</span>
            <span className="aggregation-value">{aggregations.minLength}</span>
          </div>
          <div className="aggregation-item">
            <span className="aggregation-label">Max Length:</span>
            <span className="aggregation-value">{aggregations.maxLength}</span>
          </div>
        </>
      )}

      {aggregations.category === 'boolean' && aggregations.trueCount !== undefined && (
        <>
          <div className="aggregation-separator" />
          <div className="aggregation-item">
            <span className="aggregation-label">True:</span>
            <span className="aggregation-value">{aggregations.trueCount}</span>
          </div>
          <div className="aggregation-item">
            <span className="aggregation-label">False:</span>
            <span className="aggregation-value">{aggregations.falseCount}</span>
          </div>
        </>
      )}

      {aggregations.category === 'datetime' && aggregations.dateMin !== undefined && (
        <>
          <div className="aggregation-separator" />
          <div className="aggregation-item">
            <span className="aggregation-label">Min:</span>
            <span className="aggregation-value">{aggregations.dateMin}</span>
          </div>
          {aggregations.dateMin2 && (
            <div className="aggregation-item">
              <span className="aggregation-label">Min2:</span>
              <span className="aggregation-value">{aggregations.dateMin2}</span>
            </div>
          )}
          <div className="aggregation-item">
            <span className="aggregation-label">Max:</span>
            <span className="aggregation-value">{aggregations.dateMax}</span>
          </div>
          <div className="aggregation-item">
            <span className="aggregation-label">Range:</span>
            <span className="aggregation-value">{aggregations.dateRange}</span>
          </div>
        </>
      )}

      {aggregations.category === 'unknown' && aggregations.distinct !== undefined && (
        <>
          <div className="aggregation-separator" />
          <div className="aggregation-item">
            <span className="aggregation-label">Distinct:</span>
            <span className="aggregation-value">{aggregations.distinct}</span>
          </div>
        </>
      )}
    </div>
  );
}
