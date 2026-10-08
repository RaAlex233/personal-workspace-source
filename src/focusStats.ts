import type { Task, TimeSession } from './data';
import { dateKey } from './localDay';

export type FocusRange = 'today' | 'week' | 'all';
export function focusBreakdown(sessions: TimeSession[], tasks: Task[], range: FocusRange, now = new Date()) {
  const today = dateKey(now);
  const first = new Date(now); first.setDate(first.getDate() - 6);
  const firstDay = dateKey(first);
  const totals = new Map<string | null, number>();
  sessions.forEach(session => {
    const day = dateKey(new Date(session.startAt));
    if (session.source !== 'pomodoro' || !session.endAt || day > today || (range === 'today' && day !== today) || (range === 'week' && day < firstDay)) return;
    const seconds = session.focusedSeconds ?? Math.max(0, Math.floor((Date.parse(session.endAt) - Date.parse(session.startAt)) / 1000));
    if (seconds <= 0) return;
    const taskId = tasks.some(task => task.id === session.taskId) ? session.taskId : null;
    totals.set(taskId, (totals.get(taskId) ?? 0) + seconds);
  });
  const total = [...totals.values()].reduce((sum, seconds) => sum + seconds, 0);
  const entries = [...totals].map(([id, seconds]) => ({ id, title: tasks.find(task => task.id === id)?.title ?? '自由专注 / 未关联', seconds })).sort((a, b) => b.seconds - a.seconds);
  // Keep a readable pie while the legend and record list retain precise totals.
  const slices = entries.length > 6 ? [...entries.slice(0, 5), { id: 'other', title: '其他任务', seconds: entries.slice(5).reduce((sum, item) => sum + item.seconds, 0) }] : entries;
  return { total, slices: slices.map(item => ({ ...item, percent: total ? item.seconds / total * 100 : 0 })) };
}
