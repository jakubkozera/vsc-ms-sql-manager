import { describe, it, expect } from 'vitest';
import { builtInSnippets, getAllSnippets } from './sqlSnippets';

describe('sqlSnippets', () => {
  describe('builtInSnippets', () => {
    it('should contain at least 50 snippets', () => {
      expect(builtInSnippets.length).toBeGreaterThanOrEqual(50);
    });

    it('should have unique prefixes', () => {
      const prefixes = builtInSnippets.map((s) => s.prefix);
      const uniquePrefixes = [...new Set(prefixes)];
      expect(uniquePrefixes.length).toBe(prefixes.length);
    });

    it('each snippet should have required properties', () => {
      for (const snippet of builtInSnippets) {
        expect(snippet.prefix).toBeDefined();
        expect(snippet.prefix.length).toBeGreaterThan(0);
        expect(snippet.body).toBeDefined();
        expect(snippet.body.length).toBeGreaterThan(0);
        expect(snippet.description).toBeDefined();
      }
    });
  });

  describe('common snippets', () => {
    const findSnippet = (prefix: string) => 
      builtInSnippets.find((s) => s.prefix === prefix);

    it('should have SELECT snippet (sel)', () => {
      const snippet = findSnippet('sel');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('SELECT');
    });

    it('should have INSERT snippet (ins)', () => {
      const snippet = findSnippet('ins');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('INSERT');
    });

    it('should have UPDATE snippet (upd)', () => {
      const snippet = findSnippet('upd');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('UPDATE');
    });

    it('should have DELETE snippet (del)', () => {
      const snippet = findSnippet('del');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('DELETE');
    });

    it('should have CREATE TABLE snippet (table)', () => {
      const snippet = findSnippet('table');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('CREATE TABLE');
    });

    it('should have CREATE PROCEDURE snippet (proc)', () => {
      const snippet = findSnippet('proc');
      expect(snippet).toBeDefined();
      // Uses CREATE OR ALTER syntax
      expect(snippet?.body).toContain('PROCEDURE');
    });

    it('should have CREATE VIEW snippet (view)', () => {
      const snippet = findSnippet('view');
      expect(snippet).toBeDefined();
      // Uses CREATE OR ALTER syntax
      expect(snippet?.body).toContain('VIEW');
    });

    it('should have CREATE FUNCTION snippet (func)', () => {
      const snippet = findSnippet('func');
      expect(snippet).toBeDefined();
      // Uses CREATE OR ALTER syntax
      expect(snippet?.body).toContain('FUNCTION');
    });

    it('should have CTE snippet (cte)', () => {
      const snippet = findSnippet('cte');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('WITH');
    });

    it('should have TRANSACTION snippet (tran)', () => {
      const snippet = findSnippet('tran');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('BEGIN TRANSACTION');
    });

    it('should have TRY-CATCH snippet (try)', () => {
      const snippet = findSnippet('try');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('BEGIN TRY');
    });

    it('should have MERGE snippet (merge)', () => {
      const snippet = findSnippet('merge');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('MERGE');
    });

    it('should have PIVOT snippet (pivot)', () => {
      const snippet = findSnippet('pivot');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('PIVOT');
    });

    it('should have CURSOR snippet (cursor)', () => {
      const snippet = findSnippet('cursor');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('CURSOR');
    });

    it('should have INDEX snippet (reindex)', () => {
      const snippet = findSnippet('reindex');
      expect(snippet).toBeDefined();
      expect(snippet?.body).toContain('INDEX');
    });

    it('should have SELECT related snippets', () => {
      // The snippets include various SELECT patterns
      const hasSelect = builtInSnippets.some((s) => s.body.includes('SELECT'));
      expect(hasSelect).toBe(true);
    });
  });

  describe('getAllSnippets', () => {
    it('should return built-in snippets', () => {
      const snippets = getAllSnippets();
      expect(snippets.length).toBe(builtInSnippets.length);
    });

    it('should include custom snippets', () => {
      const customSnippets = [
        { name: 'Custom 1', prefix: 'custom1', body: 'SELECT 1', description: 'Custom 1' },
        { name: 'Custom 2', prefix: 'custom2', body: 'SELECT 2', description: 'Custom 2' },
      ];
      const snippets = getAllSnippets(customSnippets);
      expect(snippets.length).toBe(builtInSnippets.length + 2);
    });

    it('should include custom snippets in the list', () => {
      const customSnippets = [
        { name: 'My Custom', prefix: 'myCustom', body: 'MY CUSTOM SELECT', description: 'Custom select' },
      ];
      const snippets = getAllSnippets(customSnippets);
      const customSnippet = snippets.find((s) => s.prefix === 'myCustom');
      expect(customSnippet?.body).toBe('MY CUSTOM SELECT');
    });
  });

  describe('snippet categories', () => {
    it('should have DML snippets', () => {
      const dmlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'];
      for (const keyword of dmlKeywords) {
        const hasSnippet = builtInSnippets.some((s) => 
          s.body.includes(keyword)
        );
        expect(hasSnippet).toBe(true);
      }
    });

    it('should have DDL snippets', () => {
      // Look for TABLE, INDEX patterns (may use CREATE OR ALTER)
      const ddlPatterns = ['TABLE', 'INDEX'];
      for (const pattern of ddlPatterns) {
        const hasSnippet = builtInSnippets.some((s) => 
          s.body.includes(pattern)
        );
        expect(hasSnippet).toBe(true);
      }
    });

    it('should have control flow snippets', () => {
      // Look for common control patterns - transaction contains BEGIN
      const hasTran = builtInSnippets.some((s) => 
        s.body.includes('BEGIN')
      );
      expect(hasTran).toBe(true);
    });

    it('should have error handling snippets', () => {
      const hasErrorHandling = builtInSnippets.some((s) => 
        s.body.includes('TRY') && s.body.includes('CATCH')
      );
      expect(hasErrorHandling).toBe(true);
    });
  });
});
