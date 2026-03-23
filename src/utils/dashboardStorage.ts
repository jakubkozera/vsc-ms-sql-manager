import * as vscode from 'vscode';
import { Dashboard, Widget, DashboardLayout } from '../types/dashboard';
import { randomUUID } from 'node:crypto';

const STORAGE_PREFIX = 'sqlManagerDashboards.';

function defaultLayout(id: string): DashboardLayout {
    return { i: id, x: 0, y: 0, w: 6, h: 4 };
}

function defaultWidget(): Widget {
    const id = randomUUID();
    return {
        id,
        type: 'chart',
        title: 'New Widget',
        sql: '',
        database: '',
        chartConfig: { chartType: 'bar', xAxis: '', yAxis: '', color: '#4e8ef7' },
        textContent: '',
        layout: defaultLayout(id),
    };
}

export class DashboardStorage {
    constructor(private readonly globalState: vscode.Memento) {}

    getDashboards(connectionId: string): Dashboard[] {
        return this.globalState.get<Dashboard[]>(`${STORAGE_PREFIX}${connectionId}`) ?? [];
    }

    async saveDashboard(connectionId: string, dashboard: Dashboard): Promise<Dashboard[]> {
        const dashboards = this.getDashboards(connectionId);
        const idx = dashboards.findIndex(d => d.id === dashboard.id);
        if (idx >= 0) {
            dashboards[idx] = dashboard;
        } else {
            dashboards.push(dashboard);
        }
        await this.globalState.update(`${STORAGE_PREFIX}${connectionId}`, dashboards);
        return dashboards;
    }

    async createDashboard(connectionId: string, name: string): Promise<Dashboard> {
        const dashboard: Dashboard = {
            id: randomUUID(),
            name,
            widgets: [],
        };
        await this.saveDashboard(connectionId, dashboard);
        return dashboard;
    }

    async deleteDashboard(connectionId: string, dashboardId: string): Promise<Dashboard[]> {
        const dashboards = this.getDashboards(connectionId).filter(d => d.id !== dashboardId);
        await this.globalState.update(`${STORAGE_PREFIX}${connectionId}`, dashboards);
        return dashboards;
    }

    async renameDashboard(connectionId: string, dashboardId: string, name: string): Promise<void> {
        const dashboards = this.getDashboards(connectionId);
        const d = dashboards.find(d => d.id === dashboardId);
        if (d) {
            d.name = name;
            await this.globalState.update(`${STORAGE_PREFIX}${connectionId}`, dashboards);
        }
    }

    static createDefaultWidget(): Widget {
        return defaultWidget();
    }
}
