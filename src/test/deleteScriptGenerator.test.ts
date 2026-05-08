import * as assert from 'assert';
import { buildTargetFilter, generateDependentDeletes, traceColumnsToRoot, FKDependency, PKColumn } from '../utils/deleteScriptGenerator';

suite('Delete Script Generator', () => {

    suite('buildTargetFilter', () => {
        test('should return direct PK comparison when target is root table', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const depLookup = new Map<string, FKDependency>();

            const result = buildTargetFilter('dbo', 'Members', 'dbo', 'Members', pkColumns, depLookup, new Set());

            assert.strictEqual(result, '[Id] = @Target_Id');
        });

        test('should return composite PK comparison when target is root with composite PK', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'OrderId' }, { COLUMN_NAME: 'ProductId' }];
            const depLookup = new Map<string, FKDependency>();

            const result = buildTargetFilter('dbo', 'OrderDetails', 'dbo', 'OrderDetails', pkColumns, depLookup, new Set());

            assert.strictEqual(result, '[OrderId] = @Target_OrderId AND [ProductId] = @Target_ProductId');
        });

        test('should return direct FK comparison for level-0 target table', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const depLookup = new Map<string, FKDependency>();
            depLookup.set('dbo.ProjectMembers', {
                ref_schema: 'dbo', ref_table: 'ProjectMembers',
                target_schema: 'dbo', target_table: 'Members',
                ref_columns: 'MemberId', target_columns: 'Id',
                level: 0, path: 'Members'
            });

            const result = buildTargetFilter('dbo', 'ProjectMembers', 'dbo', 'Members', pkColumns, depLookup, new Set());

            assert.strictEqual(result, '[MemberId] = @Target_Id');
        });

        test('should return IN subquery for level-1 single-column target table', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const depLookup = new Map<string, FKDependency>();
            depLookup.set('dbo.Packages', {
                ref_schema: 'dbo', ref_table: 'Packages',
                target_schema: 'dbo', target_table: 'Members',
                ref_columns: 'ModifiedByMemberId', target_columns: 'Id',
                level: 0, path: 'Members'
            });
            depLookup.set('dbo.Projects', {
                ref_schema: 'dbo', ref_table: 'Projects',
                target_schema: 'dbo', target_table: 'Packages',
                ref_columns: 'PackageId', target_columns: 'Id',
                level: 1, path: 'Members -> Packages'
            });

            const result = buildTargetFilter('dbo', 'Projects', 'dbo', 'Members', pkColumns, depLookup, new Set());

            assert.strictEqual(result, '[PackageId] IN (SELECT [Id] FROM [dbo].[Packages] WHERE [ModifiedByMemberId] = @Target_Id)');
        });

        test('should return EXISTS for level-1 multi-column target table', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const depLookup = new Map<string, FKDependency>();
            depLookup.set('dbo.ProjectMembers', {
                ref_schema: 'dbo', ref_table: 'ProjectMembers',
                target_schema: 'dbo', target_table: 'Members',
                ref_columns: 'MemberId', target_columns: 'Id',
                level: 0, path: 'Members'
            });
            // A table with composite FK referencing ProjectMembers
            depLookup.set('dbo.Assignments', {
                ref_schema: 'dbo', ref_table: 'Assignments',
                target_schema: 'dbo', target_table: 'ProjectMembers',
                ref_columns: 'MemberId, ProjectId', target_columns: 'MemberId, ProjectId',
                level: 1, path: 'Members -> ProjectMembers'
            });

            const result = buildTargetFilter('dbo', 'Assignments', 'dbo', 'Members', pkColumns, depLookup, new Set());

            assert.ok(result.includes('EXISTS'));
            assert.ok(result.includes('[dbo].[Assignments].[MemberId] = [dbo].[ProjectMembers].[MemberId]'));
            assert.ok(result.includes('[dbo].[Assignments].[ProjectId] = [dbo].[ProjectMembers].[ProjectId]'));
            assert.ok(result.includes('[MemberId] = @Target_Id'));
        });

        test('should handle circular references gracefully', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const depLookup = new Map<string, FKDependency>();
            // Create a circular dependency scenario
            depLookup.set('dbo.TableA', {
                ref_schema: 'dbo', ref_table: 'TableA',
                target_schema: 'dbo', target_table: 'TableB',
                ref_columns: 'BId', target_columns: 'Id',
                level: 1, path: 'Root -> TableB'
            });
            depLookup.set('dbo.TableB', {
                ref_schema: 'dbo', ref_table: 'TableB',
                target_schema: 'dbo', target_table: 'TableA',
                ref_columns: 'AId', target_columns: 'Id',
                level: 1, path: 'Root -> TableA'
            });

            // Should not infinite loop; returns fallback
            const result = buildTargetFilter('dbo', 'TableA', 'dbo', 'Root', pkColumns, depLookup, new Set());
            assert.ok(typeof result === 'string');
        });

        test('should return 1=1 fallback when dep not found in lookup', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const depLookup = new Map<string, FKDependency>();

            const result = buildTargetFilter('dbo', 'UnknownTable', 'dbo', 'Root', pkColumns, depLookup, new Set());

            assert.strictEqual(result, '1=1');
        });
    });

    suite('generateDependentDeletes', () => {
        test('should generate direct WHERE for level-0 single-column FK', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const deps: FKDependency[] = [{
                ref_schema: 'dbo', ref_table: 'Orders',
                target_schema: 'dbo', target_table: 'Users',
                ref_columns: 'UserId', target_columns: 'Id',
                level: 0, path: 'Users'
            }];

            const result = generateDependentDeletes('dbo', 'Users', pkColumns, deps);

            assert.ok(result.includes('DELETE [dbo].[Orders]'));
            assert.ok(result.includes('WHERE [UserId] = @Target_Id;'));
            // Should NOT contain IN or EXISTS for level 0
            assert.ok(!result.includes('IN ('));
            assert.ok(!result.includes('EXISTS'));
        });

        test('should generate direct WHERE for level-0 composite FK', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'OrderId' }, { COLUMN_NAME: 'ProductId' }];
            const deps: FKDependency[] = [{
                ref_schema: 'dbo', ref_table: 'OrderItemDetails',
                target_schema: 'dbo', target_table: 'OrderItems',
                ref_columns: 'OrderId, ProductId', target_columns: 'OrderId, ProductId',
                level: 0, path: 'OrderItems'
            }];

            const result = generateDependentDeletes('dbo', 'OrderItems', pkColumns, deps);

            assert.ok(result.includes('DELETE [dbo].[OrderItemDetails]'));
            assert.ok(result.includes('WHERE [OrderId] = @Target_OrderId AND [ProductId] = @Target_ProductId;'));
            // Should NOT use invalid multi-column IN syntax
            assert.ok(!result.includes('[OrderId, ProductId] IN'));
        });

        test('should generate IN subquery for level-1 single-column FK', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const deps: FKDependency[] = [
                {
                    ref_schema: 'dbo', ref_table: 'Packages',
                    target_schema: 'dbo', target_table: 'Members',
                    ref_columns: 'OwnerId', target_columns: 'Id',
                    level: 0, path: 'Members'
                },
                {
                    ref_schema: 'dbo', ref_table: 'Projects',
                    target_schema: 'dbo', target_table: 'Packages',
                    ref_columns: 'PackageId', target_columns: 'Id',
                    level: 1, path: 'Members -> Packages'
                }
            ];

            const result = generateDependentDeletes('dbo', 'Members', pkColumns, deps);

            assert.ok(result.includes('DELETE [dbo].[Projects]'));
            assert.ok(result.includes('WHERE [PackageId] IN ('));
            assert.ok(result.includes('SELECT [Id]'));
            assert.ok(result.includes('FROM [dbo].[Packages]'));
            assert.ok(result.includes('[OwnerId] = @Target_Id'));
        });

        test('should generate direct WHERE for level-1 composite FK when column traces to root PK', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const deps: FKDependency[] = [
                {
                    ref_schema: 'dbo', ref_table: 'ProjectMembers',
                    target_schema: 'dbo', target_table: 'Members',
                    ref_columns: 'MemberId', target_columns: 'Id',
                    level: 0, path: 'Members'
                },
                {
                    ref_schema: 'dbo', ref_table: 'ProjectMemberToolCapabilities',
                    target_schema: 'dbo', target_table: 'ProjectMembers',
                    ref_columns: 'MemberId, ProjectId, Role', target_columns: 'MemberId, ProjectId, Role',
                    level: 1, path: 'Members -> ProjectMembers'
                }
            ];

            const result = generateDependentDeletes('dbo', 'Members', pkColumns, deps);

            assert.ok(result.includes('DELETE [dbo].[ProjectMemberToolCapabilities]'));
            // MemberId traces back to Members.Id, so use direct comparison
            assert.ok(result.includes('WHERE [MemberId] = @Target_Id;'));
            // Must NOT contain EXISTS or invalid multi-column IN syntax
            assert.ok(!result.includes('EXISTS'), 'Should not use EXISTS when direct column mapping exists');
            assert.ok(!result.includes('[MemberId, ProjectId, Role] IN'));
        });

        test('should generate nested IN subquery for level-2 single-column FK', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const deps: FKDependency[] = [
                {
                    ref_schema: 'dbo', ref_table: 'Packages',
                    target_schema: 'dbo', target_table: 'Members',
                    ref_columns: 'OwnerId', target_columns: 'Id',
                    level: 0, path: 'Members'
                },
                {
                    ref_schema: 'dbo', ref_table: 'Projects',
                    target_schema: 'dbo', target_table: 'Packages',
                    ref_columns: 'PackageId', target_columns: 'Id',
                    level: 1, path: 'Members -> Packages'
                },
                {
                    ref_schema: 'dbo', ref_table: 'CustomGroups',
                    target_schema: 'dbo', target_table: 'Projects',
                    ref_columns: 'ProjectId', target_columns: 'Id',
                    level: 2, path: 'Members -> Packages -> Projects'
                }
            ];

            const result = generateDependentDeletes('dbo', 'Members', pkColumns, deps);

            assert.ok(result.includes('DELETE [dbo].[CustomGroups]'));
            assert.ok(result.includes('WHERE [ProjectId] IN ('));
            assert.ok(result.includes('SELECT [Id]'));
            assert.ok(result.includes('FROM [dbo].[Projects]'));
            // Nested: Projects filter references Packages
            assert.ok(result.includes('[PackageId] IN (SELECT [Id] FROM [dbo].[Packages] WHERE [OwnerId] = @Target_Id)'));
        });

        test('should order deletions from most dependent to least dependent', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const deps: FKDependency[] = [
                {
                    ref_schema: 'dbo', ref_table: 'Orders',
                    target_schema: 'dbo', target_table: 'Users',
                    ref_columns: 'UserId', target_columns: 'Id',
                    level: 0, path: 'Users'
                },
                {
                    ref_schema: 'dbo', ref_table: 'OrderItems',
                    target_schema: 'dbo', target_table: 'Orders',
                    ref_columns: 'OrderId', target_columns: 'Id',
                    level: 1, path: 'Users -> Orders'
                }
            ];

            const result = generateDependentDeletes('dbo', 'Users', pkColumns, deps);

            const orderItemsPos = result.indexOf('DELETE [dbo].[OrderItems]');
            const ordersPos = result.indexOf('DELETE [dbo].[Orders]');
            // OrderItems (level 1) should come before Orders (level 0)
            assert.ok(orderItemsPos < ordersPos, 'Level 1 DELETE should appear before level 0 DELETE');
        });

        test('should deduplicate same table at same level', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const deps: FKDependency[] = [
                {
                    ref_schema: 'dbo', ref_table: 'Orders',
                    target_schema: 'dbo', target_table: 'Users',
                    ref_columns: 'UserId', target_columns: 'Id',
                    level: 0, path: 'Users'
                },
                {
                    ref_schema: 'dbo', ref_table: 'Orders',
                    target_schema: 'dbo', target_table: 'Users',
                    ref_columns: 'CreatedById', target_columns: 'Id',
                    level: 0, path: 'Users'
                }
            ];

            const result = generateDependentDeletes('dbo', 'Users', pkColumns, deps);

            // Should only appear once
            const matches = result.match(/DELETE \[dbo\]\.\[Orders\]/g);
            assert.strictEqual(matches?.length, 1);
        });

        test('should return empty string for no dependencies', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const result = generateDependentDeletes('dbo', 'Users', pkColumns, []);
            assert.strictEqual(result, '');
        });

        test('should handle deep 3-level nesting with single-column FKs', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const deps: FKDependency[] = [
                {
                    ref_schema: 'dbo', ref_table: 'L1',
                    target_schema: 'dbo', target_table: 'Root',
                    ref_columns: 'RootId', target_columns: 'Id',
                    level: 0, path: 'Root'
                },
                {
                    ref_schema: 'dbo', ref_table: 'L2',
                    target_schema: 'dbo', target_table: 'L1',
                    ref_columns: 'L1Id', target_columns: 'Id',
                    level: 1, path: 'Root -> L1'
                },
                {
                    ref_schema: 'dbo', ref_table: 'L3',
                    target_schema: 'dbo', target_table: 'L2',
                    ref_columns: 'L2Id', target_columns: 'Id',
                    level: 2, path: 'Root -> L1 -> L2'
                },
                {
                    ref_schema: 'dbo', ref_table: 'L4',
                    target_schema: 'dbo', target_table: 'L3',
                    ref_columns: 'L3Id', target_columns: 'Id',
                    level: 3, path: 'Root -> L1 -> L2 -> L3'
                }
            ];

            const result = generateDependentDeletes('dbo', 'Root', pkColumns, deps);

            // L4 should have deeply nested IN clause
            assert.ok(result.includes('DELETE [dbo].[L4]'));
            assert.ok(result.includes('[L3Id] IN ('));
            assert.ok(result.includes('[L2Id] IN (SELECT [Id] FROM [dbo].[L2]'));
            assert.ok(result.includes('[L1Id] IN (SELECT [Id] FROM [dbo].[L1] WHERE [RootId] = @Target_Id)'));
        });

        test('should not generate invalid multi-column IN syntax (regression)', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const deps: FKDependency[] = [
                {
                    ref_schema: 'dbo', ref_table: 'ProjectMembers',
                    target_schema: 'dbo', target_table: 'Members',
                    ref_columns: 'MemberId', target_columns: 'Id',
                    level: 0, path: 'Members'
                },
                {
                    ref_schema: 'dbo', ref_table: 'ProjectMemberToolCapabilities',
                    target_schema: 'dbo', target_table: 'ProjectMembers',
                    ref_columns: 'MemberId, ProjectId, Role', target_columns: 'MemberId, ProjectId, Role',
                    level: 1, path: 'Members -> ProjectMembers'
                }
            ];

            const result = generateDependentDeletes('dbo', 'Members', pkColumns, deps);

            // Ensure no invalid SQL syntax like WHERE [col1, col2] IN (SELECT [col1, col2] ...)
            assert.ok(!result.match(/WHERE \[[\w]+, [\w]+/), 'Should not have multi-column IN syntax');
            // MemberId traces to root, so direct comparison is used
            assert.ok(result.includes('WHERE [MemberId] = @Target_Id;'));
        });

        test('should use EXISTS when composite FK columns do NOT trace to root PK', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const deps: FKDependency[] = [
                {
                    ref_schema: 'dbo', ref_table: 'Packages',
                    target_schema: 'dbo', target_table: 'Members',
                    ref_columns: 'OwnerId', target_columns: 'Id',
                    level: 0, path: 'Members'
                },
                {
                    ref_schema: 'dbo', ref_table: 'Shipments',
                    target_schema: 'dbo', target_table: 'Packages',
                    ref_columns: 'PackageId, WarehouseId', target_columns: 'PackageId, WarehouseId',
                    level: 1, path: 'Members -> Packages'
                }
            ];

            const result = generateDependentDeletes('dbo', 'Members', pkColumns, deps);

            // None of the FK columns (PackageId, WarehouseId) trace to Members.Id
            assert.ok(result.includes('DELETE [dbo].[Shipments]'));
            assert.ok(result.includes('WHERE EXISTS ('));
            assert.ok(result.includes('[dbo].[Shipments].[PackageId] = [dbo].[Packages].[PackageId]'));
            assert.ok(result.includes('[dbo].[Shipments].[WarehouseId] = [dbo].[Packages].[WarehouseId]'));
        });
    });

    suite('traceColumnsToRoot', () => {
        test('should map column directly when table is root', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const depLookup = new Map<string, FKDependency>();

            const result = traceColumnsToRoot('dbo', 'Members', 'dbo', 'Members', pkColumns, depLookup, new Set());

            assert.ok(result);
            assert.strictEqual(result!.get('Id'), 'Id');
        });

        test('should trace single FK column to root PK', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const depLookup = new Map<string, FKDependency>();
            depLookup.set('dbo.ProjectMembers', {
                ref_schema: 'dbo', ref_table: 'ProjectMembers',
                target_schema: 'dbo', target_table: 'Members',
                ref_columns: 'MemberId', target_columns: 'Id',
                level: 0, path: 'Members'
            });

            const result = traceColumnsToRoot('dbo', 'ProjectMembers', 'dbo', 'Members', pkColumns, depLookup, new Set());

            assert.ok(result);
            assert.strictEqual(result!.get('MemberId'), 'Id');
        });

        test('should trace composite FK columns through chain', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const depLookup = new Map<string, FKDependency>();
            depLookup.set('dbo.ProjectMembers', {
                ref_schema: 'dbo', ref_table: 'ProjectMembers',
                target_schema: 'dbo', target_table: 'Members',
                ref_columns: 'MemberId', target_columns: 'Id',
                level: 0, path: 'Members'
            });
            depLookup.set('dbo.ProjectMemberToolCapabilities', {
                ref_schema: 'dbo', ref_table: 'ProjectMemberToolCapabilities',
                target_schema: 'dbo', target_table: 'ProjectMembers',
                ref_columns: 'MemberId, ProjectId, Role', target_columns: 'MemberId, ProjectId, Role',
                level: 1, path: 'Members -> ProjectMembers'
            });

            const result = traceColumnsToRoot('dbo', 'ProjectMemberToolCapabilities', 'dbo', 'Members', pkColumns, depLookup, new Set());

            assert.ok(result);
            // MemberId -> ProjectMembers.MemberId -> Members.Id
            assert.strictEqual(result!.get('MemberId'), 'Id');
            // ProjectId and Role do NOT trace back to Members.Id
            assert.strictEqual(result!.has('ProjectId'), false);
            assert.strictEqual(result!.has('Role'), false);
        });

        test('should return null when no columns trace to root', () => {
            const pkColumns: PKColumn[] = [{ COLUMN_NAME: 'Id' }];
            const depLookup = new Map<string, FKDependency>();
            depLookup.set('dbo.Packages', {
                ref_schema: 'dbo', ref_table: 'Packages',
                target_schema: 'dbo', target_table: 'Members',
                ref_columns: 'OwnerId', target_columns: 'Id',
                level: 0, path: 'Members'
            });
            // Shipments FK columns (PackageId, WarehouseId) map to (PackageId, WarehouseId) in Packages
            // but PackageId in Packages is NOT the FK column to Members (that's OwnerId)
            depLookup.set('dbo.Shipments', {
                ref_schema: 'dbo', ref_table: 'Shipments',
                target_schema: 'dbo', target_table: 'Packages',
                ref_columns: 'PackageId, WarehouseId', target_columns: 'PackageId, WarehouseId',
                level: 1, path: 'Members -> Packages'
            });

            const result = traceColumnsToRoot('dbo', 'Shipments', 'dbo', 'Members', pkColumns, depLookup, new Set());

            // Neither PackageId nor WarehouseId traces to Members.Id
            assert.strictEqual(result, null);
        });
    });
});
