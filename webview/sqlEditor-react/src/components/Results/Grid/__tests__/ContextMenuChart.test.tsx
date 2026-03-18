import { describe, it, expect } from 'vitest';
import { buildCellMenuItems, buildColumnMenuItems } from '../ContextMenu';

describe('ContextMenu — Create Chart items', () => {
  it('buildCellMenuItems includes Create Chart option', () => {
    const items = buildCellMenuItems({ isEditable: false });
    const chartItem = items.find(i => i.id === 'createChart');
    expect(chartItem).toBeDefined();
    expect(chartItem!.label).toBe('Create Chart…');
  });

  it('buildCellMenuItems includes Create Chart when editable', () => {
    const items = buildCellMenuItems({ isEditable: true });
    const chartItem = items.find(i => i.id === 'createChart');
    expect(chartItem).toBeDefined();
  });

  it('buildCellMenuItems includes Create Chart with multi-selection', () => {
    const items = buildCellMenuItems({ isEditable: true, selectionSize: 5 });
    const chartItem = items.find(i => i.id === 'createChart');
    expect(chartItem).toBeDefined();
  });

  it('buildColumnMenuItems includes Create Chart option', () => {
    const items = buildColumnMenuItems();
    const chartItem = items.find(i => i.id === 'createChart');
    expect(chartItem).toBeDefined();
    expect(chartItem!.label).toBe('Create Chart…');
  });
});
