import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test/testUtils';
import { ExportMenu } from './ExportMenu';

describe('ExportMenu', () => {
  const defaultProps = {
    position: { x: 100, y: 100 },
    onExport: vi.fn(),
    onCopy: vi.fn(),
    onClose: vi.fn(),
    hasSelection: false,
    onAutoFit: vi.fn(),
    onSelectAll: vi.fn(),
    onCreateChart: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the menu with Auto-fit, Select All, Create Chart, Copy and Export items', () => {
    render(<ExportMenu {...defaultProps} />);
    expect(screen.getByTestId('export-autofit')).toBeInTheDocument();
    expect(screen.getByTestId('export-select-all')).toBeInTheDocument();
    expect(screen.getByTestId('export-create-chart')).toBeInTheDocument();
    expect(screen.getByTestId('copy-submenu-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('export-submenu-trigger')).toBeInTheDocument();
  });

  it('calls onSelectAll and onClose when Select All is clicked', () => {
    render(<ExportMenu {...defaultProps} />);
    fireEvent.click(screen.getByTestId('export-select-all'));
    expect(defaultProps.onSelectAll).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onCreateChart and onClose when Create Chart is clicked', () => {
    render(<ExportMenu {...defaultProps} />);
    fireEvent.click(screen.getByTestId('export-create-chart'));
    expect(defaultProps.onCreateChart).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onAutoFit and onClose when Auto-fit is clicked', () => {
    render(<ExportMenu {...defaultProps} />);
    fireEvent.click(screen.getByTestId('export-autofit'));
    expect(defaultProps.onAutoFit).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows Copy submenu on hover', () => {
    render(<ExportMenu {...defaultProps} />);
    expect(screen.queryByTestId('copy-submenu')).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId('copy-submenu-container'));
    expect(screen.getByTestId('copy-submenu')).toBeInTheDocument();
  });

  it('hides Copy submenu on mouse leave', () => {
    render(<ExportMenu {...defaultProps} />);
    fireEvent.mouseEnter(screen.getByTestId('copy-submenu-container'));
    expect(screen.getByTestId('copy-submenu')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByTestId('copy-submenu-container'));
    expect(screen.queryByTestId('copy-submenu')).not.toBeInTheDocument();
  });

  it('shows Export submenu on hover', () => {
    render(<ExportMenu {...defaultProps} />);
    expect(screen.queryByTestId('export-submenu')).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId('export-submenu-container'));
    expect(screen.getByTestId('export-submenu')).toBeInTheDocument();
  });

  it('hides Export submenu on mouse leave', () => {
    render(<ExportMenu {...defaultProps} />);
    fireEvent.mouseEnter(screen.getByTestId('export-submenu-container'));
    expect(screen.getByTestId('export-submenu')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByTestId('export-submenu-container'));
    expect(screen.queryByTestId('export-submenu')).not.toBeInTheDocument();
  });

  describe('Copy submenu items', () => {
    const openCopySubmenu = () => {
      fireEvent.mouseEnter(screen.getByTestId('copy-submenu-container'));
    };

    it('calls onCopy with clipboard format for "Copy to clipboard"', () => {
      render(<ExportMenu {...defaultProps} />);
      openCopySubmenu();
      fireEvent.click(screen.getByTestId('copy-clipboard'));
      expect(defaultProps.onCopy).toHaveBeenCalledWith('clipboard', true);
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('calls onCopy with table format for "Copy as Table"', () => {
      render(<ExportMenu {...defaultProps} />);
      openCopySubmenu();
      fireEvent.click(screen.getByTestId('copy-table'));
      expect(defaultProps.onCopy).toHaveBeenCalledWith('table', true);
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('calls onCopy with json format for "Copy as JSON"', () => {
      render(<ExportMenu {...defaultProps} />);
      openCopySubmenu();
      fireEvent.click(screen.getByTestId('copy-json'));
      expect(defaultProps.onCopy).toHaveBeenCalledWith('json', true);
    });

    it('calls onCopy with csv format for "Copy as CSV"', () => {
      render(<ExportMenu {...defaultProps} />);
      openCopySubmenu();
      fireEvent.click(screen.getByTestId('copy-csv'));
      expect(defaultProps.onCopy).toHaveBeenCalledWith('csv', true);
    });

    it('calls onCopy with tsv format for "Copy as TSV"', () => {
      render(<ExportMenu {...defaultProps} />);
      openCopySubmenu();
      fireEvent.click(screen.getByTestId('copy-tsv'));
      expect(defaultProps.onCopy).toHaveBeenCalledWith('tsv', true);
    });

    it('calls onCopy with insert format for "Copy as SQL INSERT"', () => {
      render(<ExportMenu {...defaultProps} />);
      openCopySubmenu();
      fireEvent.click(screen.getByTestId('copy-insert'));
      expect(defaultProps.onCopy).toHaveBeenCalledWith('insert', true);
    });

    it('calls onCopy with markdown format for "Copy as Markdown"', () => {
      render(<ExportMenu {...defaultProps} />);
      openCopySubmenu();
      fireEvent.click(screen.getByTestId('copy-markdown'));
      expect(defaultProps.onCopy).toHaveBeenCalledWith('markdown', true);
    });

    it('calls onCopy with xml format for "Copy as XML"', () => {
      render(<ExportMenu {...defaultProps} />);
      openCopySubmenu();
      fireEvent.click(screen.getByTestId('copy-xml'));
      expect(defaultProps.onCopy).toHaveBeenCalledWith('xml', true);
    });

    it('calls onCopy with html format for "Copy as HTML"', () => {
      render(<ExportMenu {...defaultProps} />);
      openCopySubmenu();
      fireEvent.click(screen.getByTestId('copy-html'));
      expect(defaultProps.onCopy).toHaveBeenCalledWith('html', true);
    });
  });

  describe('Export submenu items', () => {
    const openExportSubmenu = () => {
      fireEvent.mouseEnter(screen.getByTestId('export-submenu-container'));
    };

    it('calls onExport with json format for "Export to JSON"', () => {
      render(<ExportMenu {...defaultProps} />);
      openExportSubmenu();
      fireEvent.click(screen.getByTestId('export-json'));
      expect(defaultProps.onExport).toHaveBeenCalledWith('json', true);
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('calls onExport with csv format for "Export to CSV"', () => {
      render(<ExportMenu {...defaultProps} />);
      openExportSubmenu();
      fireEvent.click(screen.getByTestId('export-csv'));
      expect(defaultProps.onExport).toHaveBeenCalledWith('csv', true);
    });

    it('calls onExport with tsv format for "Export to Excel (TSV)"', () => {
      render(<ExportMenu {...defaultProps} />);
      openExportSubmenu();
      fireEvent.click(screen.getByTestId('export-tsv'));
      expect(defaultProps.onExport).toHaveBeenCalledWith('tsv', true);
    });

    it('calls onExport with insert format for "Export to SQL INSERT"', () => {
      render(<ExportMenu {...defaultProps} />);
      openExportSubmenu();
      fireEvent.click(screen.getByTestId('export-insert'));
      expect(defaultProps.onExport).toHaveBeenCalledWith('insert', true);
    });

    it('calls onExport with markdown format for "Export to Markdown"', () => {
      render(<ExportMenu {...defaultProps} />);
      openExportSubmenu();
      fireEvent.click(screen.getByTestId('export-markdown'));
      expect(defaultProps.onExport).toHaveBeenCalledWith('markdown', true);
    });

    it('calls onExport with xml format for "Export to XML"', () => {
      render(<ExportMenu {...defaultProps} />);
      openExportSubmenu();
      fireEvent.click(screen.getByTestId('export-xml'));
      expect(defaultProps.onExport).toHaveBeenCalledWith('xml', true);
    });

    it('calls onExport with html format for "Export to HTML"', () => {
      render(<ExportMenu {...defaultProps} />);
      openExportSubmenu();
      fireEvent.click(screen.getByTestId('export-html'));
      expect(defaultProps.onExport).toHaveBeenCalledWith('html', true);
    });
  });

  it('closes on Escape key', () => {
    render(<ExportMenu {...defaultProps} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('closes on click outside', async () => {
    render(<ExportMenu {...defaultProps} />);
    // Wait for the setTimeout(0) to register the listener
    await new Promise(r => setTimeout(r, 10));
    fireEvent.mouseDown(document.body);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('only shows one submenu at a time', () => {
    render(<ExportMenu {...defaultProps} />);
    fireEvent.mouseEnter(screen.getByTestId('copy-submenu-container'));
    expect(screen.getByTestId('copy-submenu')).toBeInTheDocument();
    expect(screen.queryByTestId('export-submenu')).not.toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId('copy-submenu-container'));
    fireEvent.mouseEnter(screen.getByTestId('export-submenu-container'));
    expect(screen.queryByTestId('copy-submenu')).not.toBeInTheDocument();
    expect(screen.getByTestId('export-submenu')).toBeInTheDocument();
  });

  it('displays submenu arrow indicators', () => {
    render(<ExportMenu {...defaultProps} />);
    const copyTrigger = screen.getByTestId('copy-submenu-trigger');
    const exportTrigger = screen.getByTestId('export-submenu-trigger');
    expect(copyTrigger.querySelector('.export-submenu-arrow')).toBeInTheDocument();
    expect(exportTrigger.querySelector('.export-submenu-arrow')).toBeInTheDocument();
  });
});
