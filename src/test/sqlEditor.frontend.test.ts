import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import * as sinon from 'sinon';

suite('SQL Editor Frontend Integration Test', () => {
    let dom: JSDOM;
    let window: any;
    let document: any;
    let vscodeMock: any;

    setup(() => {
        // Mock VS Code API
        vscodeMock = {
            postMessage: sinon.spy(),
            getState: () => ({}),
            setState: () => {}
        };

        // Create JSDOM environment with necessary DOM elements
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <body>
                <div id="container">
                    <div id="toolbar">
                        <button id="executeButton"></button>
                        <div id="executeDropdownMenu"></div>
                        <button id="cancelButton"></button>
                        <button id="connectButton"></button>
                        <div id="connectionSelector"></div>
                        <div id="databaseSelector"></div>
                        <span id="statusLabel"></span>
                    </div>
                    <div id="editorContainer">
                        <div id="editor"></div>
                    </div>
                    <div id="resultsContainer">
                        <div class="results-tabs">
                            <button class="results-tab active" data-tab="results">Results</button>
                            <button class="results-tab" data-tab="messages">Messages</button>
                            <button class="results-tab" data-tab="pendingChanges">Pending Changes <span id="pendingChangesCount">0</span></button>
                            <button id="quickSaveButton" style="display: none;"></button>
                            <div id="quickSaveTooltip"></div>
                        </div>
                        <div id="resultsContent" class="tab-content active"></div>
                        <div id="messagesContent" class="tab-content"></div>
                        <div id="pendingChangesContent" class="tab-content"></div>
                        <div id="queryPlanContent" class="tab-content"></div>
                        <div id="planTreeContent" class="tab-content"></div>
                        <div id="topOperationsContent" class="tab-content"></div>
                    </div>
                </div>
            </body>
            </html>
        `, {
            runScripts: "dangerously",
            resources: "usable",
            url: "http://localhost/"
        });
        window = dom.window;
        document = window.document;

        // Mock global objects
        window.acquireVsCodeApi = () => vscodeMock;
        
        // Mock AMD require for Monaco Editor
        (window as any).require = (deps: any[], callback: Function) => {
            console.log('Mock require called with:', deps);
            if (callback) callback();
        };
        (window as any).require.config = (config: any) => {
            console.log('Mock require.config called with:', config);
        };

        // Mock Monaco Editor
        (window as any).monaco = {
            editor: {
                create: () => ({
                    getValue: () => 'SELECT * FROM test',
                    setValue: () => {},
                    layout: () => {},
                    dispose: () => {},
                    onDidChangeModelContent: () => ({ dispose: () => {} }),
                    onMouseDown: () => ({ dispose: () => {} }),
                    onKeyDown: () => ({ dispose: () => {} }),
                    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
                    getPosition: () => ({ lineNumber: 1, column: 1 }),
                    addAction: () => {},
                    addCommand: () => {},
                    getModel: () => ({
                        getValueInRange: () => '',
                        getLineCount: () => 0,
                        getLineMaxColumn: () => 0
                    })
                })
            },
            languages: {
                registerHoverProvider: () => ({ dispose: () => {} }),
                registerCompletionItemProvider: () => ({ dispose: () => {} }),
                setMonarchTokensProvider: () => {},
                register: () => {}
            },
            KeyMod: {
                CtrlCmd: 2048,
                Alt: 512
            },
            KeyCode: {
                Enter: 3
            }
        };

        // Mock console to avoid noise but allow debugging
        window.console = {
            log: console.log, // Enable logs to see what's happening
            error: console.error,
            warn: console.warn,
            info: console.info
        };

        // Mock Canvas getContext for text measurement
        (window as any).HTMLCanvasElement.prototype.getContext = () => {
            return {
                measureText: (text: string) => ({ width: text.length * 8 }), // Approximate width
                font: ''
            };
        };

        // Load all scripts in order
        const scripts = [
            'snippets.js',
            'utils.js',
            'ui.js',
            'grid.js',
            'tabs.js',
            'editor.js',
            'query.js',
            'plan.js',
            'sqlEditor.js'
        ];

        for (const scriptName of scripts) {
            const scriptPath = path.resolve(__dirname, '../../webview/sqlEditor', scriptName);
            console.log(`Loading ${scriptName} from ${scriptPath}`);
            
            if (fs.existsSync(scriptPath)) {
                const scriptContent = fs.readFileSync(scriptPath, 'utf8');
                try {
                    window.eval(scriptContent);
                    console.log(`${scriptName} evaluated.`);
                } catch (e: any) {
                    console.error(`Error loading ${scriptName}:`, e);
                }
            } else {
                console.warn(`Script not found: ${scriptName}`);
            }
        }
            
        // Trigger DOMContentLoaded manually as the script might rely on it
        // and JSDOM might have already fired it before script execution
        const event = new window.Event('DOMContentLoaded');
        document.dispatchEvent(event);
        console.log('DOMContentLoaded dispatched.');
    });


    test('should handle queryResults message and render grid', async () => {
        // Simulate message
        const message = {
            type: 'results',
            resultSets: [
                [
                    { id: 1, name: 'Test Row 1' },
                    { id: 2, name: 'Test Row 2' }
                ]
            ],
            columnNames: [['id', 'name']],
            messages: ['Query executed successfully'],
            originalQuery: 'SELECT * FROM test'
        };

        // Trigger message event
        const event = new window.MessageEvent('message', {
            data: message
        });
        window.dispatchEvent(event);

        // Allow some time for async operations (if any)
        await new Promise(resolve => setTimeout(resolve, 100));

        // Assertions
        const resultsTab = document.getElementById('resultsContent');
        // console.log('Results HTML:', resultsTab.innerHTML);
        assert.ok(resultsTab.innerHTML.length > 0, 'Results tab should have content');
        
        // Check if grid headers are rendered
        const html = resultsTab.innerHTML;
        assert.ok(html.includes('id'), 'Header "id" should be rendered');
        assert.ok(html.includes('name'), 'Header "name" should be rendered');
    });

    test('should switch tabs correctly', () => {
        // Get tabs
        const resultsTabBtn = document.querySelector('[data-tab="results"]');
        const messagesTabBtn = document.querySelector('[data-tab="messages"]');
        
        // Click messages tab
        const clickEvent = new window.MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        });
        messagesTabBtn.dispatchEvent(clickEvent);

        // Check active class
        assert.ok(messagesTabBtn.classList.contains('active'), 'Messages tab should be active');
        assert.ok(!resultsTabBtn.classList.contains('active'), 'Results tab should not be active');
        
        // Check content visibility
        const messagesContent = document.getElementById('messagesContent');
        const resultsContent = document.getElementById('resultsContent');
        
        assert.strictEqual(messagesContent.style.display, 'block', 'Messages content should be visible');
        assert.strictEqual(resultsContent.style.display, 'none', 'Results content should be hidden');
    });
});
