import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ConnectionDropdown } from '../ConnectionDropdown';
import { DatabaseDropdown } from '../DatabaseDropdown';

// Mock useVSCode
const mockSelectConnection = vi.fn();
const mockSelectDatabase = vi.fn();
const mockManageConnections = vi.fn();
const mockPostMessage = vi.fn();

let mockContextValue: any = {};

vi.mock('../../../context/VSCodeContext', () => ({
  useVSCode: () => mockContextValue,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockContextValue = {
    connections: [],
    currentConnectionId: null,
    currentDatabase: null,
    databases: [],
    selectConnection: mockSelectConnection,
    selectDatabase: mockSelectDatabase,
    manageConnections: mockManageConnections,
    postMessage: mockPostMessage,
  };
});

describe('ConnectionDropdown', () => {
  it('shows "Not Connected" when no connection is active', () => {
    const { getByRole } = render(<ConnectionDropdown />);
    expect(getByRole('button').textContent).toBe('Not Connected');
  });

  it('shows connection name when connected', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'My Server', server: 'localhost', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';

    const { getByRole } = render(<ConnectionDropdown />);
    expect(getByRole('button').textContent).toBe('My Server');
  });

  it('calls manageConnections when clicking trigger with no connection', () => {
    const { getByRole } = render(<ConnectionDropdown />);
    fireEvent.click(getByRole('button'));

    expect(mockManageConnections).toHaveBeenCalledOnce();
  });

  it('opens dropdown when clicking trigger with active connection', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'Server A', server: 'host-a', connectionType: 'server' },
      { id: 'conn-2', name: 'Server B', server: 'host-b', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';

    const { getByRole, container } = render(<ConnectionDropdown />);
    fireEvent.click(getByRole('button'));

    const items = container.querySelectorAll('.dropdown-item');
    const texts = Array.from(items).map((el) => el.textContent);
    expect(texts).toContain('Server A');
    expect(texts).toContain('Server B');
  });

  it('calls selectConnection when selecting a different connection', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'Server A', server: 'host-a', connectionType: 'server' },
      { id: 'conn-2', name: 'Server B', server: 'host-b', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';

    const { getByRole, getByText } = render(<ConnectionDropdown />);
    fireEvent.click(getByRole('button'));
    fireEvent.click(getByText('Server B'));

    expect(mockSelectConnection).toHaveBeenCalledWith('conn-2');
  });

  it('does not contain "Manage Connections..." in dropdown menu', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'Server A', server: 'host-a', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';

    const { getByRole, container } = render(<ConnectionDropdown />);
    fireEvent.click(getByRole('button'));

    const items = container.querySelectorAll('.dropdown-item');
    const texts = Array.from(items).map((el) => el.textContent);
    expect(texts).not.toContain('Manage Connections...');
  });

  it('marks current connection as selected', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'Server A', server: 'host-a', connectionType: 'server' },
      { id: 'conn-2', name: 'Server B', server: 'host-b', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';

    const { getByRole, container } = render(<ConnectionDropdown />);
    fireEvent.click(getByRole('button'));

    const items = container.querySelectorAll('.dropdown-item');
    const serverA = Array.from(items).find((el) => el.textContent === 'Server A');
    const serverB = Array.from(items).find((el) => el.textContent === 'Server B');
    expect(serverA?.classList.contains('selected')).toBe(true);
    expect(serverB?.classList.contains('selected')).toBe(false);
  });

  it('closes dropdown after selecting an item', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'Server A', server: 'host-a', connectionType: 'server' },
      { id: 'conn-2', name: 'Server B', server: 'host-b', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';

    const { getByRole, getByText } = render(<ConnectionDropdown />);
    fireEvent.click(getByRole('button'));
    fireEvent.click(getByText('Server B'));

    // Menu should be closed - Server A shouldn't be visible as menu item anymore
    // (Server A is still on the trigger button but not in a dropdown-item)
    const menuItems = document.querySelectorAll('.dropdown-menu .dropdown-item');
    expect(menuItems.length).toBe(0);
  });

  it('falls back to server name when connection has no name', () => {
    mockContextValue.connections = [
      { id: 'conn-1', server: 'my-host.database.windows.net', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';

    const { getByRole } = render(<ConnectionDropdown />);
    expect(getByRole('button').textContent).toBe('my-host.database.windows.net');
  });
});

describe('DatabaseDropdown', () => {
  it('does not render when no connection is active', () => {
    const { container } = render(<DatabaseDropdown />);
    expect(container.innerHTML).toBe('');
  });

  it('does not render for database-type connections', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'My DB', server: 'host', connectionType: 'database' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';

    const { container } = render(<DatabaseDropdown />);
    expect(container.innerHTML).toBe('');
  });

  it('renders for server-type connections', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'My Server', server: 'host', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';
    mockContextValue.databases = ['master', 'tempdb', 'mydb'];

    const { getByRole } = render(<DatabaseDropdown />);
    expect(getByRole('button')).toBeTruthy();
  });

  it('shows "Select database" when no database is selected', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'My Server', server: 'host', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';
    mockContextValue.databases = ['master'];

    const { getByRole } = render(<DatabaseDropdown />);
    expect(getByRole('button').textContent).toBe('Select database');
  });

  it('shows current database name', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'My Server', server: 'host', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';
    mockContextValue.currentDatabase = 'mydb';
    mockContextValue.databases = ['master', 'mydb'];

    const { getByRole } = render(<DatabaseDropdown />);
    expect(getByRole('button').textContent).toBe('mydb');
  });

  it('opens dropdown and shows databases', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'My Server', server: 'host', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';
    mockContextValue.databases = ['master', 'tempdb', 'mydb'];

    const { getByRole, getByText } = render(<DatabaseDropdown />);
    fireEvent.click(getByRole('button'));

    expect(getByText('master')).toBeTruthy();
    expect(getByText('tempdb')).toBeTruthy();
    expect(getByText('mydb')).toBeTruthy();
  });

  it('calls selectDatabase when selecting a database', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'My Server', server: 'host', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';
    mockContextValue.databases = ['master', 'mydb'];

    const { getByRole, getByText } = render(<DatabaseDropdown />);
    fireEvent.click(getByRole('button'));
    fireEvent.click(getByText('mydb'));

    expect(mockSelectDatabase).toHaveBeenCalledWith('mydb');
  });

  it('marks current database as selected', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'My Server', server: 'host', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';
    mockContextValue.currentDatabase = 'mydb';
    mockContextValue.databases = ['master', 'mydb'];

    const { getByRole, container } = render(<DatabaseDropdown />);
    fireEvent.click(getByRole('button'));

    const items = container.querySelectorAll('.dropdown-item');
    const mydbItem = Array.from(items).find((el) => el.textContent === 'mydb');
    expect(mydbItem?.classList.contains('selected')).toBe(true);
  });

  it('shows loading message when databases array is empty', () => {
    mockContextValue.connections = [
      { id: 'conn-1', name: 'My Server', server: 'host', connectionType: 'server' },
    ];
    mockContextValue.currentConnectionId = 'conn-1';
    mockContextValue.databases = [];

    const { getByRole, getByText } = render(<DatabaseDropdown />);
    fireEvent.click(getByRole('button'));

    expect(getByText('Loading databases...')).toBeTruthy();
  });
});
