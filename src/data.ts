export type TaskCategory = 'inbox' | 'planned' | 'longterm';
export type Priority = 'low' | 'normal' | 'high';
export type Urgency = 'longterm' | 'shortterm' | 'urgent';
export type ActivityType = 'created' | 'started' | 'stopped' | 'completed' | 'reopened' | 'updated';

export interface Task {
  id: string;
  title: string;
  notes: string;
  category: TaskCategory;
  priority: Priority;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  urgency: Urgency;
  tags: string[];
  startAt: string | null;
  progress: number;
}

export interface ScheduleEvent {
  id: string;
  title: string;
  notes: string;
  startAt: string;
  endAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimeSession {
  id: string;
  taskId: string | null;
  startAt: string;
  endAt: string | null;
  source: 'manual' | 'pomodoro';
  focusedSeconds: number | null;
  completed: boolean;
}

export interface Activity {
  id: string;
  taskId: string;
  type: ActivityType;
  at: string;
}

export interface Settings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  sound: boolean;
  autoBreak: boolean;
  theme: 'light' | 'dark' | 'system';
  nickname: string;
}

export const defaultSettings = (): Settings => ({ focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, sound: true, autoBreak: false, theme: 'light', nickname: '' });

export interface WorkspaceData {
  schemaVersion: 2;
  tasks: Task[];
  events: ScheduleEvent[];
  sessions: TimeSession[];
  activities: Activity[];
  settings: Settings;
}

export const emptyData = (): WorkspaceData => ({ schemaVersion: 2, tasks: [], events: [], sessions: [], activities: [], settings: defaultSettings() });
export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

const DB_NAME = 'personal-workspace';
const STORE_NAME = 'workspace';
const RECORD_KEY = 'current';
let saveQueue = Promise.resolve();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('此浏览器不支持本地数据库。')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库。'));
  });
}

export async function loadData(recordKey = RECORD_KEY): Promise<WorkspaceData> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(recordKey);
      request.onsuccess = () => {
        try { resolve(request.result ? validateData(request.result) : emptyData()); }
        catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error ?? new Error('读取失败。'));
    });
  } finally { db.close(); }
}

function writeData(data: WorkspaceData, recordKey: string): Promise<void> {
  return openDb().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, recordKey);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('保存失败。')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('保存中断。')); };
  }));
}

export function saveData(data: WorkspaceData, recordKey = RECORD_KEY): Promise<void> {
  const next = saveQueue.catch(() => undefined).then(() => writeData(data, recordKey));
  saveQueue = next.catch(() => undefined);
  return next;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalDate = (value: unknown): value is string | null => value === null || validDate(value);
const str = (value: unknown): value is string => typeof value === 'string';
const uniqueIds = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length;

export function validateData(value: unknown): WorkspaceData {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2) || !Array.isArray(value.tasks) || !Array.isArray(value.events) || !Array.isArray(value.sessions) || !Array.isArray(value.activities)) {
    throw new Error('文件不是受支持的工作台数据格式。');
  }
  const legacy = value.schemaVersion === 1;
  const data = {
    ...value, schemaVersion: 2,
    tasks: value.tasks.map(task => {
      if (!legacy || !isRecord(task)) return task;
      return { ...task, urgency: task.priority === 'high' ? 'urgent' : task.category === 'longterm' ? 'longterm' : 'shortterm', tags: [task.category === 'longterm' ? '长期任务' : task.category === 'planned' ? '近期计划' : '收件箱'], startAt: validDate(task.dueAt) && validDate(task.createdAt) && Date.parse(task.dueAt) < Date.parse(task.createdAt) ? task.dueAt : task.createdAt, progress: task.completedAt ? 100 : 0 };
    }),
    sessions: value.sessions.map(session => legacy && isRecord(session) ? { ...session, source: 'manual', focusedSeconds: null, completed: false } : session),
    settings: legacy ? defaultSettings() : value.settings,
  } as unknown as WorkspaceData;
  const validTask = (task: unknown): task is Task => isRecord(task) && str(task.id) && str(task.title) && str(task.notes) && ['inbox','planned','longterm'].includes(String(task.category)) && ['low','normal','high'].includes(String(task.priority)) && optionalDate(task.dueAt) && optionalDate(task.completedAt) && validDate(task.createdAt) && validDate(task.updatedAt);
  const validEvent = (event: unknown): event is ScheduleEvent => isRecord(event) && str(event.id) && str(event.title) && str(event.notes) && validDate(event.startAt) && validDate(event.endAt) && validDate(event.createdAt) && validDate(event.updatedAt);
  const validSession = (session: unknown): session is TimeSession => isRecord(session) && str(session.id) && (session.taskId === null || str(session.taskId)) && validDate(session.startAt) && optionalDate(session.endAt);
  const validActivity = (activity: unknown): activity is Activity => isRecord(activity) && str(activity.id) && str(activity.taskId) && ['created','started','stopped','completed','reopened','updated'].includes(String(activity.type)) && validDate(activity.at);
  const extendedTask = (task: Task) => ['longterm', 'shortterm', 'urgent'].includes(task.urgency) && Array.isArray(task.tags) && task.tags.every(str) && optionalDate(task.startAt) && typeof task.progress === 'number' && task.progress >= 0 && task.progress <= 100 && (!task.startAt || !task.dueAt || Date.parse(task.startAt) <= Date.parse(task.dueAt));
  const extendedSession = (session: TimeSession) => ['manual', 'pomodoro'].includes(session.source) && (session.focusedSeconds === null || (typeof session.focusedSeconds === 'number' && Number.isFinite(session.focusedSeconds) && session.focusedSeconds >= 0)) && typeof session.completed === 'boolean' && (!session.endAt || Date.parse(session.endAt) >= Date.parse(session.startAt));
  if (!data.tasks.every(validTask) || !data.tasks.every(extendedTask) || !data.events.every(validEvent) || data.events.some(event => Date.parse(event.endAt) <= Date.parse(event.startAt)) || !data.sessions.every(validSession) || !data.sessions.every(extendedSession) || !data.activities.every(validActivity) || !uniqueIds(data.tasks) || !uniqueIds(data.events) || !uniqueIds(data.sessions) || !uniqueIds(data.activities)) {
    throw new Error('文件中存在缺失、重复或无效的记录。');
  }
  const taskIds = new Set(data.tasks.map(task => task.id));
  if (data.sessions.some(session => session.taskId !== null && !taskIds.has(session.taskId)) || data.activities.some(activity => !taskIds.has(activity.taskId))) throw new Error('文件中有无法对应任务的时间记录。');
  if (data.sessions.filter(session => !session.endAt).length > 1) throw new Error('数据中只能有一个进行中的计时。');
  const settings = data.settings;
  if (!isRecord(settings) || ![settings.focusMinutes, settings.shortBreakMinutes, settings.longBreakMinutes].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 180) || !Number.isInteger(settings.longBreakEvery) || settings.longBreakEvery < 2 || settings.longBreakEvery > 12 || typeof settings.sound !== 'boolean' || typeof settings.autoBreak !== 'boolean' || !['light', 'dark', 'system'].includes(settings.theme) || !str(settings.nickname)) throw new Error('设置数据无效。');
  return data;
}

export function mergeData(current: WorkspaceData, incoming: WorkspaceData): WorkspaceData {
  const merge = <T extends { id: string }>(a: T[], b: T[]) => {
    const map = new Map(a.map(item => [item.id, item]));
    b.forEach(item => map.set(item.id, item));
    return [...map.values()];
  };
  const merged = { schemaVersion: 2 as const, tasks: merge(current.tasks, incoming.tasks), events: merge(current.events, incoming.events), sessions: merge(current.sessions, incoming.sessions), activities: merge(current.activities, incoming.activities), settings: current.settings };
  return validateData(merged);
}
