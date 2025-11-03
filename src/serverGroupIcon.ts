import * as vscode from 'vscode';

function createThemedSvgIcon(lightSvg: string, darkSvg: string): { light: vscode.Uri; dark: vscode.Uri } {
	const lightUri = vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(lightSvg)}`);
	const darkUri = vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(darkSvg)}`);
	return { light: lightUri, dark: darkUri };
}

export function createServerGroupIcon(color: string, isOpen: boolean = false, iconType: 'folder' | 'folder-heroicons' | 'vscode-folder' = 'folder'): { light: vscode.Uri; dark: vscode.Uri } {
    let svgLight: string;
    let svgDark: string;

    if (iconType === 'folder-heroicons') {
        // Heroicons folder icon
        svgLight = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
        </svg>`;
        svgDark = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
            <path d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
        </svg>`;
    } else if (iconType === 'vscode-folder') {
        // VS Code native folder icon style
        svgLight = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 7L11.8845 4.76892C11.5634 4.1268 11.4029 3.80573 11.1634 3.57116C10.9516 3.36373 10.6963 3.20597 10.4161 3.10931C10.0992 3 9.74021 3 9.02229 3H5.2C4.0799 3 3.51984 3 3.09202 3.21799C2.71569 3.40973 2.40973 3.71569 2.21799 4.09202C2 4.51984 2 5.0799 2 6.2V7M2 7H17.2C18.8802 7 19.7202 7 20.362 7.32698C20.9265 7.6146 21.3854 8.07354 21.673 8.63803C22 9.27976 22 10.1198 22 11.8V16.2C22 17.8802 22 18.7202 21.673 19.362C21.3854 19.9265 20.9265 20.3854 20.362 20.673C19.7202 21 18.8802 21 17.2 21H6.8C5.11984 21 4.27976 21 3.63803 20.673C3.07354 20.3854 2.6146 19.9265 2.32698 19.362C2 18.7202 2 17.8802 2 16.2V7Z" />
        </svg>`;
        svgDark = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
            <path d="M13 7L11.8845 4.76892C11.5634 4.1268 11.4029 3.80573 11.1634 3.57116C10.9516 3.36373 10.6963 3.20597 10.4161 3.10931C10.0992 3 9.74021 3 9.02229 3H5.2C4.0799 3 3.51984 3 3.09202 3.21799C2.71569 3.40973 2.40973 3.71569 2.21799 4.09202C2 4.51984 2 5.0799 2 6.2V7M2 7H17.2C18.8802 7 19.7202 7 20.362 7.32698C20.9265 7.6146 21.3854 8.07354 21.673 8.63803C22 9.27976 22 10.1198 22 11.8V16.2C22 17.8802 22 18.7202 21.673 19.362C21.3854 19.9265 20.9265 20.3854 20.362 20.673C19.7202 21 18.8802 21 17.2 21H6.8C5.11984 21 4.27976 21 3.63803 20.673C3.07354 20.3854 2.6146 19.9265 2.32698 19.362C2 18.7202 2 17.8802 2 16.2V7Z" />
        </svg>`;
    } else {
        // Default folder icon (existing)
        svgLight = isOpen
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2" />
            </svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />
            </svg>`;
            
        svgDark = isOpen
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
                <path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2" />
            </svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
                <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />
            </svg>`;
    }

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

export function createFunctionIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h10.666a2.667 2.667 0 0 1 2.667 2.667v10.666a2.667 2.667 0 0 1 -2.667 2.667h-10.666a2.667 2.667 0 0 1 -2.667 -2.667z" />
        <path d="M9 15.5v.25c0 .69 .56 1.25 1.25 1.25c.71 0 1.304 -.538 1.374 -1.244l.752 -7.512a1.381 1.381 0 0 1 1.374 -1.244c.69 0 1.25 .56 1.25 1.25v.25" />
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h10.666a2.667 2.667 0 0 1 2.667 2.667v10.666a2.667 2.667 0 0 1 -2.667 2.667h-10.666a2.667 2.667 0 0 1 -2.667 -2.667z" />
        <path d="M9 15.5v.25c0 .69 .56 1.25 1.25 1.25c.71 0 1.304 -.538 1.374 -1.244l.752 -7.512a1.381 1.381 0 0 1 1.374 -1.244c.69 0 1.25 .56 1.25 1.25v.25" />
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}

export function createTriggerIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11" />
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11" />
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}

export function createTypeIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 5h11" />
        <path d="M9 3v2c0 4.418 -2.239 8 -5 8" />
        <path d="M8 9a14 14 0 0 0 6 6" />
        <path d="M3 13c6 0 10 -4 10 -10" />
        <path d="M17 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 5h11" />
        <path d="M9 3v2c0 4.418 -2.239 8 -5 8" />
        <path d="M8 9a14 14 0 0 0 6 6" />
        <path d="M3 13c6 0 10 -4 10 -10" />
        <path d="M17 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}

export function createSequenceIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 5h3a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z" />
        <path d="M9 14h3a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z" />
        <path d="M5 7h4" />
        <path d="M5 16h4" />
        <path d="M11.5 10v4" />
        <path d="M16 7l3 3l-3 3" />
        <path d="M16 16l3 -3" />
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 5h3a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z" />
        <path d="M9 14h3a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z" />
        <path d="M5 7h4" />
        <path d="M5 16h4" />
        <path d="M11.5 10v4" />
        <path d="M16 7l3 3l-3 3" />
        <path d="M16 16l3 -3" />
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}

export function createSynonymIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 18h10" />
        <path d="M7 15l5 -5l5 5" />
        <path d="M7 12l5 -5l5 5" />
        <path d="M7 9l5 -5l5 5" />
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 18h10" />
        <path d="M7 15l5 -5l5 5" />
        <path d="M7 12l5 -5l5 5" />
        <path d="M7 9l5 -5l5 5" />
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}

export function createAssemblyIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5" />
        <path d="M12 12l8 -4.5" />
        <path d="M12 12l0 9" />
        <path d="M12 12l-8 -4.5" />
    </svg>`;
    
    const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5" />
        <path d="M12 12l8 -4.5" />
        <path d="M12 12l0 9" />
        <path d="M12 12l-8 -4.5" />
    </svg>`;

    return createThemedSvgIcon(lightSvg, darkSvg);
}