import { useEffect, useRef, useState } from 'react';
import { emptyData, loadData, mergeData, newId, nowIso, saveData, validateData } from './data';
import type { ScheduleEvent, Settings, Task, TimeSession, Urgency, WorkspaceData } from './data';
import { acquireWorkspaceAccess } from './workspaceAccess';
import type { WorkspaceAccess } from './workspaceAccess';

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

export function weeklyFocusSummary(sessions: TimeSession[], now = new Date()) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now); day.setDate(day.getDate() - 6 + index); return day;
  });
  const keys = new Set(days.map(dateKey));
  const recent = sessions.filter(session => session.source === 'pomodoro' && keys.has(dateKey(new Date(session.startAt))));
  return {
    days,
    dayValues: days.map(day => recent.filter(session => dateKey(new Date(session.startAt)) === dateKey(day)).reduce((sum, session) => sum + sessionSeconds(session), 0)),
    total: recent.reduce((sum, session) => sum + sessionSeconds(session), 0),
    completed: recent.filter(session => session.completed).length,
  };
}

export function useWorkspace() {
  const [data, setData] = useState<WorkspaceData>(emptyData);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [writable, setWritable] = useState(false);
  const [blockedReason, setBlockedReason] = useState('');
  const [importing, setImporting] = useState(false);
  const loaded = useRef(false);
  const latest = useRef(data);
  const persisted = useRef(data);
  const access = useRef<WorkspaceAccess | null>(null);
  const importingRef = useRef(false);
  const opening = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const storageError = useRef('');
  const pendingSaves = useRef(0);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const showError = (message: string) => { storageError.current = message; if (mounted.current) setError(message); };
  const replaceData = (next: WorkspaceData) => { latest.current = next; if (mounted.current) setData(next); };
  const persist = (next: WorkspaceData) => {
    const attempt = generation.current;
    pendingSaves.current += 1;
    if (mounted.current) setSaving(true);
    const saved = saves.current.catch(() => undefined).then(() => saveData(next)).then(() => {
      persisted.current = next;
    }).catch(e => {
      if (attempt === generation.current) showError(`保存失败：${String(e instanceof Error ? e.message : e)}`);
      throw e;
    }).finally(() => {
      pendingSaves.current -= 1;
      if (mounted.current) setSaving(pendingSaves.current > 0);
    });
    saves.current = saved;
    return saved;
  };
  const openWorkspace = async (attempt = generation.current) => {
    if (attempt !== generation.current || opening.current) return;
    opening.current = true;
    loaded.current = false;
    setReady(false);
    try {
      if (!access.current?.writable) {
        const nextAccess = await acquireWorkspaceAccess();
        if (attempt !== generation.current) { nextAccess.release(); return; }
        access.current = nextAccess;
        setWritable(nextAccess.writable);
        setBlockedReason(nextAccess.reason);
      }
      const next = await loadData();
      if (attempt !== generation.current) return;
      loaded.current = true;
      persisted.current = next;
      replaceData(next);
      showError('');
    } catch (e) {
      if (attempt === generation.current) showError(String(e instanceof Error ? e.message : e));
    } finally {
      if (attempt === generation.current) { opening.current = false; setReady(true); }
    }
  };
  useEffect(() => {
    mounted.current = true;
    const attempt = ++generation.current;
    opening.current = false;
    loaded.current = false;
    setWritable(false);
    // Deferring avoids acquiring a lock for StrictMode's discarded mount.
    void Promise.resolve().then(() => openWorkspace(attempt));
    return () => {
      mounted.current = false;
      generation.current += 1;
      const ownedAccess = access.current;
      access.current = null;
      // Another page must not edit until all writes from this page have settled.
      void saves.current.catch(() => undefined).then(() => ownedAccess?.release());
    };
  }, []);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(id); }, [notice]);
  const canEdit = () => {
    if (!access.current?.writable) { setNotice('当前页面为只读，请先获取编辑权限。'); return false; }
    if (importingRef.current) { setNotice('正在导入数据，请稍后再编辑。'); return false; }
    if (!loaded.current) { setNotice('请先恢复本地数据，再进行编辑。'); return false; }
    if (storageError.current) { setNotice('请先重试恢复本地存储，再进行编辑。'); return false; }
    return true;
  };
  const update = (fn: (d: WorkspaceData) => WorkspaceData) => {
    if (!canEdit()) return false;
    const next = fn(latest.current);
    replaceData(next);
    void persist(next).catch(() => undefined);
    return true;
  };
  const retryStorage = async () => {
    if (importingRef.current || opening.current) return;
    try {
      if (!access.current?.writable || !loaded.current) { await openWorkspace(); return; }
      await persist(latest.current);
      showError(''); setNotice('本地存储已恢复');
    } catch (e) { showError(String(e instanceof Error ? e.message : e)); }
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
  const recordFocus = async (session: TimeSession): Promise<boolean> => {
    if (!canEdit()) return false;
    const current = latest.current;
    const next = current.sessions.some(s => s.id === session.id) ? current : { ...current, sessions: [{ ...session, taskId: current.tasks.some(t => t.id === session.taskId) ? session.taskId : null }, ...current.sessions] };
    replaceData(next);
    try { await persist(next); return true; }
    catch { return false; }
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
    if (!access.current?.writable || opening.current || importingRef.current) { setNotice('当前无法导入，请先获取编辑权限或等待当前操作完成。'); return; }
    importingRef.current = true;
    setImporting(true);
    const attempt = generation.current;
    try {
      // Include previously accepted edits, then block edits until import commits.
      await saves.current.catch(() => undefined);
      const incoming = validateData(JSON.parse(await file.text()));
      if (attempt !== generation.current || !access.current?.writable) return;
      if (mode === 'replace' && !confirm('替换会覆盖当前工作台数据，建议先导出备份。继续？')) return;
      const next = mode === 'replace' ? incoming : mergeData(latest.current, incoming);
      await persist(next);
      if (attempt !== generation.current) return;
      loaded.current = true; replaceData(next); showError(''); setNotice(`导入完成：${next.tasks.length} 项任务、${next.events.length} 条日程`);
    } catch (e) { setNotice(`导入失败：${String(e instanceof Error ? e.message : e)}`); }
    finally { importingRef.current = false; if (mounted.current) setImporting(false); }
  };
  const getSavedFocus = (sessionId: string) => persisted.current.sessions.find(session => session.id === sessionId) ?? null;
  return { data, ready, error, saving, writable, blockedReason, importing, notice, setNotice, retryStorage, saveTask, toggleTask, deleteTask, recordFocus, getSavedFocus, stopLegacyTimer, saveEvent, deleteEvent, saveSettings, exportData, importData };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
