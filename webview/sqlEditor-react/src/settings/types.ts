export type NumberFormat = 'plain' | 'locale' | 'fixed-2' | 'fixed-4';

export interface ExtensionSettings {
  // Database Explorer
  showTableStatistics: boolean;
  immediateActive: boolean;
  schemaCacheValiditySeconds: number;
  // Query Editor
  queryTimeout: number;
  colorPrimaryForeignKeys: boolean;
  numberFormat: NumberFormat;
  useReactWebview: boolean;
  /** CSS hex color for SQL variable highlights (e.g. '#6adc7a'). Empty = disabled. */
  variableHighlightColor: string;
  /** CSS hex color for CTE highlights (e.g. '#6adc7a'). Empty = disabled. */
  cteHighlightColor: string;
  /** How multiple result sets are displayed: stacked (single-view) or as separate tabs. */
  multipleResultSetsDisplay: 'single-view' | 'separately';
  // Formatting Options
  tabWidth: number;
  keywordCase: 'upper' | 'lower' | 'preserve';
  dataTypeCase: 'upper' | 'lower' | 'preserve';
  functionCase: 'upper' | 'lower' | 'preserve';
  linesBetweenQueries: number;
  indentStyle: 'standard' | 'tabularLeft' | 'tabularRight';
  logicalOperatorNewline: 'before' | 'after';
  formatBeforeRun: boolean;
}

export interface SettingsMessage {
  type: 'settingsLoaded';
  settings: ExtensionSettings;
}

export interface SettingsSavedMessage {
  type: 'settingsSaved';
}

export type IncomingMessage = SettingsMessage | SettingsSavedMessage;

export const defaultSettings: ExtensionSettings = {
  showTableStatistics: true,
  immediateActive: true,
  schemaCacheValiditySeconds: 120,
  queryTimeout: 0,
  colorPrimaryForeignKeys: true,
  numberFormat: 'plain',
  useReactWebview: false,
  variableHighlightColor: '#6adc7a',
  cteHighlightColor: '#6adc7a',
  multipleResultSetsDisplay: 'single-view' as const,
  tabWidth: 2,
  keywordCase: 'upper',
  dataTypeCase: 'upper',
  functionCase: 'upper',
  linesBetweenQueries: 1,
  indentStyle: 'standard',
  logicalOperatorNewline: 'before',
  formatBeforeRun: false,
};
