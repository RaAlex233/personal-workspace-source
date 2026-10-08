import { newId } from './data';
import type { Activity, Task, WorkspaceData } from './data';
import { dateKey } from './localDay';

export const COMPLETION_DESCRIPTION_LIMIT = 500;

export function recordCompletion(activities: Activity[], task: Task, complete: boolean, at: string, description = ''): Activity[] {
  if (complete) return [{ id: newId(), taskId: task.id, type: 'completed', at, description: description.trim(), revokedAt: null }, ...activities];
  const day = dateKey(new Date(at));
  const history = activities.map(activity => activity.taskId === task.id && activity.type === 'completed' && !activity.revokedAt && (task.type !== 'daily' || dateKey(new Date(activity.at)) === day) ? { ...activity, revokedAt: at } : activity);
  return [{ id: newId(), taskId: task.id, type: 'reopened', at }, ...history];
}

// Structured source material for a future Agent summary, including empty descriptions.
export function completionReferences(data: WorkspaceData, fromDay?: string, toDay?: string) {
  return data.activities.filter(activity => {
    const day = dateKey(new Date(activity.at));
    return activity.type === 'completed' && !activity.revokedAt && (!fromDay || day >= fromDay) && (!toDay || day <= toDay);
  }).flatMap(activity => {
    const task = data.tasks.find(item => item.id === activity.taskId);
    if (!task || (task.type === 'daily' ? !task.checkInDates.includes(dateKey(new Date(activity.at))) : !task.completedAt || Date.parse(activity.at) !== Date.parse(task.completedAt))) return [];
    return [{ id: activity.id, taskId: task.id, title: task.title, taskType: task.type, completedAt: activity.at, description: activity.description ?? '', tags: [...task.tags] }];
  }).sort((a, b) => b.completedAt.localeCompare(a.completedAt)).filter((entry, index, entries) => entry.taskType !== 'daily' || entries.findIndex(other => other.taskId === entry.taskId && dateKey(new Date(other.completedAt)) === dateKey(new Date(entry.completedAt))) === index);
}
