import type { Task } from './data';
import { dateKey } from './localDay';

export function taskForDay(task: Task, day: string): Task {
  if (task.type !== 'daily') return task;
  const done = task.checkInDates.includes(day);
  const completedAt = done ? task.completedAt && dateKey(new Date(task.completedAt)) === day ? task.completedAt : new Date(`${day}T12:00:00`).toISOString() : null;
  return { ...task, progress: done ? 100 : 0, completedAt };
}

export function setCheckIn(dates: string[], day: string, done: boolean) {
  return done ? [...new Set([...dates, day])].sort() : dates.filter(value => value !== day);
}
