import { useState, useRef } from 'react';
import {
    IconPlus,
    IconPencil,
    IconTrash,
} from '@tabler/icons-react';
import { Dashboard } from './types';

interface Props {
    dashboards: Dashboard[];
    activeDashboardId: string | null;
    onSelect: (id: string) => void;
    onCreateDashboard: (name: string) => void;
    onDeleteDashboard: (id: string) => void;
    onRenameDashboard: (id: string, name: string) => void;
}

export function DashboardSidebar({
    dashboards,
    activeDashboardId,
    onSelect,
    onCreateDashboard,
    onDeleteDashboard,
    onRenameDashboard,
}: Props) {
    const [creating, setCreating] = useState(false);
    const [createName, setCreateName] = useState('');
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const createInputRef = useRef<HTMLInputElement>(null);
    const renameInputRef = useRef<HTMLInputElement | null>(null);

    function handleCreateSubmit(e: React.FormEvent) {
        e.preventDefault();
        const trimmed = createName.trim();
        if (trimmed) {
            onCreateDashboard(trimmed);
        }
        setCreating(false);
        setCreateName('');
    }

    function startRename(id: string, currentName: string) {
        setRenamingId(id);
        setRenameValue(currentName);
        setTimeout(() => renameInputRef.current?.select(), 30);
    }

    function handleRenameSubmit(e: React.FormEvent, id: string) {
        e.preventDefault();
        const trimmed = renameValue.trim();
        if (trimmed) {
            onRenameDashboard(id, trimmed);
        }
        setRenamingId(null);
    }

    return (
        <div className="sidebar">
            <div className="sidebar-header">
                <span className="sidebar-title">Dashboards</span>
                <button
                    className="btn-icon"
                    title="New dashboard"
                    onClick={() => {
                        setCreating(true);
                        setTimeout(() => createInputRef.current?.focus(), 30);
                    }}
                >
                    <IconPlus size={16} />
                </button>
            </div>

            <ul className="sidebar-list">
                {dashboards.map(d => (
                    <li
                        key={d.id}
                        className={`sidebar-item ${d.id === activeDashboardId ? 'active' : ''}`}
                        onClick={() => { if (renamingId !== d.id) onSelect(d.id); }}
                    >
                        {renamingId === d.id ? (
                            <form onSubmit={(e) => handleRenameSubmit(e, d.id)} className="sidebar-rename-form">
                                <input
                                    ref={renameInputRef}
                                    className="sidebar-input"
                                    value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    onBlur={(e) => handleRenameSubmit(e as unknown as React.FormEvent, d.id)}
                                    onKeyDown={e => e.key === 'Escape' && setRenamingId(null)}
                                    autoFocus
                                />
                            </form>
                        ) : (
                            <>
                                <span className="sidebar-item-name">{d.name}</span>
                                <div className="sidebar-item-actions">
                                    <button
                                        className="btn-icon-sm"
                                        title="Rename"
                                        onClick={e => { e.stopPropagation(); startRename(d.id, d.name); }}
                                    >
                                        <IconPencil size={13} />
                                    </button>
                                    <button
                                        className="btn-icon-sm btn-danger"
                                        title="Delete"
                                        onClick={e => {
                                            e.stopPropagation();
                                            if (confirm(`Delete dashboard "${d.name}"?`)) {
                                                onDeleteDashboard(d.id);
                                            }
                                        }}
                                    >
                                        <IconTrash size={13} />
                                    </button>
                                </div>
                            </>
                        )}
                    </li>
                ))}
            </ul>

            {creating && (
                <form className="sidebar-create-form" onSubmit={handleCreateSubmit}>
                    <input
                        ref={createInputRef}
                        className="sidebar-input"
                        placeholder="Dashboard name…"
                        value={createName}
                        onChange={e => setCreateName(e.target.value)}
                        onBlur={() => { if (!createName.trim()) { setCreating(false); } }}
                        onKeyDown={e => e.key === 'Escape' && setCreating(false)}
                    />
                    <button type="submit" className="btn btn-primary btn-sm">Add</button>
                </form>
            )}
        </div>
    );
}
