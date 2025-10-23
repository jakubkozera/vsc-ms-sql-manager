import * as vscode from 'vscode';

function createThemedSvgIcon(lightSvg: string, darkSvg: string): { light: vscode.Uri; dark: vscode.Uri } {
	const lightUri = vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(lightSvg)}`);
	const darkUri = vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(darkSvg)}`);
	return { light: lightUri, dark: darkUri };
}

export function createServerGroupIcon(color: string, isOpen: boolean = false): { light: vscode.Uri; dark: vscode.Uri } {
    const svgLight = isOpen
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2" />
        </svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />
        </svg>`;
        
    const svgDark = isOpen
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
            <path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2" />
        </svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
            <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />
        </svg>`;

    return createThemedSvgIcon(svgLight, svgDark);
}

export function createTableIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z" />
        <path d="M3 10h18" />
        <path d="M10 3v18" />
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z" />
        <path d="M3 10h18" />
        <path d="M10 3v18" />
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}

export function createColumnIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 3m0 1a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1zm6 -1v18m6 -18v18" />
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 3m0 1a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1zm6 -1v18m6 -18v18" />
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}

export function createStoredProcedureIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 8a2 2 0 0 1 2 2v4a2 2 0 1 1 -4 0v-4a2 2 0 0 1 2 -2z" />
        <path d="M17 8v8h4" />
        <path d="M13 15l1 1" />
        <path d="M3 15a1 1 0 0 0 1 1h2a1 1 0 0 0 1 -1v-2a1 1 0 0 0 -1 -1h-2a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1" />
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 8a2 2 0 0 1 2 2v4a2 2 0 1 1 -4 0v-4a2 2 0 0 1 2 -2z" />
        <path d="M17 8v8h4" />
        <path d="M13 15l1 1" />
        <path d="M3 15a1 1 0 0 0 1 1h2a1 1 0 0 0 1 -1v-2a1 1 0 0 0 -1 -1h-2a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1" />
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}

export function createViewIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.73 19.875a2.225 2.225 0 0 1 -1.948 1.125h-7.283a2.222 2.222 0 0 1 -1.947 -1.158l-4.272 -6.75a2.269 2.269 0 0 1 0 -2.184l4.272 -6.75a2.225 2.225 0 0 1 1.946 -1.158h7.285c.809 0 1.554 .443 1.947 1.158l3.98 6.75a2.33 2.33 0 0 1 0 2.25l-3.98 6.75v-.033z" />
        <path d="M11.5 11.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0" />
        <path d="M14 14l2 2" />
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.73 19.875a2.225 2.225 0 0 1 -1.948 1.125h-7.283a2.222 2.222 0 0 1 -1.947 -1.158l-4.272 -6.75a2.269 2.269 0 0 1 0 -2.184l4.272 -6.75a2.225 2.225 0 0 1 1.946 -1.158h7.285c.809 0 1.554 .443 1.947 1.158l3.98 6.75a2.33 2.33 0 0 1 0 2.25l-3.98 6.75v-.033z" />
        <path d="M11.5 11.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0" />
        <path d="M14 14l2 2" />
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}

export function createLoadingSpinnerIcon(): vscode.Uri {
    const svg = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
        <style>
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .spinner {
                transform-origin: center;
                animation: spin 1s linear infinite;
            }
        </style>
        <circle class="spinner" cx="12" cy="12" r="10" fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round" stroke-dasharray="50 15" />
    </svg>`;
    
    return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

export function createDatabaseIcon(isActive: boolean = false): { light: vscode.Uri; dark: vscode.Uri } {
    const color = isActive ? '#73C991' : '#000000';
    const colorDark = isActive ? '#73C991' : '#CCCCCC';
    
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <g transform="translate(-0.005)">
            <path d="m 3.92,7.11 v 1 h 2 v 3 h -3 v -1 h 2 v -1 h -2 v -3 h 3 v 1 z m 6.59,5.31 -1.34,-1.34 H 6.9 v -5 h 3 v 4.26 l 1.35,1.34 z M 7.89,10.09 h 1 v -3 h -1 z m 4,0 v -4 h -1 v 5 h 2 v -1 z" fill="${color}"/>
        </g>
        <path d="m 7.995,0 c -2.4,0 -6.43,0.49 -6.54,2.16 V 13.7 c 0,1.78 4.11,2.3 6.54,2.3 2.43,0 6.55,-0.48 6.55,-2.26 V 2.16 C 14.425,0.49 10.395,0 7.995,0 Z m 5.44,13.7 c -0.14,0.4 -2.18,1.16 -5.45,1.16 -3.27,0 -5.32,-0.77 -5.43,-1.16 V 3.53 a 14.47,14.47 0 0 0 5.44,0.88 14.51,14.51 0 0 0 5.45,-0.88 z m 0,-11.48 c -0.17,0.38 -2.19,1.09 -5.44,1.09 -3.25,0 -5.2,-0.69 -5.43,-1.08 0.22,-0.39 2.21,-1.09 5.43,-1.09 3.22,0 5.27,0.72 5.45,1.06 v 0 z" fill="${color}"/>
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <g transform="translate(-0.005)">
            <path d="m 3.92,7.11 v 1 h 2 v 3 h -3 v -1 h 2 v -1 h -2 v -3 h 3 v 1 z m 6.59,5.31 -1.34,-1.34 H 6.9 v -5 h 3 v 4.26 l 1.35,1.34 z M 7.89,10.09 h 1 v -3 h -1 z m 4,0 v -4 h -1 v 5 h 2 v -1 z" fill="${colorDark}"/>
        </g>
        <path d="m 7.995,0 c -2.4,0 -6.43,0.49 -6.54,2.16 V 13.7 c 0,1.78 4.11,2.3 6.54,2.3 2.43,0 6.55,-0.48 6.55,-2.26 V 2.16 C 14.425,0.49 10.395,0 7.995,0 Z m 5.44,13.7 c -0.14,0.4 -2.18,1.16 -5.45,1.16 -3.27,0 -5.32,-0.77 -5.43,-1.16 V 3.53 a 14.47,14.47 0 0 0 5.44,0.88 14.51,14.51 0 0 0 5.45,-0.88 z m 0,-11.48 c -0.17,0.38 -2.19,1.09 -5.44,1.09 -3.25,0 -5.2,-0.69 -5.43,-1.08 0.22,-0.39 2.21,-1.09 5.43,-1.09 3.22,0 5.27,0.72 5.45,1.06 v 0 z" fill="${colorDark}"/>
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}