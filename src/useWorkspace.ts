import { useEffect, useState } from 'react';
import { emptyData, loadData, mergeData, newId, nowIso, saveData, validateData } from './data';
import type { Priority, ScheduleEvent, Task, TaskCategory, WorkspaceData } from './data';

export type TaskDraft = { title: string; notes: string; category: TaskCategory; priority: Priority; dueAt: string };
export type EventDraft = { title: string; notes: string; startAt: string; endAt: string };
export const blankTask = (): TaskDraft => ({ title: '', notes: '', category: 'inbox', priority: 'normal', dueAt: '' });
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const localDateTime = (iso: string | null) => iso ? `${dateKey(new Date(iso))}T${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}` : '';
export const blankEvent = (day = dateKey(new Date())): EventDraft => ({ title: '', notes: '', startAt: `${day}T09:00`, endAt: `${day}T10:00` });
export const isUrgent = (task: Task) => !task.completedAt && !!task.dueAt && new Date(task.dueAt).getTime() <= Date.now() + 3 * 86400000;

export function useWorkspace() {
  const [data, setData] = useState<WorkspaceData>(emptyData);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { loadData().then(setData).catch(e => setError(String(e?.message ?? e))).finally(() => setReady(true)); }, []);
  useEffect(() => { if (ready && !error) saveData(data).catch(e => setError(`保存失败：${String(e?.message ?? e)}`)); }, [data, ready, error]);
  useEffect(() => { const id = setInterval(() => setTick(Date.now()), 30000); return () => clearInterval(id); }, []);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(id); }, [notice]);
  const active = data.sessions.find(s => !s.endAt);
  const update = (fn: (d: WorkspaceData) => WorkspaceData) => setData(fn);
  const saveTask = (draft: TaskDraft, editingId: string | null) => {
    if (!draft.title.trim()) return;
    const at = nowIso();
    update(d => {
      if (editingId) return { ...d, tasks: d.tasks.map(t => t.id === editingId ? { ...t, title: draft.title.trim(), notes: draft.notes.trim(), category: draft.category, priority: draft.priority, dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null, updatedAt: at } : t), activities: [{ id: newId(), taskId: editingId, type: 'updated', at }, ...d.activities] };
      const id = newId();
      return { ...d, tasks: [{ id, title: draft.title.trim(), notes: draft.notes.trim(), category: draft.category, priority: draft.priority, dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null, completedAt: null, createdAt: at, updatedAt: at }, ...d.tasks], activities: [{ id: newId(), taskId: id, type: 'created', at }, ...d.activities] };
    });
    setNotice(editingId ? '任务已更新' : '任务已创建');
  };
  const toggleTask = (task: Task) => {
    const at = nowIso(); const complete = !task.completedAt;
    update(d => ({ ...d, tasks: d.tasks.map(t => t.id === task.id ? { ...t, completedAt: complete ? at : null, updatedAt: at } : t), sessions: d.sessions.map(s => complete && s.taskId === task.id && !s.endAt ? { ...s, endAt: at } : s), activities: [{ id: newId(), taskId: task.id, type: complete ? 'completed' : 'reopened', at }, ...(complete && d.sessions.some(s => s.taskId === task.id && !s.endAt) ? [{ id: newId(), taskId: task.id, type: 'stopped' as const, at }] : []), ...d.activities] }));
    setNotice(complete ? '任务已完成' : '任务已重新打开');
  };
  const deleteTask = (task: Task) => {
    if (!confirm(`删除“${task.title}”及其时间记录？此操作无法撤销。`)) return;
    update(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== task.id), sessions: d.sessions.filter(s => s.taskId !== task.id), activities: d.activities.filter(a => a.taskId !== task.id) })); setNotice('任务已删除');
  };
  const startTask = (task: Task) => {
    if (active) { setNotice('请先结束当前任务，再开始新的计时。'); return; }
    const at = nowIso(); update(d => ({ ...d, sessions: [{ id: newId(), taskId: task.id, startAt: at, endAt: null }, ...d.sessions], activities: [{ id: newId(), taskId: task.id, type: 'started', at }, ...d.activities] })); setNotice(`已开始：${task.title}`);
  };
  const stopTask = (task: Task) => {
    const session = data.sessions.find(s => s.taskId === task.id && !s.endAt); if (!session) return;
    const at = nowIso(); update(d => ({ ...d, sessions: d.sessions.map(s => s.id === session.id ? { ...s, endAt: at } : s), activities: [{ id: newId(), taskId: task.id, type: 'stopped', at }, ...d.activities] })); setNotice(`已结束计时：${task.title}`);
  };
  const saveEvent = (draft: EventDraft, editingId: string | null) => {
    if (!draft.title.trim()) return false;
    if (new Date(draft.endAt) <= new Date(draft.startAt)) { setNotice('结束时间需要晚于开始时间。'); return false; }
    const conflict = data.events.find(e => e.id !== editingId && Date.parse(draft.startAt) < Date.parse(e.endAt) && Date.parse(draft.endAt) > Date.parse(e.startAt));
    const at = nowIso(); const fields = { title: draft.title.trim(), notes: draft.notes.trim(), startAt: new Date(draft.startAt).toISOString(), endAt: new Date(draft.endAt).toISOString(), updatedAt: at };
    update(d => ({ ...d, events: editingId ? d.events.map(e => e.id === editingId ? { ...e, ...fields } : e) : [...d.events, { id: newId(), createdAt: at, ...fields }] })); setNotice(conflict ? `已保存；时间与“${conflict.title}”重叠` : editingId ? '日程已更新' : '日程已创建'); return true;
  };
  const deleteEvent = (item: ScheduleEvent) => { if (!confirm(`删除日程“${item.title}”？`)) return false; update(d => ({ ...d, events: d.events.filter(e => e.id !== item.id) })); setNotice('日程已删除'); return true; };
  const exportData = () => { const blob = new Blob([JSON.stringify({ ...data, exportedAt: nowIso() }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `个人工作台备份-${dateKey(new Date())}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('备份已导出'); };
  const importData = async (file: File) => {
    try { const incoming = validateData(JSON.parse(await file.text())); const replace = confirm('导入方式：\n确定：替换当前数据\n取消：与当前数据合并（相同 ID 以导入数据为准）'); const next = replace ? incoming : mergeData(data, incoming); await saveData(next); setData(next); setError(''); setNotice(`导入完成：${next.tasks.length} 项任务、${next.events.length} 条日程`); }
    catch (e) { setNotice(`导入失败：${String(e instanceof Error ? e.message : e)}`); }
  };
  return { data, ready, error, notice, tick, active, setNotice, saveTask, toggleTask, deleteTask, startTask, stopTask, saveEvent, deleteEvent, exportData, importData };
}
