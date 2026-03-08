import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../test/testUtils';
import { FormattingPreview } from './FormattingPreview';
import { defaultSettings } from '../types';

vi.mock('@monaco-editor/react', () => ({
  default: (props: any) => (
    <pre data-testid="format-preview-editor">{props.value}</pre>
  ),
}));

describe('FormattingPreview', () => {
  const formattingSettings = {
    tabWidth: defaultSettings.tabWidth,
    keywordCase: defaultSettings.keywordCase,
    dataTypeCase: defaultSettings.dataTypeCase,
    functionCase: defaultSettings.functionCase,
    linesBetweenQueries: defaultSettings.linesBetweenQueries,
    indentStyle: defaultSettings.indentStyle,
    logicalOperatorNewline: defaultSettings.logicalOperatorNewline,
  } as const;

  it('renders SQL preview editor with formatted content', () => {
    render(<FormattingPreview settings={formattingSettings} />);

    expect(screen.getByText('Live SQL Preview')).toBeInTheDocument();
    const preview = screen.getByTestId('format-preview-editor');
    expect(preview.textContent).toContain('SELECT');
    expect(preview.textContent).toContain('FROM');
  });

  it('updates preview when formatting options change', () => {
    const { rerender } = render(<FormattingPreview settings={formattingSettings} />);
    const before = screen.getByTestId('format-preview-editor').textContent || '';

    rerender(
      <FormattingPreview
        settings={{
          ...formattingSettings,
          keywordCase: 'lower',
        }}
      />
    );

    const after = screen.getByTestId('format-preview-editor').textContent || '';
    expect(after).not.toEqual(before);
    expect(after).toContain('select');
    expect(after).toContain('from');
  });

  it('switches preview source SQL when another sample is selected', () => {
    render(<FormattingPreview settings={formattingSettings} />);

    fireEvent.click(screen.getByRole('tab', { name: 'DDL + Procedure' }));

    const preview = screen.getByTestId('format-preview-editor').textContent || '';
    expect(preview).toContain('CREATE TABLE');
    expect(preview).toContain('CREATE OR ALTER PROCEDURE');
  });
});
