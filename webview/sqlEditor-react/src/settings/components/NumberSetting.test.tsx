import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../test/testUtils';
import { NumberSetting } from './NumberSetting';

describe('NumberSetting', () => {
  it('renders label and description', () => {
    render(
      <NumberSetting
        id="timeout"
        label="Query Timeout"
        description="Timeout in seconds"
        value={30}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Query Timeout')).toBeInTheDocument();
    expect(screen.getByText('Timeout in seconds')).toBeInTheDocument();
  });

  it('calls onChange with parsed number', () => {
    const onChange = vi.fn();

    render(
      <NumberSetting
        id="indent"
        label="Indent"
        description="Indent width"
        value={2}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Indent'), { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('falls back to 0 for invalid number input', () => {
    const onChange = vi.fn();

    render(
      <NumberSetting
        id="lines"
        label="Lines"
        description="Lines between queries"
        value={1}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Lines'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(0);
  });
});
