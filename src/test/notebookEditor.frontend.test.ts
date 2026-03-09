import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Notebook Frontend UI Test', () => {
    const codeCellPath = path.resolve(__dirname, '../../webview/sqlNotebook/src/components/CodeCell.tsx');
    const markdownCellPath = path.resolve(__dirname, '../../webview/sqlNotebook/src/components/MarkdownCell.tsx');
    const cssPath = path.resolve(__dirname, '../../webview/sqlNotebook/src/index.css');
    const toolbarPath = path.resolve(__dirname, '../../webview/sqlNotebook/src/components/Toolbar.tsx');
    const cellOutputAreaPath = path.resolve(__dirname, '../../webview/sqlNotebook/src/components/CellOutputArea.tsx');
    const appPath = path.resolve(__dirname, '../../webview/sqlNotebook/src/App.tsx');

    test('should configure Monaco to show scrollbars for long SQL scripts', () => {
        const codeCellSource = fs.readFileSync(codeCellPath, 'utf8');

        assert.ok(
            codeCellSource.includes("vertical: 'auto'"),
            'Code cell Monaco editor should enable vertical scrollbar in auto mode'
        );
        assert.ok(
            codeCellSource.includes("horizontal: 'auto'"),
            'Code cell Monaco editor should enable horizontal scrollbar in auto mode'
        );
        assert.ok(
            codeCellSource.includes("wordWrap: 'off'"),
            'Code cell Monaco editor should disable wrapping so horizontal scrolling is possible'
        );
    });

    test('should render copy code icon button instead of SQL badge in cell toolbar', () => {
        const codeCellSource = fs.readFileSync(codeCellPath, 'utf8');

        assert.ok(
            codeCellSource.includes('className="copy-cell-btn"'),
            'Code cell toolbar should include a copy icon button'
        );
        assert.ok(
            codeCellSource.includes('title="Copy cell code"'),
            'Copy icon button should expose a tooltip title'
        );
        assert.ok(
            codeCellSource.includes('aria-label="Copy cell code"'),
            'Copy icon button should include aria-label for accessibility'
        );
        assert.ok(
            !codeCellSource.includes('className="cell-type-badge sql">SQL</span>'),
            'SQL badge label should be removed from the toolbar'
        );
    });

    test('should allow source area scrolling in CSS layout', () => {
        const cssSource = fs.readFileSync(cssPath, 'utf8');

        assert.ok(
            cssSource.includes('.cell-source {'),
            'Cell source CSS block should exist'
        );
        assert.ok(
            cssSource.includes('overflow: auto;'),
            'Cell source container should allow overflow scrolling'
        );
    });

    test('should render markdown fenced code blocks using Monaco editor with detected language', () => {
        const markdownCellSource = fs.readFileSync(markdownCellPath, 'utf8');

        assert.ok(
            markdownCellSource.includes('splitMarkdownIntoSegments'),
            'Markdown cell should split source into markdown and code segments'
        );
        assert.ok(
            markdownCellSource.includes("const fenceRegex = /```([\\w+-]*)\\s*\\n([\\s\\S]*?)```/g;"),
            'Markdown cell should detect fenced code blocks with optional language'
        );
        assert.ok(
            markdownCellSource.includes('normalizeCodeBlockContent'),
            'Markdown cell should normalize code block content to avoid leading/trailing blank lines'
        );
        assert.ok(
            markdownCellSource.includes("language={segment.language}"),
            'Monaco editor in markdown should receive language from fenced block'
        );
        assert.ok(
            markdownCellSource.includes("lineNumbers: 'off'"),
            'Markdown code Monaco editor should hide line numbers'
        );
        assert.ok(
            markdownCellSource.includes("vertical: 'hidden'"),
            'Markdown code Monaco editor should hide vertical scrollbar'
        );
        assert.ok(
            markdownCellSource.includes("horizontal: 'hidden'"),
            'Markdown code Monaco editor should hide horizontal scrollbar'
        );
    });

    test('should include dedicated CSS container for Monaco markdown code blocks', () => {
        const cssSource = fs.readFileSync(cssPath, 'utf8');

        assert.ok(
            cssSource.includes('.markdown-code-block {'),
            'CSS should define markdown Monaco code block container'
        );
        assert.ok(
            cssSource.includes('border: 1px solid var(--vscode-panel-border, #333);'),
            'Markdown Monaco code block should have notebook-consistent border'
        );
        assert.ok(
            cssSource.includes('overflow: hidden;'),
            'Markdown Monaco code block container should hide overflow for clean rendering'
        );
    });

    test('should keep horizontal overflow scoped to markdown tables', () => {
        const cssSource = fs.readFileSync(cssPath, 'utf8');

        assert.ok(
            cssSource.includes('.markdown-content table {'),
            'CSS should define markdown table styles'
        );
        assert.ok(
            cssSource.includes('max-width: 100%;'),
            'Markdown tables should be constrained to container width'
        );
        assert.ok(
            cssSource.includes('overflow-x: auto;'),
            'Markdown tables should expose local horizontal scrolling'
        );
    });

    test('should include clear result button in CellOutputArea', () => {
        const outputSource = fs.readFileSync(cellOutputAreaPath, 'utf8');

        assert.ok(
            outputSource.includes('onClearResult'),
            'CellOutputArea should accept onClearResult prop'
        );
        assert.ok(
            outputSource.includes('className="clear-result-btn"'),
            'CellOutputArea should render clear result button'
        );
        assert.ok(
            outputSource.includes('title="Clear results"'),
            'Clear result button should have tooltip'
        );
    });

    test('should pass onClearResult from CodeCell to CellOutputArea', () => {
        const codeCellSource = fs.readFileSync(codeCellPath, 'utf8');

        assert.ok(
            codeCellSource.includes('onClearResult'),
            'CodeCell should accept onClearResult prop'
        );
        assert.ok(
            codeCellSource.includes('onClearResult={() => onClearResult(index)}'),
            'CodeCell should forward onClearResult to CellOutputArea'
        );
    });

    test('should have delayed hover for markdown toolbar via CSS transition-delay', () => {
        const cssSource = fs.readFileSync(cssPath, 'utf8');

        assert.ok(
            cssSource.includes('transition: opacity 0.15s ease 500ms'),
            'Markdown toolbar hover should have 500ms transition delay'
        );
        assert.ok(
            cssSource.includes('pointer-events: none'),
            'Markdown toolbar should disable pointer events when hidden'
        );
        assert.ok(
            cssSource.includes('pointer-events: auto'),
            'Markdown toolbar should enable pointer events when visible'
        );
    });

    test('should include Clear All Results button in Toolbar', () => {
        const toolbarSource = fs.readFileSync(toolbarPath, 'utf8');

        assert.ok(
            toolbarSource.includes('onClearAllResults'),
            'Toolbar should accept onClearAllResults prop'
        );
        assert.ok(
            toolbarSource.includes('hasResults'),
            'Toolbar should accept hasResults prop'
        );
        assert.ok(
            toolbarSource.includes('title="Clear All Results"'),
            'Clear All Results button should have tooltip'
        );
    });

    test('should wire clearResult and clearAllResults in App component', () => {
        const appSource = fs.readFileSync(appPath, 'utf8');

        assert.ok(
            appSource.includes('clearResult'),
            'App should define clearResult function'
        );
        assert.ok(
            appSource.includes('clearAllResults'),
            'App should define clearAllResults function'
        );
        assert.ok(
            appSource.includes('hasResults'),
            'App should compute hasResults from cellStates'
        );
        assert.ok(
            appSource.includes('onClearAllResults={clearAllResults}'),
            'App should pass clearAllResults to Toolbar'
        );
        assert.ok(
            appSource.includes('onClearResult={clearResult}'),
            'App should pass clearResult to CodeCell'
        );
    });

    test('should have CSS styles for clear result button', () => {
        const cssSource = fs.readFileSync(cssPath, 'utf8');

        assert.ok(
            cssSource.includes('.clear-result-btn {'),
            'CSS should define clear result button styles'
        );
        assert.ok(
            cssSource.includes('.cell-output:hover .clear-result-btn'),
            'Clear result button should appear on cell output hover'
        );
    });
});
