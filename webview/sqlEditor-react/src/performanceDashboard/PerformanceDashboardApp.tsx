import { useEffect, useMemo, useState } from 'react';
import './performanceDashboard.css';

interface DashboardOverview {
  serverName: string;
  databaseName: string;
  sampledAt: string;
  cpuUtilizationPct: number;
  memoryUtilizationPct: number;
  topWaitType: string;
  topWaitMs: number;
  blockingSessions: number;
  runningJobs: number;
}

interface TrendPoint {
  sampledAt: string;
  value: number;
}

interface DashboardTrends {
  cpu: TrendPoint[];
  memory: TrendPoint[];
  blocking: TrendPoint[];
}

interface ServerHealthCard {
  connectionId: string;
  name: string;
  server: string;
  database: string;
  cpuUtilizationPct: number;
  memoryUtilizationPct: number;
  blockingSessions: number;
  status: 'healthy' | 'warning' | 'critical';
}

interface DbStorage {
  usedMb: number;
  allocatedMb: number;
  maxMb: number;
  usedPct: number;
}

interface DashboardPayload {
  overview: DashboardOverview;
  trends: DashboardTrends;
  servers: ServerHealthCard[];
  storage: DbStorage;
}

interface DashboardSnapshotMessage {
  type: 'dashboardSnapshot';
  data: DashboardPayload;
}

interface DashboardErrorMessage {
  type: 'dashboardError';
  error: string;
}

type IncomingMessage = DashboardSnapshotMessage | DashboardErrorMessage;

interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

const refreshOptions = [5, 10, 15, 30, 60];

export function PerformanceDashboardApp() {
  const [vscodeApi] = useState(() => acquireVsCodeApi());
  const [snapshot, setSnapshot] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(15);

  useEffect(() => {
    const handler = (event: MessageEvent<IncomingMessage>) => {
      const message = event.data;
      if (message.type === 'dashboardSnapshot') {
        setSnapshot(message.data);
        setError(null);
      }
      if (message.type === 'dashboardError') {
        setError(message.error);
      }
    };

    window.addEventListener('message', handler);
    vscodeApi.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handler);
  }, [vscodeApi]);

  const sampledAt = useMemo(() => {
    if (!snapshot?.overview.sampledAt) {
      return 'n/a';
    }
    return new Date(snapshot.overview.sampledAt).toLocaleTimeString();
  }, [snapshot?.overview.sampledAt]);

  const handleRefreshNow = () => {
    vscodeApi.postMessage({ type: 'refreshNow' });
  };

  const handleIntervalChange = (next: number) => {
    setRefreshInterval(next);
    vscodeApi.postMessage({ type: 'setRefreshInterval', intervalSeconds: next });
  };

  return (
    <div className="perf-dashboard-root">
      <header className="perf-dashboard-header">
        <div>
          <h1>SQL Performance Dashboard</h1>
          <p>{snapshot ? `${snapshot.overview.serverName} / ${snapshot.overview.databaseName}` : 'No active connection'}</p>
        </div>
        <div className="perf-dashboard-actions">
          <label htmlFor="refreshInterval">Refresh</label>
          <select
            id="refreshInterval"
            value={refreshInterval}
            onChange={(e) => handleIntervalChange(Number(e.target.value))}
          >
            {refreshOptions.map((option) => (
              <option key={option} value={option}>{option}s</option>
            ))}
          </select>
          <button onClick={handleRefreshNow}>Refresh now</button>
        </div>
      </header>

      {error && <div className="perf-error">{error}</div>}

      <main className="perf-grid">
        <MetricCard label="CPU" value={`${snapshot?.overview.cpuUtilizationPct ?? 0}%`} intent={intentFromPercent(snapshot?.overview.cpuUtilizationPct ?? 0)} />
        <MetricCard label="Memory" value={`${snapshot?.overview.memoryUtilizationPct ?? 0}%`} intent={intentFromPercent(snapshot?.overview.memoryUtilizationPct ?? 0)} />
        <MetricCard label="Top Wait" value={snapshot?.overview.topWaitType ?? 'N/A'} subtitle={`${snapshot?.overview.topWaitMs ?? 0} ms`} intent="warn" />
        <MetricCard label="Blocking" value={`${snapshot?.overview.blockingSessions ?? 0}`} subtitle="sessions" intent={(snapshot?.overview.blockingSessions ?? 0) > 0 ? 'critical' : 'ok'} />
        <MetricCard label="Running Jobs" value={`${snapshot?.overview.runningJobs ?? 0}`} subtitle="SQL Agent" intent="ok" />
        <MetricCard label="Last Sample" value={sampledAt} subtitle="local time" intent="neutral" />
      </main>

      <section className="perf-section">
        <h2>Live Trends</h2>
        <div className="trend-grid">
          <TrendCard title="CPU %" points={snapshot?.trends.cpu ?? []} tone="ok" />
          <TrendCard title="Memory %" points={snapshot?.trends.memory ?? []} tone="warn" />
          <TrendCard title="Blocking" points={snapshot?.trends.blocking ?? []} tone="critical" />
        </div>
      </section>

      {snapshot && (
        <section className="perf-section">
          <h2>Database Data Storage</h2>
          <StorageCard storage={snapshot.storage} />
        </section>
      )}

      <section className="perf-section">
        <h2>Server Health</h2>
        <div className="server-cards">
          {(snapshot?.servers ?? []).map((server) => (
            <article key={server.connectionId} className={`server-card server-${server.status}`}>
              <header>
                <strong>{server.name}</strong>
                <span>{server.status}</span>
              </header>
              <p>{server.server} / {server.database}</p>
              <div className="server-stats">
                <span>CPU {server.cpuUtilizationPct}%</span>
                <span>Memory {server.memoryUtilizationPct}%</span>
                <span>Blocking {server.blockingSessions}</span>
              </div>
            </article>
          ))}
          {(snapshot?.servers?.length ?? 0) === 0 && (
            <article className="server-card server-warning">
              <header>
                <strong>No active connections</strong>
              </header>
              <p>Connect to one or more SQL Servers to see health cards.</p>
            </article>
          )}
        </div>
      </section>
    </div>
  );
}

function TrendCard({ title, points, tone }: { title: string; points: TrendPoint[]; tone: 'ok' | 'warn' | 'critical' }) {
  const values = points.map((p) => p.value);
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const range = max - min || 1;

  const path = points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = 100 - ((point.value - min) / range) * 100;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  const latest = points[points.length - 1]?.value ?? 0;

  return (
    <article className="trend-card">
      <header>
        <span>{title}</span>
        <strong>{latest.toFixed(0)}</strong>
      </header>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={`sparkline sparkline-${tone}`}>
        <path d={path || 'M 0 90 L 100 90'} />
      </svg>
    </article>
  );
}

function intentFromPercent(value: number): 'ok' | 'warn' | 'critical' {
  if (value >= 85) {
    return 'critical';
  }
  if (value >= 65) {
    return 'warn';
  }
  return 'ok';
}

function StorageCard({ storage }: { storage: DbStorage }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const usedPct = Math.max(0, Math.min(100, storage.usedPct));
  const dashOffset = circumference * (1 - usedPct / 100);
  const remainingMb = Math.max(0, storage.maxMb - storage.usedMb);

  const fmt = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <div className="storage-card">
      <div className="storage-donut-wrap">
        <svg viewBox="0 0 120 120" className="storage-donut">
          <circle cx="60" cy="60" r={radius} className="storage-donut-bg" />
          <circle
            cx="60" cy="60" r={radius}
            className="storage-donut-used"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={`${dashOffset}`}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <span className="storage-donut-label">{usedPct}% Used</span>
      </div>
      <div className="storage-legend">
        <div className="storage-legend-item storage-legend-used">
          <span className="storage-legend-label">Used space</span>
          <strong>{fmt(storage.usedMb)}</strong>
        </div>
        <div className="storage-legend-item storage-legend-remaining">
          <span className="storage-legend-label">Remaining space</span>
          <strong>{storage.maxMb > 0 ? fmt(remainingMb) : 'N/A'}</strong>
        </div>
        <div className="storage-legend-item storage-legend-allocated">
          <span className="storage-legend-label">Allocated space</span>
          <strong>{fmt(storage.allocatedMb)}</strong>
        </div>
        <div className="storage-legend-item storage-legend-max">
          <span className="storage-legend-label">Max storage</span>
          <strong>{storage.maxMb > 0 ? fmt(storage.maxMb) : 'N/A'}</strong>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
  intent,
}: {
  label: string;
  value: string;
  subtitle?: string;
  intent: 'ok' | 'warn' | 'critical' | 'neutral';
}) {
  return (
    <section className={`metric-card metric-${intent}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {subtitle && <span className="metric-subtitle">{subtitle}</span>}
    </section>
  );
}
