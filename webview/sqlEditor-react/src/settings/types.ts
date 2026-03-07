export interface ExtensionSettings {
  // Database Explorer
  showTableStatistics: boolean;
  immediateActive: boolean;
  schemaCacheValiditySeconds: number;
  // Query Editor
  queryTimeout: number;
  colorPrimaryForeignKeys: boolean;
  useReactWebview: boolean;
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
  useReactWebview: false,
  tabWidth: 2,
  keywordCase: 'upper',
  dataTypeCase: 'upper',
  functionCase: 'upper',
  linesBetweenQueries: 1,
  indentStyle: 'standard',
  logicalOperatorNewline: 'before',
  formatBeforeRun: false,
};
