// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountStore, formatBytes, type CatalogFile } from '../store/account';

const file: CatalogFile = { serial:'test-1', filename:'report.txt', extension:'txt', fileType:'document', label:null,
  tags:[], description:null, status:'active', size:100, compressedSize:20, compressionRatio:0.2,
  contentHash:'test', storagePath:'test', createdAt:1, modifiedAt:1, accessedAt:1 };

beforeEach(() => useAccountStore.getState().logout());
afterEach(() => vi.unstubAllGlobals());
describe('account and catalog workflows', () => {
  it('updates statistics after adding, changing and deleting files', () => {
    const store=useAccountStore.getState(); store.addFile(file);
    expect(useAccountStore.getState().stats).toMatchObject({totalFiles:1,totalSize:100,compressedSize:20,savings:80});
    store.updateFile(file.serial,{compressedSize:0});
    expect(useAccountStore.getState().stats.compressedSize).toBe(0);
    store.selectFile(file.serial); store.deleteFile(file.serial);
    expect(useAccountStore.getState().selectedFiles).toEqual([]);
    expect(useAccountStore.getState().stats.totalFiles).toBe(0);
  });
  it('supports tags, labels, case-insensitive search and filters', () => {
    const store=useAccountStore.getState(); store.addFile(file);
    store.addTag(file.serial,'work'); store.addTag(file.serial,'work'); store.setLabel(file.serial,'Budget');
    expect(store.searchFiles('BUDGET')).toHaveLength(1);
    expect(store.filterByType('document')).toHaveLength(1);
    expect(store.filterByTag('work')).toHaveLength(1);
    expect(store.getAllTags()).toEqual(['work']);
    store.removeTag(file.serial,'work'); expect(store.getAllTags()).toEqual([]);
  });
  it('does not turn persisted metadata into a login', () => {
    useAccountStore.setState({account:{accountId:'saved'} as never});
    useAccountStore.getState().quickDemoLogin();
    expect(useAccountStore.getState().isLoggedIn).toBe(false);
    expect(useAccountStore.getState().showLogin).toBe(true);
  });
  it('rejects invalid storage requests and clears account data on logout', () => {
    const store=useAccountStore.getState();
    useAccountStore.setState({account:{storageUsed:50,storageQuota:100} as never});
    expect(store.canStore(50)).toBe(true); expect(store.canStore(51)).toBe(false);
    for (const size of [-1,NaN,Infinity,0.1]) expect(store.canStore(size)).toBe(false);
    store.logout(); expect(useAccountStore.getState().account).toBeNull();
    expect(store.canStore(0)).toBe(false);
  });
  it.each([0,-1,NaN,Infinity])('formats invalid or empty storage size %s', size => {
    expect(formatBytes(size)).toBe('0 B');
  });
  it('uses server quotas and timestamps and isolates catalogs between accounts', async () => {
    useAccountStore.getState().addFile(file);
    useAccountStore.setState({account:{accountId:'old'} as never});
    vi.stubGlobal('fetch',vi.fn(async () => ({ok:true,json:async () => ({success:true,account_id:'new',display_name:'Test',tier:'free',storage_quota:512,created_at:1700000000})})));
    expect((await useAccountStore.getState().login('new','Synthetic123!')).success).toBe(true);
    expect(useAccountStore.getState().account).toMatchObject({storageQuota:512,createdAt:1700000000000});
    expect(useAccountStore.getState().files).toEqual([]);
  });
});
