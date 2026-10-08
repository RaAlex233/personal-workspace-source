import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { importModule } from './test-modules.mjs';

// Initialize React's browser event support after a DOM exists, including textarea input.
const bootstrapDom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' });
Object.assign(globalThis, { window: bootstrapDom.window, document: bootstrapDom.window.document });
const { createRoot } = await import('react-dom/client');
bootstrapDom.window.close();

const { useWorkspace } = await importModule('useWorkspace');
const { usePomodoro } = await importModule('usePomodoro');
const { loadData, emptyData } = await importModule('data');
const { useDailyQuote, fetchDailyQuote } = await importModule('useDailyQuote');
const { useLocalDay } = await importModule('localDay');
const { FocusHistory, FocusPanel } = await importModule('FocusPanel');
const { TaskEditor, TaskCompletionDialog } = await importModule('TaskPanel');
const { completionReferences } = await importModule('completions');
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

test('每日签到持久化并在跨午夜及重新打开后恢复待办，历史天数保持完整', async () => {
  const OriginalDate = Date;
  let clock = new OriginalDate('2026-10-08T23:59:55').getTime();
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  try {
    const page = mount(); await waitFor(() => page.focus.available);
    act(() => page.work.saveTask({ ...draft('每日阅读'), type: 'daily' }, null));
    await waitFor(() => !page.work.saving);
    act(() => page.work.toggleTask(page.work.data.tasks[0]));
    await waitFor(() => !page.work.saving);
    assert.deepEqual(page.work.data.tasks[0].checkInDates, ['2026-10-08']);
    act(() => page.work.toggleTask(page.work.data.tasks[0]));
    await waitFor(() => !page.work.saving);
    assert.deepEqual(page.work.data.tasks[0].checkInDates, []);
    act(() => page.work.toggleTask(page.work.data.tasks[0]));
    await waitFor(() => !page.work.saving);
    clock = new OriginalDate('2026-10-09T00:00:05').getTime();
    act(() => document.dispatchEvent(new window.Event('visibilitychange')));
    assert.equal(page.work.today, '2026-10-09');
    assert.equal(page.work.data.tasks[0].completedAt, null);
    assert.equal(page.work.data.tasks[0].progress, 0);
    assert.deepEqual(page.work.data.tasks[0].checkInDates, ['2026-10-08']);
    await page.unmount();
    const reopened = mount(); await waitFor(() => reopened.focus.available);
    assert.equal(reopened.work.data.tasks[0].progress, 0);
    act(() => reopened.work.toggleTask(reopened.work.data.tasks[0]));
    await waitFor(() => !reopened.work.saving);
    assert.deepEqual((await loadData()).tasks[0].checkInDates, ['2026-10-08', '2026-10-09']);
    await reopened.unmount();
  } finally { globalThis.Date = OriginalDate; }
});

test('自定义时长立即更新空闲番茄钟，进行中修改留待下轮生效且拒绝无效时长', async () => {
  const page = mount(); await waitFor(() => page.focus.available);
  act(() => assert.equal(page.work.saveSettings({ ...page.work.data.settings, focusMinutes: 40 }), true));
  await waitFor(() => page.focus.timer.total === 2400 && !page.work.saving);
  act(() => page.focus.toggle());
  const deadline = page.focus.timer.deadline;
  act(() => assert.equal(page.work.saveSettings({ ...page.work.data.settings, focusMinutes: 50 }), true));
  await waitFor(() => !page.work.saving);
  assert.equal(page.focus.timer.total, 2400); assert.equal(page.focus.timer.deadline, deadline);
  for (const focusMinutes of [0, 181, 2.5, NaN]) act(() => assert.equal(page.work.saveSettings({ ...page.work.data.settings, focusMinutes }), false));
  assert.equal(page.work.data.settings.focusMinutes, 50);
  await act(async () => { await page.focus.reset(); });
  await waitFor(() => page.focus.timer.total === 3000);
});

test('每日一言请求去重、同日缓存、隔天刷新；失败可重试并保留缓存', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let fail = false;
  globalThis.fetch = async () => { calls += 1; if (fail) throw Error('offline'); return { ok: true, json: async () => ({ hitokoto: `每日文案 ${calls}`, from: '测试来源' }) }; };
  try {
    const quotes = await Promise.all([fetchDailyQuote('2026-11-01'), fetchDailyQuote('2026-11-01')]);
    assert.equal(calls, 1); assert.deepEqual(quotes[0], quotes[1]);
    await fetchDailyQuote('2026-11-01'); assert.equal(calls, 1);
    const tomorrow = await fetchDailyQuote('2026-11-02'); assert.equal(calls, 2); assert.equal(tomorrow.day, '2026-11-02');
    fail = true; await assert.rejects(() => fetchDailyQuote('2026-11-03'));
    assert.equal(JSON.parse(localStorage.getItem('personal-workspace-daily-quote-v1')).day, '2026-11-02');
    fail = false; await fetchDailyQuote('2026-11-03'); assert.equal(calls, 4);
  } finally { globalThis.fetch = originalFetch; }
});

test('每日一言在 StrictMode 下仅请求一次，跨日自动请求新文案', async () => {
  const originalFetch = globalThis.fetch;
  const OriginalDate = Date;
  let clock = new OriginalDate('2026-12-08T23:59:55').getTime();
  let calls = 0;
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ hitokoto: `句子 ${calls}` }) }; };
  const view = {};
  function QuoteProbe() { view.quote = useDailyQuote(useLocalDay()); return null; }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.add(root);
  try {
    act(() => root.render(React.createElement(React.StrictMode, null, React.createElement(QuoteProbe))));
    await waitFor(() => !view.quote.loading && view.quote.quote?.day === '2026-12-08');
    assert.equal(calls, 1);
    clock = new OriginalDate('2026-12-09T00:00:05').getTime();
    act(() => document.dispatchEvent(new window.Event('visibilitychange')));
    await waitFor(() => view.quote.quote?.day === '2026-12-09');
    assert.equal(calls, 2);
  } finally {
    await act(async () => root.unmount()); roots.delete(root);
    globalThis.Date = OriginalDate; globalThis.fetch = originalFetch;
  }
});

test('每日任务编辑界面无需截止日期，专注饼图与时长入口可直接使用', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.add(root);
  const dailyDraft = { ...draft('每日阅读'), type: 'daily' };
  const work = { data: emptyData(), saveTask: () => true };
  container.innerHTML = renderToStaticMarkup(React.createElement(TaskEditor, { draft: dailyDraft, setDraft: () => {}, task: null, work, close: () => {} }));
  assert.equal(container.querySelectorAll('input[type="datetime-local"]').length, 1);
  assert.ok(container.textContent.includes('每天 00:00 自动恢复待签到'));
  assert.equal(container.querySelector('input[type="checkbox"]').checked, false);
  container.innerHTML = '';
  const data = emptyData();
  const today = new Date(); today.setHours(9, 0, 0, 0);
  data.sessions.push({ id: 'free', taskId: null, source: 'pomodoro', startAt: today.toISOString(), endAt: new Date(today.getTime() + 120000).toISOString(), focusedSeconds: 120, completed: false });
  const focus = { available: true, settling: false, busy: false, remaining: 1500, timer: { phase: 'focus', taskId: null, total: 1500, running: false } };
  act(() => root.render(React.createElement(React.Fragment, null, React.createElement(FocusPanel, { data, focus, saveSettings: () => true }), React.createElement(FocusHistory, { data }))));
  assert.equal(container.querySelector('input[aria-label="自定义专注时长（分钟）"]').value, '25');
  const chart = container.querySelector('.focus-pie[role="img"]');
  assert.ok(chart.getAttribute('aria-label').includes('100.0%'));
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === '今天').click());
  assert.equal(container.querySelector('.pie-range button[aria-pressed="true"]').textContent, '今天');
});

test('完成描述按次保存、重复确认去重；撤销保留描述但不作为有效总结素材', async () => {
  const page = mount(); await waitFor(() => page.focus.available);
  act(() => page.work.saveTask({ ...draft('论文整理'), notes: '原来的计划备注' }, null));
  await waitFor(() => !page.work.saving);
  const task = page.work.data.tasks[0];
  act(() => {
    assert.equal(page.work.completeTask(task, '  完成文献筛选\n整理了 12 篇论文。  '), true);
    assert.equal(page.work.completeTask(task, '重复提交'), true);
  });
  await waitFor(() => !page.work.saving);
  const completed = (await loadData()).activities.filter(activity => activity.type === 'completed');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].description, '完成文献筛选\n整理了 12 篇论文。');
  assert.equal(page.work.data.tasks[0].notes, '原来的计划备注');
  assert.equal(completionReferences(page.work.data)[0].description, completed[0].description);
  act(() => page.work.toggleTask(page.work.data.tasks[0]));
  await waitFor(() => !page.work.saving);
  assert.equal(completionReferences(page.work.data).length, 0);
  assert.ok(page.work.data.activities.find(activity => activity.id === completed[0].id).revokedAt);
  act(() => page.work.completeTask(page.work.data.tasks[0], '第二次补充摘要。'));
  await waitFor(() => !page.work.saving);
  await page.unmount();
  const reopened = mount(); await waitFor(() => reopened.focus.available);
  assert.equal(reopened.work.data.activities.filter(activity => activity.type === 'completed').length, 2);
  assert.equal(completionReferences(reopened.work.data).length, 1);
  assert.equal(completionReferences(reopened.work.data)[0].description, '第二次补充摘要。');
});

test('任务详情设为完成同样记录描述，继续编辑不会重复生成完成记录', async () => {
  const page = mount(); await waitFor(() => page.focus.available);
  const taskDraft = { ...draft('编辑中完成'), progress: 100, completionDescription: ' 完成初稿 ' };
  act(() => assert.equal(page.work.saveTask(taskDraft, null), true));
  await waitFor(() => !page.work.saving);
  let task = page.work.data.tasks[0];
  assert.equal(completionReferences(page.work.data)[0].description, '完成初稿');
  act(() => page.work.saveTask({ ...taskDraft, title: '修改标题' }, task.id));
  await waitFor(() => !page.work.saving);
  assert.equal(page.work.data.activities.filter(activity => activity.type === 'completed').length, 1);
  act(() => page.work.saveTask({ ...taskDraft, progress: 50 }, task.id));
  await waitFor(() => !page.work.saving);
  assert.equal(completionReferences(page.work.data).length, 0);
  task = page.work.data.tasks[0];
  act(() => assert.equal(page.work.completeTask(task, 'a'.repeat(501)), false));
  assert.equal(page.work.data.tasks[0].progress, 50);
});

test('每日签到描述独立按日保存，撤销今天不改变昨天描述或总结素材', async () => {
  const OriginalDate = Date;
  let clock = new OriginalDate('2026-10-08T23:59:55').getTime();
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  try {
    const page = mount(); await waitFor(() => page.focus.available);
    act(() => page.work.saveTask({ ...draft('每日阅读'), type: 'daily' }, null));
    await waitFor(() => !page.work.saving);
    act(() => page.work.completeTask(page.work.data.tasks[0], '阅读第一章'));
    await waitFor(() => !page.work.saving);
    clock = new OriginalDate('2026-10-09T00:00:05').getTime();
    act(() => document.dispatchEvent(new window.Event('visibilitychange')));
    act(() => page.work.completeTask(page.work.data.tasks[0], '阅读第二章'));
    await waitFor(() => !page.work.saving);
    assert.equal(completionReferences(page.work.data).length, 2);
    assert.equal(completionReferences(page.work.data, '2026-10-08', '2026-10-08')[0].description, '阅读第一章');
    act(() => page.work.toggleTask(page.work.data.tasks[0]));
    await waitFor(() => !page.work.saving);
    assert.equal(completionReferences(page.work.data).length, 1);
    assert.equal(completionReferences(page.work.data)[0].description, '阅读第一章');
    assert.deepEqual(page.work.data.tasks[0].checkInDates, ['2026-10-08']);
    await page.unmount();
  } finally { globalThis.Date = OriginalDate; }
});

test('完成弹窗可取消、填写描述或留空确认，任务详情提供完成记录回看', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.add(root);
  const task = { ...draft('阅读'), id: 'task', type: 'daily', checkInDates: [], completedAt: null };
  const calls = [];
  let closed = 0;
  const work = { ready: true, writable: true, importing: false, error: '', today: '2026-10-08', data: emptyData(), completeTask: (...args) => { calls.push(args); return true; } };
  const render = key => root.render(React.createElement(TaskCompletionDialog, { key, task, work, close: () => { closed += 1; } }));
  act(() => render('cancel'));
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === '取消').click());
  assert.equal(calls.length, 0); assert.equal(closed, 1);
  act(() => render('describe'));
  const textarea = container.querySelector('textarea[aria-label="完成描述"]');
  assert.equal(textarea.required, false); assert.equal(textarea.maxLength, 500);
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, '完成阅读并整理了笔记');
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  act(() => container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(calls[0][1], '完成阅读并整理了笔记');
  act(() => render('empty'));
  act(() => container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(calls[1][1], '');
  const data = emptyData(); data.tasks = [task];
  data.activities.push({ id: 'completion', taskId: task.id, type: 'completed', at: '2026-10-08T12:00:00', description: '历史完成描述', revokedAt: null });
  const html = renderToStaticMarkup(React.createElement(TaskEditor, { draft: { ...draft('阅读'), type: 'daily', progress: 100 }, setDraft: () => {}, task, work: { ...work, data }, close: () => {} }));
  assert.ok(html.includes('历史完成描述')); assert.ok(html.includes('完成记录与描述'));
  assert.ok(html.includes('aria-label="完成描述"'));
});
