import * as vscode from 'vscode';

export function createServerGroupIcon(color: string): vscode.Uri {

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2"/>
    </svg>`;

    // Create data URI
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    return vscode.Uri.parse(dataUri);
}

export function createFolderIcon(): vscode.ThemeIcon {
    return new vscode.ThemeIcon('folder');
}