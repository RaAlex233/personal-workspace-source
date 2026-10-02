import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

// Compile the actual modules with the project's TypeScript dependency.
const output = new URL('../.artifacts/test-modules/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ['data', 'usePomodoro', 'useWorkspace']) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replaceAll("from './data'", "from './data.mjs'");
  await writeFile(new URL(`${name}.mjs`, output), compiled);
}
const { emptyData, validateData, mergeData, defaultSettings } = await import(new URL('data.mjs', output));
const { remainingSeconds, restoreTimer } = await import(new URL('usePomodoro.mjs', output));
const { sessionSeconds, tasksOnDay } = await import(new URL('useWorkspace.mjs', output));
const start = '2026-10-01T01:00:00.000Z';
const end = '2026-10-03T10:00:00.000Z';
const legacyTask = { id: 'task-1', title: '旧任务', notes: '', category: 'longterm', priority: 'normal', dueAt: end, completedAt: null, createdAt: start, updatedAt: start };
const legacy = () => ({ schemaVersion: 1, tasks: [{ ...legacyTask }], events: [], sessions: [{ id: 'time-1', taskId: 'task-1', startAt: start, endAt: end }], activities: [] });
const modern = () => validateData(legacy());

test('旧版数据迁移保留 ID、任务与计时，补充标签、进度和设置', () => {
  const data = modern();
  assert.equal(data.schemaVersion, 2);
  assert.equal(data.tasks[0].id, legacyTask.id);
  assert.equal(data.tasks[0].urgency, 'longterm');
  assert.deepEqual(data.tasks[0].tags, ['长期任务']);
  assert.equal(data.tasks[0].progress, 0);
  assert.equal(data.sessions[0].source, 'manual');
  assert.deepEqual(data.settings, defaultSettings());
  assert.equal(legacy().schemaVersion, 1);
});
test('已完成任务和创建时已经逾期的旧任务可正常迁移', () => {
  const old = legacy(); old.tasks[0].completedAt = end; old.tasks[0].dueAt = '2026-09-28T01:00:00.000Z';
  const migrated = validateData(old);
  assert.equal(migrated.tasks[0].progress, 100);
  assert.equal(migrated.tasks[0].startAt, old.tasks[0].dueAt);
});
test('拒绝重复 ID、无效进度与悬空的任务关联', () => {
  const duplicate = modern(); duplicate.tasks.push({ ...duplicate.tasks[0] }); assert.throws(() => validateData(duplicate));
  const progress = modern(); progress.tasks[0].progress = 101; assert.throws(() => validateData(progress));
  const orphan = modern(); orphan.sessions[0].taskId = 'missing'; assert.throws(() => validateData(orphan));
  assert.throws(() => validateData({ ...emptyData(), schemaVersion: '2' }));
});
test('拒绝倒置的任务、日程与计时时间以及多个活动计时', () => {
  const tasks = modern(); tasks.tasks[0].startAt = '2026-10-04T01:00:00.000Z'; assert.throws(() => validateData(tasks));
  const event = modern(); event.events.push({ id: 'event-1', title: '日程', notes: '', startAt: end, endAt: start, createdAt: start, updatedAt: start }); assert.throws(() => validateData(event));
  const session = modern(); session.sessions[0].endAt = '2026-09-30T01:00:00.000Z'; assert.throws(() => validateData(session));
  const active = modern(); active.sessions[0].endAt = null; active.sessions.push({ ...active.sessions[0], id: 'time-2' }); assert.throws(() => validateData(active));
});
test('自由专注允许空任务关联并以实际专注秒数统计', () => {
  const data = emptyData(); data.sessions.push({ id: 'focus-1', taskId: null, source: 'pomodoro', focusedSeconds: 60, completed: true, startAt: start, endAt: end });
  assert.equal(validateData(data).sessions.length, 1);
  assert.equal(sessionSeconds(data.sessions[0]), 60);
});
test('合并按 ID 更新任务，保留当前设置并保留不同 ID 的记录', () => {
  const current = modern(); current.settings.focusMinutes = 30;
  const incoming = modern(); incoming.tasks[0].tags = ['自定义分类']; incoming.tasks[0].progress = 50;
  incoming.tasks.push({ ...incoming.tasks[0], id: 'task-2' }); incoming.sessions[0].id = 'time-2';
  const merged = mergeData(current, incoming);
  assert.equal(merged.tasks.length, 2); assert.deepEqual(merged.tasks[0].tags, ['自定义分类']);
  assert.equal(merged.tasks[0].progress, 50); assert.equal(merged.sessions.length, 2); assert.equal(merged.settings.focusMinutes, 30);
});
test('番茄钟按绝对时间恢复，后台延迟和过期计时不会出现负数', () => {
  const timer = { phase: 'focus', taskId: null, remaining: 60, total: 60, deadline: 100000, running: true, sessionId: 'focus-1', startedAt: start, round: 0 };
  assert.equal(remainingSeconds(timer, 40000), 60);
  assert.equal(remainingSeconds(timer, 40500), 60);
  assert.equal(remainingSeconds(timer, 41000), 59);
  assert.equal(remainingSeconds(timer, 120000), 0);
  assert.equal(remainingSeconds({ ...timer, running: false, remaining: 23, deadline: null }, 120000), 23);
  assert.deepEqual(restoreTimer(timer, defaultSettings()), timer);
});
test('损坏的番茄钟状态安全恢复为初始状态', () => {
  const settings = defaultSettings();
  for (const value of [null, {}, { running: true }, { phase: 'focus', remaining: -1 }]) assert.equal(restoreTimer(value, settings).remaining, 1500);
});
test('时间视图按任务持续区间显示，区间外不显示', () => {
  const tasks = modern().tasks;
  assert.equal(tasksOnDay(tasks, '2026-10-01').length, 1);
  assert.equal(tasksOnDay(tasks, '2026-10-02').length, 1);
  assert.equal(tasksOnDay(tasks, '2026-10-04').length, 0);
});
