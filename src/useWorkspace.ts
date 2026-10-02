import { useEffect, useRef, useState } from 'react';
import { emptyData, loadData, mergeData, newId, nowIso, saveData, validateData } from './data';
import type { ScheduleEvent, Settings, Task, TimeSession, Urgency, WorkspaceData } from './data';

export type TaskDraft = { title: string; notes: string; urgency: Urgency; tags: string[]; startAt: string; dueAt: string; progress: number };
export type EventDraft = { title: string; notes: string; startAt: string; endAt: string };
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const localDateTime = (iso: string | null) => iso ? `${dateKey(new Date(iso))}T${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}` : '';
export const blankTask = (): TaskDraft => ({ title: '', notes: '', urgency: 'shortterm', tags: [], startAt: localDateTime(nowIso()), dueAt: '', progress: 0 });
export const blankEvent = (day = dateKey(new Date())): EventDraft => ({ title: '', notes: '', startAt: `${day}T09:00`, endAt: `${day}T10:00` });
export const isUrgent = (task: Task) => !task.completedAt && (task.urgency === 'urgent' || (!!task.dueAt && Date.parse(task.dueAt) <= Date.now() + 3 * 86400000));
export const sessionSeconds = (session: TimeSession, now = Date.now()) => session.focusedSeconds ?? Math.max(0, Math.floor(((session.endAt ? Date.parse(session.endAt) : now) - Date.parse(session.startAt)) / 1000));
export const tasksOnDay = (tasks: Task[], day: string) => tasks.filter(task => {
  const start = task.startAt ? dateKey(new Date(task.startAt)) : null;
  const end = task.dueAt ? dateKey(new Date(task.dueAt)) : null;
  return start && end ? day >= start && day <= end : day === (end || start);
});

export function useWorkspace() {
  const [data, setData] = useState<WorkspaceData>(emptyData);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    let live = true;
    loadData().then(next => { if (live) { loaded.current = true; setData(next); } }).catch(e => { if (live) setError(String(e?.message ?? e)); }).finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!ready || !loaded.current || error) return;
    let live = true;
    setSaving(true);
    saveData(data).catch(e => { if (live) setError(`保存失败：${String(e?.message ?? e)}`); }).finally(() => { if (live) setSaving(false); });
    return () => { live = false; };
  }, [data, ready, error]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(id); }, [notice]);
  const update = (fn: (d: WorkspaceData) => WorkspaceData) => {
    if (!loaded.current) { setNotice('请先恢复本地数据，再进行编辑。'); return false; }
    setData(fn); return true;
  };
  const retryStorage = async () => {
    try {
      if (!loaded.current) { setData(await loadData()); loaded.current = true; }
      else await saveData(data);
      setError(''); setNotice('本地存储已恢复');
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  };
  const saveTask = (draft: TaskDraft, editingId: string | null) => {
    if (!draft.title.trim()) { setNotice('请输入任务名称'); return false; }
    if (draft.startAt && draft.dueAt && Date.parse(draft.startAt) > Date.parse(draft.dueAt)) { setNotice('截止日期不能早于开始日期'); return false; }
    const at = nowIso();
    const fields = { title: draft.title.trim(), notes: draft.notes.trim(), urgency: draft.urgency, tags: [...new Set(draft.tags.map(tag => tag.trim()).filter(Boolean))], startAt: draft.startAt ? new Date(draft.startAt).toISOString() : null, dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null, progress: draft.progress, completedAt: draft.progress === 100 ? at : null, updatedAt: at, category: draft.urgency === 'longterm' ? 'longterm' as const : 'planned' as const, priority: draft.urgency === 'urgent' ? 'high' as const : 'normal' as const };
    const id = editingId ?? newId();
    const saved = update(d => ({ ...d, tasks: editingId ? d.tasks.map(task => task.id === id ? { ...task, ...fields, completedAt: fields.completedAt && task.completedAt ? task.completedAt : fields.completedAt } : task) : [{ id, createdAt: at, ...fields }, ...d.tasks], sessions: fields.completedAt ? d.sessions.map(s => s.taskId === id && !s.endAt ? { ...s, endAt: at } : s) : d.sessions, activities: [{ id: newId(), taskId: id, type: editingId ? 'updated' : 'created', at }, ...d.activities] }));
    if (saved) setNotice(editingId ? '任务已更新' : '任务已创建');
    return saved;
  };
  const toggleTask = (task: Task) => {
    const at = nowIso(); const complete = !task.completedAt;
    if (update(d => ({ ...d, tasks: d.tasks.map(t => t.id === task.id ? { ...t, progress: complete ? 100 : 0, completedAt: complete ? at : null, updatedAt: at } : t), sessions: d.sessions.map(s => complete && s.taskId === task.id && !s.endAt ? { ...s, endAt: at } : s), activities: [{ id: newId(), taskId: task.id, type: complete ? 'completed' : 'reopened', at }, ...d.activities] }))) setNotice(complete ? '任务已完成' : '任务已重新打开');
  };
  const deleteTask = (task: Task) => {
    if (!confirm(`删除“${task.title}”？专注时长将保留为未关联记录。`)) return false;
    const result = update(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== task.id), sessions: d.sessions.map(s => s.taskId === task.id ? { ...s, taskId: null, endAt: s.endAt ?? nowIso() } : s), activities: d.activities.filter(a => a.taskId !== task.id) }));
    if (result) setNotice('任务已删除'); return result;
  };
  const recordFocus = (session: TimeSession) => {
    update(d => d.sessions.some(s => s.id === session.id) ? d : { ...d, sessions: [{ ...session, taskId: d.tasks.some(t => t.id === session.taskId) ? session.taskId : null }, ...d.sessions] });
  };
  const stopLegacyTimer = () => update(d => ({ ...d, sessions: d.sessions.map(s => !s.endAt ? { ...s, endAt: nowIso() } : s) }));
  const saveEvent = (draft: EventDraft, editingId: string | null) => {
    if (!draft.title.trim()) { setNotice('请输入日程名称'); return false; }
    if (!Number.isFinite(Date.parse(draft.startAt)) || !Number.isFinite(Date.parse(draft.endAt)) || Date.parse(draft.endAt) <= Date.parse(draft.startAt)) { setNotice('结束时间需要晚于开始时间'); return false; }
    const conflict = data.events.find(e => e.id !== editingId && Date.parse(draft.startAt) < Date.parse(e.endAt) && Date.parse(draft.endAt) > Date.parse(e.startAt));
    const at = nowIso(); const fields = { title: draft.title.trim(), notes: draft.notes.trim(), startAt: new Date(draft.startAt).toISOString(), endAt: new Date(draft.endAt).toISOString(), updatedAt: at };
    const saved = update(d => ({ ...d, events: editingId ? d.events.map(e => e.id === editingId ? { ...e, ...fields } : e) : [...d.events, { id: newId(), createdAt: at, ...fields }] }));
    if (saved) setNotice(conflict ? `已保存；与“${conflict.title}”时间重叠` : '日程已保存'); return saved;
  };
  const deleteEvent = (item: ScheduleEvent) => { if (!confirm(`删除日程“${item.title}”？`)) return false; const result = update(d => ({ ...d, events: d.events.filter(e => e.id !== item.id) })); if (result) setNotice('日程已删除'); return result; };
  const saveSettings = (settings: Settings) => { if (update(d => ({ ...d, settings }))) setNotice('设置已保存'); };
  const exportData = () => { const blob = new Blob([JSON.stringify({ ...data, exportedAt: nowIso() }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `个人工作台备份-${dateKey(new Date())}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('备份已导出'); };
  const importData = async (file: File, mode: 'replace' | 'merge') => {
    try {
      const incoming = validateData(JSON.parse(await file.text()));
      if (mode === 'replace' && !confirm('替换会覆盖当前工作台数据，建议先导出备份。继续？')) return;
      const next = mode === 'replace' ? incoming : mergeData(data, incoming);
      await saveData(next); loaded.current = true; setData(next); setError(''); setNotice(`导入完成：${next.tasks.length} 项任务、${next.events.length} 条日程`);
    } catch (e) { setNotice(`导入失败：${String(e instanceof Error ? e.message : e)}`); }
  };
  return { data, ready, error, saving, notice, setNotice, retryStorage, saveTask, toggleTask, deleteTask, recordFocus, stopLegacyTimer, saveEvent, deleteEvent, saveSettings, exportData, importData };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
