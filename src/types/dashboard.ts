export type WidgetType = 'chart' | 'metric' | 'table' | 'text';
export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'doughnut';

export interface ChartConfig {
    chartType: ChartType;
    xAxis: string;
    yAxis: string;
    color: string;
}

export interface DashboardLayout {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Widget {
    id: string;
    type: WidgetType;
    title: string;
    sql: string;
    database: string;
    chartConfig: ChartConfig;
    textContent: string;
    layout: DashboardLayout;
}

export interface Dashboard {
    id: string;
    name: string;
    widgets: Widget[];
}

// ─── Messages: Webview → Extension ─────────────────────────────────────────

export interface GetDashboardsMessage {
    type: 'getDashboards';
}

export interface CreateDashboardMessage {
    type: 'createDashboard';
    name: string;
}

export interface SaveDashboardMessage {
    type: 'saveDashboard';
    dashboard: Dashboard;
}

export interface DeleteDashboardMessage {
    type: 'deleteDashboard';
    dashboardId: string;
}

export interface RenameDashboardMessage {
    type: 'renameDashboard';
    dashboardId: string;
    name: string;
}

export interface ExecuteWidgetQueryMessage {
    type: 'executeWidgetQuery';
    widgetId: string;
    sql: string;
    database: string;
}

export interface PreviewQueryMessage {
    type: 'previewQuery';
    requestId: string;
    sql: string;
    database: string;
}

export interface GetConnectionDatabasesMessage {
    type: 'getConnectionDatabases';
}

export type DashboardIncomingMessage =
    | GetDashboardsMessage
    | CreateDashboardMessage
    | SaveDashboardMessage
    | DeleteDashboardMessage
    | RenameDashboardMessage
    | ExecuteWidgetQueryMessage
    | PreviewQueryMessage
    | GetConnectionDatabasesMessage;

// ─── Messages: Extension → Webview ─────────────────────────────────────────

export interface DashboardsLoadedMessage {
    type: 'dashboardsLoaded';
    dashboards: Dashboard[];
    connectionId: string;
    serverName: string;
    defaultDatabase: string;
}

export interface DashboardCreatedMessage {
    type: 'dashboardCreated';
    dashboard: Dashboard;
}

export interface DashboardSavedMessage {
    type: 'dashboardSaved';
    dashboard: Dashboard;
}

export interface DashboardDeletedMessage {
    type: 'dashboardDeleted';
    dashboardId: string;
}

export interface DashboardRenamedMessage {
    type: 'dashboardRenamed';
    dashboardId: string;
    name: string;
}

export interface WidgetQueryResultMessage {
    type: 'widgetQueryResult';
    widgetId: string;
    columns: string[];
    rows: unknown[][];
}

export interface WidgetQueryErrorMessage {
    type: 'widgetQueryError';
    widgetId: string;
    error: string;
}

export interface PreviewResultMessage {
    type: 'previewResult';
    requestId: string;
    columns: string[];
    rows: unknown[][];
}

export interface PreviewErrorMessage {
    type: 'previewError';
    requestId: string;
    error: string;
}

export interface ConnectionDatabasesMessage {
    type: 'connectionDatabases';
    databases: string[];
}

export type DashboardOutgoingMessage =
    | DashboardsLoadedMessage
    | DashboardCreatedMessage
    | DashboardSavedMessage
    | DashboardDeletedMessage
    | DashboardRenamedMessage
    | WidgetQueryResultMessage
    | WidgetQueryErrorMessage
    | PreviewResultMessage
    | PreviewErrorMessage
    | ConnectionDatabasesMessage;
