import { useState, useEffect, useCallback } from 'react';
import './settings.css';
import { BooleanSetting } from './components/BooleanSetting';
import { NumberSetting } from './components/NumberSetting';
import { SelectSetting } from './components/SelectSetting';
import { ColorSetting } from './components/ColorSetting';
import { FormatPreview } from './components/FormatPreview';
import { type ExtensionSettings, type IncomingMessage, defaultSettings } from './types';

// ============================================
// Types
// ============================================

interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeApi;


type TabId = 'explorer' | 'editor' | 'formatting';

const tabs: { id: TabId; label: string }[] = [
  { id: 'explorer', label: 'Database Explorer' },
  { id: 'editor', label: 'Query Editor' },
  { id: 'formatting', label: 'Formatting Options' },
];

// ============================================
// Main Settings App
// ============================================

export function SettingsApp() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [vscodeApi] = useState(() => acquireVsCodeApi());
  const [activeTab, setActiveTab] = useState<TabId>('explorer');

  // Listen for messages from extension
  useEffect(() => {
    const handler = (event: MessageEvent<IncomingMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'settingsLoaded':
          setSettings(message.settings);
          break;
        case 'settingsSaved':
          setSaveMessage('Saved');
          setTimeout(() => setSaveMessage(null), 1200);
          break;
      }
    };

    window.addEventListener('message', handler);

    // Request current settings
    vscodeApi.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handler);
  }, [vscodeApi]);

  const updateSetting = useCallback(
    <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        vscodeApi.postMessage({ type: 'saveSettings', settings: next });
        return next;
      });
    },
    [vscodeApi]
  );

  const isSettingModified = useCallback(
    <K extends keyof ExtensionSettings>(key: K) => settings[key] !== defaultSettings[key],
    [settings]
  );

  const caseOptions = [
    { value: 'upper', label: 'UPPER' },
    { value: 'lower', label: 'lower' },
    { value: 'preserve', label: 'Preserve' },
  ];

  return (
    <div className="settings-container">
      {/* Header */}
      <div className="settings-top-bar">
        <div className="settings-title-row">
          <h1 className="settings-main-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" />
              <path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
            </svg>
            Settings
          </h1>
          <div className="settings-actions">
            {saveMessage && <span className="save-message">{saveMessage}</span>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="settings-tabs-container">
        <div className="settings-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`settings-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={`settings-tab-content${activeTab === 'formatting' ? ' settings-tab-content--formatting' : ''}`}>
          {/* Database Explorer */}
          <div className={`settings-tab-panel${activeTab === 'explorer' ? ' active' : ''}`}>
            <BooleanSetting
              id="showTableStatistics"
              label="Show Table Statistics"
              description="Show row count and size information for tables in the database explorer tree."
              value={settings.showTableStatistics}
              onChange={(v) => updateSetting('showTableStatistics', v)}
              isModified={isSettingModified('showTableStatistics')}
            />
            <BooleanSetting
              id="immediateActive"
              label="Immediate Activation"
              description="Activate extension immediately when VS Code starts. When disabled, extension activates only when SQL files are opened."
              value={settings.immediateActive}
              onChange={(v) => updateSetting('immediateActive', v)}
              isModified={isSettingModified('immediateActive')}
            />
            <NumberSetting
              id="schemaCacheValiditySeconds"
              label="Schema Cache Validity (seconds)"
              description="Duration in seconds to cache database schema hash validation results. Longer values reduce database queries but may delay detection of schema changes."
              value={settings.schemaCacheValiditySeconds}
              onChange={(v) => updateSetting('schemaCacheValiditySeconds', v)}
              min={5}
              max={3600}
              isModified={isSettingModified('schemaCacheValiditySeconds')}
            />
          </div>

          {/* Query Editor */}
          <div className={`settings-tab-panel${activeTab === 'editor' ? ' active' : ''}`}>
            <NumberSetting
              id="queryTimeout"
              label="Query Timeout (seconds)"
              description="Query execution timeout in seconds. Set to 0 for no timeout (infinite)."
              value={settings.queryTimeout}
              onChange={(v) => updateSetting('queryTimeout', v)}
              min={0}
              isModified={isSettingModified('queryTimeout')}
            />
            <BooleanSetting
              id="colorPrimaryForeignKeys"
              label="Color Primary / Foreign Keys"
              description="Color primary key columns (gold) and foreign key columns (blue) in query results."
              value={settings.colorPrimaryForeignKeys}
              onChange={(v) => updateSetting('colorPrimaryForeignKeys', v)}
              isModified={isSettingModified('colorPrimaryForeignKeys')}
            />
            <SelectSetting
              id="numberFormat"
              label="Number Format"
              description="Controls how numeric values are displayed in query results."
              value={settings.numberFormat}
              onChange={(v) => updateSetting('numberFormat', v as import('./types').NumberFormat)}
              isModified={isSettingModified('numberFormat')}
              options={[
                { value: 'plain', label: 'Plain (1234567.89)' },
                { value: 'locale', label: 'Locale (1,234,567.89)' },
                { value: 'fixed-2', label: '2 decimal places (1,234,567.89)' },
                { value: 'fixed-4', label: '4 decimal places (1,234,567.8900)' },
              ]}
            />
            <ColorSetting
              id="variableHighlightColor"
              label="Highlight Variables Color"
              description="Highlight SQL variables (e.g. @MyVar) in the editor with the chosen color. Clear the color to disable highlighting."
              value={settings.variableHighlightColor}
              onChange={(v) => updateSetting('variableHighlightColor', v)}
              isModified={isSettingModified('variableHighlightColor')}
            />
            <ColorSetting
              id="cteHighlightColor"
              label="Highlight CTE Color"
              description="Highlight CTE names in the editor with the chosen color. Clear the color to disable highlighting."
              value={settings.cteHighlightColor}
              onChange={(v) => updateSetting('cteHighlightColor', v)}
              isModified={isSettingModified('cteHighlightColor')}
            />
            <SelectSetting
              id="multipleResultSetsDisplay"
              label="Show Multiple Result Sets"
              description="Controls how multiple result sets are displayed: all stacked (Single view) or as separate switchable tabs (Separately)."
              value={settings.multipleResultSetsDisplay}
              onChange={(v) => updateSetting('multipleResultSetsDisplay', v as ExtensionSettings['multipleResultSetsDisplay'])}
              isModified={isSettingModified('multipleResultSetsDisplay')}
              options={[
                { value: 'single-view', label: 'Single view (all stacked)' },
                { value: 'separately', label: 'Separately (Set 1, Set 2, ...)' },
              ]}
            />
            <BooleanSetting
              id="queryHistorySaveOnlyUnique"
              label="Save Only Unique Queries"
              description="When enabled, executing the same query on the same connection refreshes the existing history item instead of creating a duplicate entry."
              value={settings.queryHistorySaveOnlyUnique}
              onChange={(v) => updateSetting('queryHistorySaveOnlyUnique', v)}
              isModified={isSettingModified('queryHistorySaveOnlyUnique')}
            />
          </div>

          {/* Formatting Options */}
          <div className={`settings-tab-panel settings-tab-panel--formatting${activeTab === 'formatting' ? ' active' : ''}`}>
            <div className="formatting-tab-layout">
              <div className="formatting-settings-panel">
                <NumberSetting
                  id="tabWidth"
                  label="Indent Width"
                  description="Number of spaces used for indentation when formatting SQL."
                  value={settings.tabWidth}
                  onChange={(v) => updateSetting('tabWidth', v)}
                  min={1}
                  max={8}
                  isModified={isSettingModified('tabWidth')}
                />
                <NumberSetting
                  id="linesBetweenQueries"
                  label="Lines Between Queries"
                  description="Number of blank lines inserted between separate SQL statements."
                  value={settings.linesBetweenQueries}
                  onChange={(v) => updateSetting('linesBetweenQueries', v)}
                  min={0}
                  max={5}
                  isModified={isSettingModified('linesBetweenQueries')}
                />
                <SelectSetting
                  id="keywordCase"
                  label="Keyword Case"
                  description="Transform SQL keywords to the selected case when formatting."
                  value={settings.keywordCase}
                  onChange={(v) => updateSetting('keywordCase', v as ExtensionSettings['keywordCase'])}
                  options={caseOptions}
                  isModified={isSettingModified('keywordCase')}
                />
                <SelectSetting
                  id="dataTypeCase"
                  label="Data Type Case"
                  description="Transform SQL data type names to the selected case when formatting."
                  value={settings.dataTypeCase}
                  onChange={(v) => updateSetting('dataTypeCase', v as ExtensionSettings['dataTypeCase'])}
                  options={caseOptions}
                  isModified={isSettingModified('dataTypeCase')}
                />
                <SelectSetting
                  id="functionCase"
                  label="Function Case"
                  description="Transform SQL function names to the selected case when formatting."
                  value={settings.functionCase}
                  onChange={(v) => updateSetting('functionCase', v as ExtensionSettings['functionCase'])}
                  options={caseOptions}
                  isModified={isSettingModified('functionCase')}
                />
                <SelectSetting
                  id="indentStyle"
                  label="Indentation Style"
                  description="Controls the indentation style used when formatting SQL."
                  value={settings.indentStyle}
                  onChange={(v) => updateSetting('indentStyle', v as ExtensionSettings['indentStyle'])}
                  options={[
                    { value: 'standard', label: 'Standard' },
                    { value: 'tabularLeft', label: 'Tabular, Left' },
                    { value: 'tabularRight', label: 'Tabular, Right' },
                  ]}
                  isModified={isSettingModified('indentStyle')}
                />
                <SelectSetting
                  id="logicalOperatorNewline"
                  label="AND/OR Newlines"
                  description="Place AND/OR logical operators before or after the line break."
                  value={settings.logicalOperatorNewline}
                  onChange={(v) => updateSetting('logicalOperatorNewline', v as ExtensionSettings['logicalOperatorNewline'])}
                  options={[
                    { value: 'before', label: 'Before' },
                    { value: 'after', label: 'After' },
                  ]}
                  isModified={isSettingModified('logicalOperatorNewline')}
                />
                <BooleanSetting
                  id="formatBeforeRun"
                  label="Format Before Run"
                  description="Automatically format SQL code before executing a query."
                  value={settings.formatBeforeRun}
                  onChange={(v) => updateSetting('formatBeforeRun', v)}
                  isModified={isSettingModified('formatBeforeRun')}
                />
              </div>
              <FormatPreview
                settings={{
                  tabWidth: settings.tabWidth,
                  keywordCase: settings.keywordCase,
                  dataTypeCase: settings.dataTypeCase,
                  functionCase: settings.functionCase,
                  linesBetweenQueries: settings.linesBetweenQueries,
                  indentStyle: settings.indentStyle,
                  logicalOperatorNewline: settings.logicalOperatorNewline,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
