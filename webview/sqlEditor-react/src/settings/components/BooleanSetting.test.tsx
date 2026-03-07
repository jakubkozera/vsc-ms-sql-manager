import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../test/testUtils';
import { BooleanSetting } from './BooleanSetting';

describe('BooleanSetting', () => {
  it('renders label, description and switch state', () => {
    render(
      <BooleanSetting
        id="showStats"
        label="Show stats"
        description="Display table statistics"
        value={true}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('Show stats')).toBeInTheDocument();
    expect(screen.getByText('Display table statistics')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show stats' })).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange with inverted value when toggled', () => {
    const onChange = vi.fn();

    render(
      <BooleanSetting
        id="immediate"
        label="Immediate activation"
        description="Activate extension immediately"
        value={false}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Immediate activation' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('marks item as modified when isModified is true', () => {
    const { container } = render(
      <BooleanSetting
        id="reactUi"
        label="Use React UI"
        description="Toggle React UI"
        value={false}
        onChange={vi.fn()}
        isModified
      />
    );

    expect(container.querySelector('.setting-item')).toHaveClass('modified');
  });
});
