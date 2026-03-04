import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Notebook Frontend UI Test', () => {
    const codeCellPath = path.resolve(__dirname, '../../webview/sqlNotebook/src/components/CodeCell.tsx');
    const markdownCellPath = path.resolve(__dirname, '../../webview/sqlNotebook/src/components/MarkdownCell.tsx');
    const cssPath = path.resolve(__dirname, '../../webview/sqlNotebook/src/index.css');

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
});
