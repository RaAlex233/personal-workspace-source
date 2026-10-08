import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { importModule } from './test-modules.mjs';

const { useWorkspace } = await importModule('useWorkspace');
const { usePomodoro } = await importModule('usePomodoro');
const { loadData, emptyData } = await importModule('data');
const timerKey = 'personal-workspace-pomodoro-v1';
let dom;
let roots;
let database;
let locks;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' });
  database = new IDBFactory();
  locks = new Set();
  roots = new Set();
  const lockManager = {
    async request(name, options, callback) {
      assert.equal(options.ifAvailable, true);
      if (locks.has(name)) return callback(null);
      locks.add(name);
      try { return await callback({ name }); }
      finally { locks.delete(name); }
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: lockManager } });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, indexedDB: database,
    confirm: () => true, IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.indexedDB = database;
});

afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  await new Promise(resolve => setImmediate(resolve));
  dom.window.close();
});

function mount() {
  const view = {};
  function WorkspaceProbe() {
    view.work = useWorkspace();
    view.focus = usePomodoro(view.work.data.settings, view.work.ready && !view.work.error && !view.work.importing, view.work.recordFocus, view.work.setNotice, view.work.writable, view.work.getSavedFocus);
    return null;
  }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.add(root);
  act(() => root.render(React.createElement(React.StrictMode, null, React.createElement(WorkspaceProbe))));
  view.unmount = async () => { await act(async () => root.unmount()); roots.delete(root); };
  return view;
}

async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.ok(predicate(), 'state did not settle');
}

const draft = title => ({ title, notes: '', urgency: 'shortterm', tags: [], startAt: '', dueAt: '', progress: 0 });
const pausedTimer = () => ({ phase: 'focus', taskId: null, remaining: 30, total: 60, deadline: null, running: false, sessionId: 'pending-focus', startedAt: new Date(Date.now() - 30000).toISOString(), round: 0 });

test('导入立即阻止并发编辑与重复导入，并包含同一事件中已接受的新任务', async () => {
  const page = mount(); await waitFor(() => page.focus.available);
  let readFile;
  const file = { text: () => new Promise(resolve => { readFile = resolve; }) };
  let importing;
  act(() => {
    assert.equal(page.work.saveTask(draft('导入前创建'), null), true);
    importing = page.work.importData(file, 'merge');
    assert.equal(page.work.saveTask(draft('导入期间创建'), null), false);
  });
  await waitFor(() => !!readFile);
  await act(async () => {
    await page.work.importData({ text: () => { throw new Error('must not read twice'); } }, 'merge');
  });
  await act(async () => { readFile(JSON.stringify(emptyData())); await importing; });
  assert.deepEqual(page.work.data.tasks.map(task => task.title), ['导入前创建']);
  assert.deepEqual((await loadData()).tasks.map(task => task.title), ['导入前创建']);
  act(() => { assert.equal(page.work.saveTask(draft('导入完成后'), null), true); });
  await waitFor(() => !page.work.saving);
  assert.equal((await loadData()).tasks.length, 2);
});

test('失败或取消的导入释放编辑限制且保留原始数据', async () => {
  const page = mount(); await waitFor(() => page.focus.available);
  act(() => page.work.saveTask(draft('保留任务'), null));
  await waitFor(() => !page.work.saving);
  await act(async () => { await page.work.importData({ text: async () => '{}' }, 'merge'); });
  assert.equal(page.work.importing, false);
  assert.equal(page.work.data.tasks.length, 1);
  globalThis.confirm = () => false;
  await act(async () => { await page.work.importData({ text: async () => JSON.stringify(emptyData()) }, 'replace'); });
  assert.equal(page.work.importing, false);
  assert.equal(page.work.data.tasks.length, 1);
  act(() => { assert.equal(page.work.saveTask(draft('仍可编辑'), null), true); });
  await waitFor(() => !page.work.saving);
});

test('同一浏览器仅允许一个编辑页面，只读页面不覆盖任务或番茄钟，关闭后可接管', async () => {
  localStorage.setItem(timerKey, JSON.stringify(pausedTimer()));
  const first = mount(); await waitFor(() => first.focus.available);
  act(() => first.work.saveTask(draft('第一页任务'), null));
  await waitFor(() => !first.work.saving);
  const second = mount(); await waitFor(() => second.work.ready);
  assert.equal(second.work.writable, false);
  assert.match(second.work.blockedReason, /只读/);
  const stored = localStorage.getItem(timerKey);
  await act(async () => {
    assert.equal(second.work.saveTask(draft('不应写入'), null), false);
    second.focus.toggle(); await second.focus.reset();
    await second.work.importData({ text: async () => JSON.stringify(emptyData()) }, 'replace');
  });
  assert.equal(localStorage.getItem(timerKey), stored);
  assert.equal((await loadData()).tasks.length, 1);
  // Change the owner's timer after the read-only page took its initial snapshot.
  await act(async () => { await first.focus.reset(); });
  assert.equal(first.focus.timer.sessionId, null);
  await first.unmount();
  await act(async () => { await second.work.retryStorage(); });
  await waitFor(() => second.focus.available);
  assert.equal(second.work.data.tasks[0].title, '第一页任务');
  assert.equal(second.focus.timer.sessionId, null);
  assert.equal(second.work.data.sessions.length, 1);
  act(() => { assert.equal(second.work.saveTask(draft('接管后任务'), null), true); });
  await waitFor(() => !second.work.saving);
  assert.equal((await loadData()).tasks.length, 2);
});

test('浏览器缺少页面锁能力时保持只读，避免无保护的写入', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const page = mount(); await waitFor(() => page.work.ready);
  assert.equal(page.work.writable, false);
  act(() => { assert.equal(page.work.saveTask(draft('无法保存'), null), false); });
  assert.equal((await loadData()).tasks.length, 0);
  assert.equal(localStorage.getItem(timerKey), null);
});

test('数据库加载失败时重置不清除待保存计时，恢复后可以保存', async () => {
  localStorage.setItem(timerKey, JSON.stringify(pausedTimer()));
  const open = database.open;
  database.open = () => { throw new Error('load failed'); };
  const page = mount(); await waitFor(() => page.work.ready);
  assert.match(page.work.error, /load failed/);
  await act(async () => { await page.focus.reset(); });
  assert.equal(page.focus.timer.sessionId, 'pending-focus');
  assert.equal(JSON.parse(localStorage.getItem(timerKey)).sessionId, 'pending-focus');
  database.open = open;
  await act(async () => { await page.work.retryStorage(); });
  await waitFor(() => page.focus.available);
  await act(async () => { await page.focus.reset(); });
  const saved = await loadData();
  assert.equal(saved.sessions.length, 1);
  assert.equal(saved.sessions[0].focusedSeconds, 30);
  assert.equal(page.focus.timer.sessionId, null);
});

test('记录写入失败保留计时，重试只生成一条记录并在成功提交后清空', async () => {
  localStorage.setItem(timerKey, JSON.stringify(pausedTimer()));
  const page = mount(); await waitFor(() => page.focus.available);
  const open = database.open;
  database.open = () => { throw new Error('write failed'); };
  let reset;
  act(() => { reset = page.focus.reset(); });
  assert.equal(page.focus.timer.sessionId, 'pending-focus');
  assert.equal(page.focus.settling, true);
  await act(async () => { await reset; });
  assert.match(page.work.error, /write failed/);
  assert.equal(page.focus.timer.sessionId, 'pending-focus');
  assert.equal(JSON.parse(localStorage.getItem(timerKey)).sessionId, 'pending-focus');
  database.open = open;
  await act(async () => { await page.work.retryStorage(); });
  await waitFor(() => page.focus.available);
  await act(async () => { await page.focus.reset(); });
  const saved = await loadData();
  assert.equal(saved.sessions.length, 1);
  assert.equal(saved.sessions[0].id, 'pending-focus');
  assert.equal(page.focus.timer.sessionId, null);
});

test('恢复过期番茄钟时先保存完整记录，再切换休息，重复刷新不会重复记账', async () => {
  const timer = { ...pausedTimer(), running: true, remaining: 60, deadline: Date.now() - 1000 };
  localStorage.setItem(timerKey, JSON.stringify(timer));
  const first = mount(); await waitFor(() => first.focus.timer.phase === 'short');
  const saved = await loadData();
  assert.equal(saved.sessions.length, 1);
  assert.equal(saved.sessions[0].focusedSeconds, 60);
  assert.equal(saved.sessions[0].completed, true);
  await first.unmount();
  // Simulate a crash after the DB commit but before localStorage was updated.
  localStorage.setItem(timerKey, JSON.stringify(timer));
  const second = mount(); await waitFor(() => second.focus.timer.phase === 'short');
  assert.equal((await loadData()).sessions.length, 1);
});

test('提前结束记录已提交但倒计时未清空时，重新打开会完成重置', async () => {
  const timer = pausedTimer(); localStorage.setItem(timerKey, JSON.stringify(timer));
  const first = mount(); await waitFor(() => first.focus.available);
  await act(async () => { await first.focus.reset(); });
  await first.unmount();
  localStorage.setItem(timerKey, JSON.stringify(timer));
  const second = mount(); await waitFor(() => second.focus.available && second.focus.timer.sessionId === null);
  const saved = await loadData();
  assert.equal(saved.sessions.length, 1);
  assert.equal(saved.sessions[0].focusedSeconds, 30);
  assert.equal(saved.sessions[0].completed, false);
  assert.equal(second.focus.timer.remaining, second.work.data.settings.focusMinutes * 60);
});

test('自动完成写入失败时不切换休息，恢复存储后仅结算一次', async () => {
  localStorage.setItem(timerKey, JSON.stringify({ ...pausedTimer(), running: true, remaining: 60, deadline: Date.now() - 1000 }));
  const open = database.open;
  let calls = 0;
  database.open = function (...args) {
    if (++calls > 1) throw new Error('completion failed');
    return open.apply(this, args);
  };
  const page = mount(); await waitFor(() => !!page.work.error);
  assert.equal(page.focus.timer.phase, 'focus');
  assert.equal(page.focus.timer.sessionId, 'pending-focus');
  database.open = open;
  await act(async () => { await page.work.retryStorage(); });
  await waitFor(() => page.focus.timer.phase === 'short');
  assert.equal(page.focus.timer.round, 1);
  const saved = await loadData();
  assert.equal(saved.sessions.length, 1);
  assert.equal(saved.sessions[0].completed, true);
});

test('关闭页面时编辑锁等待尚未提交的保存，再允许另一页接管', async () => {
  const first = mount(); await waitFor(() => first.focus.available);
  const open = database.open;
  let finishOpen;
  database.open = function (...args) {
    const request = open.apply(this, args);
    return new Proxy(request, {
      get(target, key) { return Reflect.get(target, key); },
      set(target, key, value) {
        if (key === 'onsuccess') target.onsuccess = () => { finishOpen = value; };
        else Reflect.set(target, key, value);
        return true;
      },
    });
  };
  act(() => first.work.saveTask(draft('关闭前的任务'), null));
  await waitFor(() => !!finishOpen);
  database.open = open;
  await first.unmount();
  const second = mount(); await waitFor(() => second.work.ready);
  assert.equal(second.work.writable, false);
  await act(async () => { finishOpen(); });
  await waitFor(() => locks.size === 0);
  await act(async () => { await second.work.retryStorage(); });
  await waitFor(() => second.focus.available);
  assert.equal(second.work.data.tasks[0].title, '关闭前的任务');
});

test('页面关闭后尚在读取的导入不再写入或覆盖新编辑页面的数据', async () => {
  const first = mount(); await waitFor(() => first.focus.available);
  let finishRead;
  let importing;
  act(() => { importing = first.work.importData({ text: () => new Promise(resolve => { finishRead = resolve; }) }, 'replace'); });
  await waitFor(() => !!finishRead);
  await first.unmount();
  const second = mount(); await waitFor(() => second.focus.available);
  act(() => second.work.saveTask(draft('新页面创建'), null));
  await waitFor(() => !second.work.saving);
  await act(async () => { finishRead(JSON.stringify(emptyData())); await importing; });
  assert.equal((await loadData()).tasks[0].title, '新页面创建');
});
