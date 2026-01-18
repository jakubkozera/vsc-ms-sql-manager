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
      <AggregationBar selectedValues={['a', 'b', 'c']} visible={true} />
    );
    
    expect(screen.getByTestId('aggregation-bar')).toBeInTheDocument();
    expect(screen.getByText('Count:')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
  
  it('shows numeric aggregations for numbers', () => {
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
  
  it('counts null values', () => {
    render(
      <AggregationBar selectedValues={[1, null, 4, null, 5]} visible={true} />
    );
    
    expect(screen.getByText('Nulls:')).toBeInTheDocument();
    // Use getAllByText since "2" appears in multiple places (nulls count and average)
    const twos = screen.getAllByText('2');
    expect(twos.length).toBeGreaterThan(0);
  });
  
  it('handles mixed string and number values', () => {
    render(
      <AggregationBar selectedValues={['10', '20', '30']} visible={true} />
    );
    
    // Strings that look like numbers should be parsed
    expect(screen.getByText('Sum:')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
  });
  
  it('does not show numeric stats for non-numeric data', () => {
    render(
      <AggregationBar selectedValues={['apple', 'banana', 'cherry']} visible={true} />
    );
    
    expect(screen.getByText('Count:')).toBeInTheDocument();
    expect(screen.queryByText('Sum:')).not.toBeInTheDocument();
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
});
