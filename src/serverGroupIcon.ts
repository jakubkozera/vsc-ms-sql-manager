import * as vscode from 'vscode';

export function createServerGroupIcon(color: string): vscode.Uri {
    const svg = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path fill="${color}" d="M2 2v12h12V2H2zm1 1h10v10H3V3z"/>
        <path fill="${color}" d="M4 4h8v1H4V4zm0 2h8v1H4V6zm0 2h6v1H4V8zm0 2h8v1H4v-1z"/>
        <circle cx="12.5" cy="5.5" r="1.5" fill="${color}" opacity="0.8"/>
    </svg>`;

    // Create data URI
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    return vscode.Uri.parse(dataUri);
}

export function createFolderIcon(): vscode.ThemeIcon {
    return new vscode.ThemeIcon('folder');
}