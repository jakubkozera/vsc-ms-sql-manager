import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../test/testUtils';
import { SelectSetting } from './SelectSetting';

describe('SelectSetting', () => {
  const options = [
    { value: 'upper', label: 'UPPER' },
    { value: 'lower', label: 'lower' },
  ];

  it('renders select with provided options', () => {
    render(
      <SelectSetting
        id="keywordCase"
        label="Keyword Case"
        description="Case for SQL keywords"
        value="upper"
        options={options}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Keyword Case')).toBeInTheDocument();
    expect(screen.getByText('UPPER')).toBeInTheDocument();
    expect(screen.getByText('lower')).toBeInTheDocument();
  });

  it('calls onChange with selected value', () => {
    const onChange = vi.fn();

    render(
      <SelectSetting
        id="dataTypeCase"
        label="Data Type Case"
        description="Case for SQL data types"
        value="upper"
        options={options}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Data Type Case'), { target: { value: 'lower' } });
    expect(onChange).toHaveBeenCalledWith('lower');
  });

  it('marks item as modified when isModified is true', () => {
    const { container } = render(
      <SelectSetting
        id="functionCase"
        label="Function Case"
        description="Case for SQL functions"
        value="upper"
        options={options}
        onChange={vi.fn()}
        isModified
      />
    );

    expect(container.querySelector('.setting-item')).toHaveClass('modified');
  });
});
