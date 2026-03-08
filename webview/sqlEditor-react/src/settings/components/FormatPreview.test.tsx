import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '../../test/testUtils';
import { FormatPreview } from './FormatPreview';
import type { FormatPreviewSettings } from './FormatPreview';

// ---------------------------------------------------------------------------
// Shared mock objects — must be created via vi.hoisted so they are available
// inside the vi.mock() factory which is hoisted before imports.
// ---------------------------------------------------------------------------
const { mockSetValue } = vi.hoisted(() => ({
  mockSetValue: vi.fn(),
}));

vi.mock('@monaco-editor/react', () => ({
  default: (props: { defaultValue?: string; onMount?: (editor: unknown) => void }) => {
    // Simulate Monaco calling onMount after mount (async, like the real library)
    if (props.onMount) {
      Promise.resolve().then(() => props.onMount!({ setValue: mockSetValue }));
    }
    return React.createElement('div', {
      'data-testid': 'monaco-preview',
      'data-value': props.defaultValue ?? '',
    });
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const defaultSettings: FormatPreviewSettings = {
  tabWidth: 2,
  keywordCase: 'upper',
  dataTypeCase: 'upper',
  functionCase: 'upper',
  linesBetweenQueries: 1,
  indentStyle: 'standard',
  logicalOperatorNewline: 'before',
};

function getEditorValue(): string {
  return screen.getByTestId('monaco-preview').getAttribute('data-value') ?? '';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('FormatPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "Live Preview" header', () => {
    render(<FormatPreview settings={defaultSettings} />);
    expect(screen.getByText('Live Preview')).toBeInTheDocument();
  });

  it('renders a Monaco editor placeholder', () => {
    render(<FormatPreview settings={defaultSettings} />);
    expect(screen.getByTestId('monaco-preview')).toBeInTheDocument();
  });

  it('passes non-empty formatted SQL as defaultValue to Monaco', () => {
    render(<FormatPreview settings={defaultSettings} />);
    expect(getEditorValue().length).toBeGreaterThan(0);
  });

  // ---- keyword case ------------------------------------------------
  it('uppercases SQL keywords when keywordCase=upper', () => {
    render(<FormatPreview settings={defaultSettings} />);
    const value = getEditorValue();
    expect(value).toContain('SELECT');
    expect(value).toContain('FROM');
    expect(value).toContain('WHERE');
    expect(value).toContain('JOIN');
  });

  it('lowercases SQL keywords when keywordCase=lower', () => {
    render(<FormatPreview settings={{ ...defaultSettings, keywordCase: 'lower' }} />);
    const value = getEditorValue();
    expect(value).toContain('select');
    expect(value).toContain('from');
    expect(value).not.toContain('SELECT');
  });

  // ---- data type case ---------------------------------------------
  it('uppercases data types when dataTypeCase=upper', () => {
    render(<FormatPreview settings={defaultSettings} />);
    expect(getEditorValue()).toContain('DECIMAL');
  });

  it('lowercases data types when dataTypeCase=lower', () => {
    render(<FormatPreview settings={{ ...defaultSettings, dataTypeCase: 'lower' }} />);
    const value = getEditorValue();
    expect(value).toContain('decimal');
    expect(value).not.toContain('DECIMAL');
  });

  // ---- function case -----------------------------------------------
  it('uppercases function names when functionCase=upper', () => {
    render(<FormatPreview settings={defaultSettings} />);
    const value = getEditorValue();
    expect(value).toContain('COUNT');
    expect(value).toContain('ISNULL');
    expect(value).toContain('GETDATE');
  });

  it('lowercases function names when functionCase=lower', () => {
    render(<FormatPreview settings={{ ...defaultSettings, functionCase: 'lower' }} />);
    const value = getEditorValue();
    expect(value).toContain('count');
    expect(value).toContain('isnull');
    expect(value).not.toContain('COUNT');
  });

  // ---- AND/OR newline placement ------------------------------------
  it('puts AND/OR at start of line when logicalOperatorNewline=before', () => {
    render(<FormatPreview settings={{ ...defaultSettings, logicalOperatorNewline: 'before' }} />);
    // "before" → AND / OR appear at the beginning of a new line (possibly indented)
    expect(getEditorValue()).toMatch(/\n\s+AND /);
  });

  it('puts AND/OR at end of line when logicalOperatorNewline=after', () => {
    render(<FormatPreview settings={{ ...defaultSettings, logicalOperatorNewline: 'after' }} />);
    // "after" → AND / OR appear at the end of the previous line
    expect(getEditorValue()).toMatch(/AND\n/);
  });

  // ---- live update via setValue ------------------------------------
  it('calls editor.setValue with re-formatted SQL when settings change', async () => {
    const { rerender } = render(<FormatPreview settings={defaultSettings} />);

    // Wait for the async onMount to fire so editorRef is populated
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    mockSetValue.mockClear();

    // Change keyword case — this changes the formatted output
    rerender(<FormatPreview settings={{ ...defaultSettings, keywordCase: 'lower' }} />);

    // The useEffect that watches `formatted` should fire and call setValue
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockSetValue).toHaveBeenCalledOnce();
    const updatedValue = mockSetValue.mock.calls[0][0] as string;
    expect(updatedValue).toContain('select');
    expect(updatedValue).not.toContain('SELECT');
  });

  it('does NOT call editor.setValue when unrelated formatting settings stay the same', async () => {
    const { rerender } = render(<FormatPreview settings={defaultSettings} />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    mockSetValue.mockClear();

    // Re-render with the exact same formatting values (object identity changes, values don't)
    rerender(<FormatPreview settings={{ ...defaultSettings }} />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // useMemo deps are individual primitives, so setValue should NOT be called again
    expect(mockSetValue).not.toHaveBeenCalled();
  });
});
