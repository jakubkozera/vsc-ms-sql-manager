import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DatabaseDropdown } from './DatabaseDropdown';
import { useVSCode } from '../../context/VSCodeContext';

// Mock the VSCode context
vi.mock('../../context/VSCodeContext', () => ({
  useVSCode: vi.fn(),
}));

describe('DatabaseDropdown', () => {
  const mockSelectDatabase = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when no connection is selected', () => {
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: null,
      currentDatabase: null,
      databases: [],
      connections: [],
      selectDatabase: mockSelectDatabase,
    } as any);

    const { container } = render(<DatabaseDropdown />);
    expect(container.firstChild).toBeNull();
  });

  it('should not render for database-type connections', () => {
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: 'TestDB',
      databases: ['master', 'TestDB'],
      connections: [
        { id: 'conn1', name: 'Test', server: 'localhost', connectionType: 'database' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);

    const { container } = render(<DatabaseDropdown />);
    expect(container.firstChild).toBeNull();
  });

  it('should render for server-type connections', () => {
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: 'master',
      databases: ['master', 'TestDB', 'AnotherDB'],
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);

    render(<DatabaseDropdown />);
    
    const trigger = screen.getByRole('button');
    expect(trigger).toBeDefined();
    expect(trigger.textContent).toBe('master');
  });

  it('should display "Select database" when no database is selected', () => {
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: null,
      databases: ['master', 'TestDB'],
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);

    render(<DatabaseDropdown />);
    
    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toBe('Select database');
  });

  it('should open dropdown menu when clicked', async () => {
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: 'master',
      databases: ['master', 'TestDB', 'AnotherDB'],
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);

    render(<DatabaseDropdown />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    await waitFor(() => {
      const dropdownItems = document.querySelectorAll('.dropdown-item');
      expect(dropdownItems.length).toBe(3);
      const texts = Array.from(dropdownItems).map(el => el.textContent);
      expect(texts).toContain('master');
      expect(texts).toContain('TestDB');
      expect(texts).toContain('AnotherDB');
    });
  });

  it('should highlight currently selected database', async () => {
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: 'TestDB',
      databases: ['master', 'TestDB', 'AnotherDB'],
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);

    render(<DatabaseDropdown />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    await waitFor(() => {
      const items = screen.getAllByText(/master|TestDB|AnotherDB/);
      const testDbItem = items.find(el => el.textContent === 'TestDB' && el.classList.contains('dropdown-item'));
      expect(testDbItem?.classList.contains('selected')).toBe(true);
    });
  });

  it('should call selectDatabase when a database is clicked', async () => {
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: 'master',
      databases: ['master', 'TestDB', 'AnotherDB'],
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);

    render(<DatabaseDropdown />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    await waitFor(() => {
      const testDbItem = screen.getAllByText('TestDB').find(el => 
        el.classList.contains('dropdown-item')
      );
      expect(testDbItem).toBeDefined();
      fireEvent.click(testDbItem!);
    });

    expect(mockSelectDatabase).toHaveBeenCalledWith('TestDB');
    expect(mockSelectDatabase).toHaveBeenCalledTimes(1);
  });

  it('should close dropdown after selecting a database', async () => {
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: 'master',
      databases: ['master', 'TestDB'],
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);

    render(<DatabaseDropdown />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    await waitFor(() => {
      const testDbItem = screen.getAllByText('TestDB').find(el => 
        el.classList.contains('dropdown-item')
      );
      fireEvent.click(testDbItem!);
    });

    // Menu should be closed
    await waitFor(() => {
      const menuItems = document.querySelectorAll('.dropdown-item');
      expect(menuItems.length).toBe(0);
    });
  });

  it('should show "Loading databases..." when databases array is empty', async () => {
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: null,
      databases: [],
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);

    render(<DatabaseDropdown />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('Loading databases...')).toBeDefined();
    });
  });

  it('should close dropdown when clicking outside', async () => {
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: 'master',
      databases: ['master', 'TestDB'],
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);

    render(<DatabaseDropdown />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText('TestDB')).toBeDefined();
    });

    // Click outside
    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      const menuItems = document.querySelectorAll('.dropdown-item');
      expect(menuItems.length).toBe(0);
    });
  });

  it('should update displayed database when currentDatabase prop changes', () => {
    const { rerender } = render(<DatabaseDropdown />);
    
    // Initial state
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: 'master',
      databases: ['master', 'TestDB'],
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);
    
    rerender(<DatabaseDropdown />);
    let trigger = screen.getByRole('button');
    expect(trigger.textContent).toBe('master');

    // Update to different database
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: 'TestDB',
      databases: ['master', 'TestDB'],
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);
    
    rerender(<DatabaseDropdown />);
    trigger = screen.getByRole('button');
    expect(trigger.textContent).toBe('TestDB');
  });

  it('should handle multiple databases correctly', async () => {
    const manyDatabases = Array.from({ length: 20 }, (_, i) => `Database${i + 1}`);
    
    vi.mocked(useVSCode).mockReturnValue({
      currentConnectionId: 'conn1',
      currentDatabase: 'Database5',
      databases: manyDatabases,
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      selectDatabase: mockSelectDatabase,
    } as any);

    render(<DatabaseDropdown />);
    
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    await waitFor(() => {
      const dropdownItems = document.querySelectorAll('.dropdown-item');
      expect(dropdownItems.length).toBe(20);
      const texts = Array.from(dropdownItems).map(el => el.textContent);
      manyDatabases.forEach(db => {
        expect(texts).toContain(db);
      });
    });
  });
});
