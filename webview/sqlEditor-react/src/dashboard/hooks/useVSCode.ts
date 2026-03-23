import { useCallback, useEffect, useRef, useState } from 'react';
import { OutgoingMessage, IncomingMessage, Dashboard, WidgetQueryState } from '../types';

declare function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

export interface DashboardState {
    dashboards: Dashboard[];
    connectionId: string;
    serverName: string;
    defaultDatabase: string;
    databases: string[];
    widgetQueryStates: Record<string, WidgetQueryState>;
    previewStates: Record<string, { status: 'idle' | 'loading' | 'success' | 'error'; columns: string[]; rows: unknown[][]; error?: string }>;
}

const initialState: DashboardState = {
    dashboards: [],
    connectionId: '',
    serverName: '',
    defaultDatabase: '',
    databases: [],
    widgetQueryStates: {},
    previewStates: {},
};

export function useVSCode() {
    const apiRef = useRef<ReturnType<typeof acquireVsCodeApi>>();
    if (!apiRef.current) {
        try {
            apiRef.current = acquireVsCodeApi();
        } catch {
            // Running outside of VS Code (dev mode)
            apiRef.current = {
                postMessage: (msg: unknown) => console.log('[vscode mock] postMessage', msg),
                getState: () => ({}),
                setState: () => {},
            };
        }
    }

    const [state, setState] = useState<DashboardState>(initialState);

    const postMessage = useCallback((msg: OutgoingMessage) => {
        apiRef.current?.postMessage(msg);
    }, []);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data as IncomingMessage;
            switch (message.type) {
                case 'dashboardsLoaded':
                    setState(prev => ({
                        ...prev,
                        dashboards: message.dashboards,
                        connectionId: message.connectionId,
                        serverName: message.serverName,
                        defaultDatabase: message.defaultDatabase,
                    }));
                    break;

                case 'dashboardCreated':
                    setState(prev => ({
                        ...prev,
                        dashboards: [...prev.dashboards, message.dashboard],
                    }));
                    break;

                case 'dashboardSaved':
                    setState(prev => ({
                        ...prev,
                        dashboards: prev.dashboards.map(d =>
                            d.id === message.dashboard.id ? message.dashboard : d
                        ),
                    }));
                    break;

                case 'dashboardDeleted':
                    setState(prev => ({
                        ...prev,
                        dashboards: prev.dashboards.filter(d => d.id !== message.dashboardId),
                    }));
                    break;

                case 'dashboardRenamed':
                    setState(prev => ({
                        ...prev,
                        dashboards: prev.dashboards.map(d =>
                            d.id === message.dashboardId ? { ...d, name: message.name } : d
                        ),
                    }));
                    break;

                case 'widgetQueryResult':
                    setState(prev => ({
                        ...prev,
                        widgetQueryStates: {
                            ...prev.widgetQueryStates,
                            [message.widgetId]: {
                                status: 'success',
                                columns: message.columns,
                                rows: message.rows,
                            },
                        },
                    }));
                    break;

                case 'widgetQueryError':
                    setState(prev => ({
                        ...prev,
                        widgetQueryStates: {
                            ...prev.widgetQueryStates,
                            [message.widgetId]: {
                                status: 'error',
                                columns: [],
                                rows: [],
                                error: message.error,
                            },
                        },
                    }));
                    break;

                case 'previewResult':
                    setState(prev => ({
                        ...prev,
                        previewStates: {
                            ...prev.previewStates,
                            [message.requestId]: {
                                status: 'success',
                                columns: message.columns,
                                rows: message.rows,
                            },
                        },
                    }));
                    break;

                case 'previewError':
                    setState(prev => ({
                        ...prev,
                        previewStates: {
                            ...prev.previewStates,
                            [message.requestId]: {
                                status: 'error',
                                columns: [],
                                rows: [],
                                error: message.error,
                            },
                        },
                    }));
                    break;

                case 'connectionDatabases':
                    setState(prev => ({ ...prev, databases: message.databases }));
                    break;

                default:
                    break;
            }
        };

        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    const setWidgetQueryLoading = useCallback((widgetId: string) => {
        setState(prev => ({
            ...prev,
            widgetQueryStates: {
                ...prev.widgetQueryStates,
                [widgetId]: { status: 'loading', columns: [], rows: [] },
            },
        }));
    }, []);

    const setPreviewLoading = useCallback((requestId: string) => {
        setState(prev => ({
            ...prev,
            previewStates: {
                ...prev.previewStates,
                [requestId]: { status: 'loading', columns: [], rows: [] },
            },
        }));
    }, []);

    return { state, postMessage, setWidgetQueryLoading, setPreviewLoading };
}
