import { describe, it, expect } from 'vitest';
import { render, screen } from '../../../test/testUtils';
import { AggregationBar } from './AggregationBar';

describe('AggregationBar', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(
      <AggregationBar selectedValues={[1, 2, 3]} visible={false} />
    );
    
    expect(container.firstChild).toBeNull();
  });
  
  it('renders nothing when no values selected', () => {
    const { container } = render(
      <AggregationBar selectedValues={[]} visible={true} />
    );
    
    expect(container.firstChild).toBeNull();
  });
  
  it('shows count for any values', () => {
    render(
      <AggregationBar selectedValues={['a', 'b', 'c', 'a']} visible={true} />
    );
    
    expect(screen.getByTestId('aggregation-bar')).toBeInTheDocument();
    expect(screen.getByText('Count:')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
  
  it('shows numeric aggregations for numbers (auto-detected)', () => {
    render(
      <AggregationBar selectedValues={[10, 20, 30]} visible={true} />
    );
    
    expect(screen.getByText('Sum:')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    
    expect(screen.getByText('Avg:')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    
    expect(screen.getByText('Min:')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    
    expect(screen.getByText('Max:')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('shows numeric aggregations with explicit int column type', () => {
    render(
      <AggregationBar selectedValues={[10, 20, 30]} visible={true} columnType="int" />
    );
    
    expect(screen.getByText('Sum:')).toBeInTheDocument();
    expect(screen.getByText('Avg:')).toBeInTheDocument();
    expect(screen.getByText('Min:')).toBeInTheDocument();
    expect(screen.getByText('Max:')).toBeInTheDocument();
  });
  
  it('counts null values', () => {
    render(
      <AggregationBar selectedValues={[1, null, 4, null, 5]} visible={true} />
    );
    
    expect(screen.getByText('Nulls:')).toBeInTheDocument();
    // Use getAllByText since "2" appears in multiple places (nulls count and average)
    const twos = screen.getAllByText('2');
    expect(twos.length).toBeGreaterThan(0);
  });
  
  it('handles mixed string and number values (auto-detect numeric)', () => {
    render(
      <AggregationBar selectedValues={['10', '20', '30']} visible={true} />
    );
    
    // Strings that look like numbers should be parsed
    expect(screen.getByText('Sum:')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
  });
  
  it('shows text stats for non-numeric data with varchar type', () => {
    render(
      <AggregationBar selectedValues={['apple', 'banana', 'cherry', 'apple']} visible={true} columnType="varchar" />
    );
    
    expect(screen.getByText('Count:')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument(); // count is 4
    expect(screen.getByText('Distinct:')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // 3 distinct values
    expect(screen.getByText('Min Length:')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // "apple"
    expect(screen.getByText('Max Length:')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument(); // "banana" or "cherry"
    expect(screen.queryByText('Sum:')).not.toBeInTheDocument();
  });

  it('shows text stats with duplicate values', () => {
    render(
      <AggregationBar selectedValues={['hello', 'world', 'hello', 'world', 'test']} visible={true} columnType="nvarchar" />
    );
    
    expect(screen.getByText('Distinct:')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // 3 distinct values
  });

  it('shows boolean stats for bit type', () => {
    render(
      <AggregationBar selectedValues={[true, true, false, true, false]} visible={true} columnType="bit" />
    );
    
    expect(screen.getByText('True:')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('False:')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('Sum:')).not.toBeInTheDocument();
  });

  it('shows boolean stats with numeric boolean representations', () => {
    render(
      <AggregationBar selectedValues={[1, 0, 1, 1, 0]} visible={true} columnType="bit" />
    );
    
    expect(screen.getByText('True:')).toBeInTheDocument();
    expect(screen.getByText('False:')).toBeInTheDocument();
  });

  it('shows datetime stats for datetime type', () => {
    render(
      <AggregationBar 
        selectedValues={['2024-01-15T10:00:00', '2024-06-20T12:00:00', '2024-12-25T08:00:00']} 
        visible={true} 
        columnType="datetime" 
      />
    );
    
    expect(screen.getByText('Min:')).toBeInTheDocument();
    expect(screen.getByText('Max:')).toBeInTheDocument();
    expect(screen.getByText('Range:')).toBeInTheDocument();
    expect(screen.queryByText('Sum:')).not.toBeInTheDocument();
  });

  it('shows distinct count for unknown type with non-numeric values', () => {
    render(
      <AggregationBar selectedValues={['apple', 'banana', 'cherry']} visible={true} />
    );
    
    // Without columnType, non-numeric data gets 'unknown' category
    // 'unknown' with non-numeric auto-detection fails, so falls through
    expect(screen.getByText('Count:')).toBeInTheDocument();
  });
  
  it('formats large numbers with locale', () => {
    render(
      <AggregationBar selectedValues={[1000000]} visible={true} />
    );
    
    // The number should be formatted with locale-specific separators
    // Different locales use different separators (comma, period, space, etc.)
    const sumValue = screen.getByText('Sum:').nextSibling;
    expect(sumValue?.textContent).toMatch(/1[\s,.]?000[\s,.]?000/);
  });
  
  it('handles decimal numbers', () => {
    render(
      <AggregationBar selectedValues={[1.5, 2.5, 3.5]} visible={true} />
    );
    
    // Sum should be 7.5
    expect(screen.getByText('Sum:')).toBeInTheDocument();
    // Average should be 2.5
    expect(screen.getByText('Avg:')).toBeInTheDocument();
  });

  it('handles all null values', () => {
    render(
      <AggregationBar selectedValues={[null, null, null]} visible={true} />
    );
    
    expect(screen.getByText('Nulls:')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
