export type TaskCategory = 'inbox' | 'planned' | 'longterm';
export type Priority = 'low' | 'normal' | 'high';
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
  taskId: string;
  startAt: string;
  endAt: string | null;
}

export interface Activity {
  id: string;
  taskId: string;
  type: ActivityType;
  at: string;
}

export interface WorkspaceData {
  schemaVersion: 1;
  tasks: Task[];
  events: ScheduleEvent[];
  sessions: TimeSession[];
  activities: Activity[];
}

export const emptyData = (): WorkspaceData => ({ schemaVersion: 1, tasks: [], events: [], sessions: [], activities: [] });
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

export async function loadData(): Promise<WorkspaceData> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      request.onsuccess = () => {
        try { resolve(request.result ? validateData(request.result) : emptyData()); }
        catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error ?? new Error('读取失败。'));
    });
  } finally { db.close(); }
}

function writeData(data: WorkspaceData): Promise<void> {
  return openDb().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, RECORD_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('保存失败。')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('保存中断。')); };
  }));
}

export function saveData(data: WorkspaceData): Promise<void> {
  const next = saveQueue.catch(() => undefined).then(() => writeData(data));
  saveQueue = next.catch(() => undefined);
  return next;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalDate = (value: unknown): value is string | null => value === null || validDate(value);
const str = (value: unknown): value is string => typeof value === 'string';
const uniqueIds = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length;

export function validateData(value: unknown): WorkspaceData {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.tasks) || !Array.isArray(value.events) || !Array.isArray(value.sessions) || !Array.isArray(value.activities)) {
    throw new Error('文件不是受支持的工作台数据格式。');
  }
  const data = value as unknown as WorkspaceData;
  const validTask = (task: unknown): task is Task => isRecord(task) && str(task.id) && str(task.title) && str(task.notes) && ['inbox','planned','longterm'].includes(String(task.category)) && ['low','normal','high'].includes(String(task.priority)) && optionalDate(task.dueAt) && optionalDate(task.completedAt) && validDate(task.createdAt) && validDate(task.updatedAt);
  const validEvent = (event: unknown): event is ScheduleEvent => isRecord(event) && str(event.id) && str(event.title) && str(event.notes) && validDate(event.startAt) && validDate(event.endAt) && validDate(event.createdAt) && validDate(event.updatedAt);
  const validSession = (session: unknown): session is TimeSession => isRecord(session) && str(session.id) && str(session.taskId) && validDate(session.startAt) && optionalDate(session.endAt);
  const validActivity = (activity: unknown): activity is Activity => isRecord(activity) && str(activity.id) && str(activity.taskId) && ['created','started','stopped','completed','reopened','updated'].includes(String(activity.type)) && validDate(activity.at);
  if (!data.tasks.every(validTask) || !data.events.every(validEvent) || !data.sessions.every(validSession) || !data.activities.every(validActivity) || !uniqueIds(data.tasks) || !uniqueIds(data.events) || !uniqueIds(data.sessions) || !uniqueIds(data.activities)) {
    throw new Error('文件中存在缺失、重复或无效的记录。');
  }
  const taskIds = new Set(data.tasks.map(task => task.id));
  if (data.sessions.some(session => !taskIds.has(session.taskId)) || data.activities.some(activity => !taskIds.has(activity.taskId))) throw new Error('文件中有无法对应任务的时间记录。');
  return data;
}

export function mergeData(current: WorkspaceData, incoming: WorkspaceData): WorkspaceData {
  const merge = <T extends { id: string }>(a: T[], b: T[]) => {
    const map = new Map(a.map(item => [item.id, item]));
    b.forEach(item => map.set(item.id, item));
    return [...map.values()];
  };
  const merged = { schemaVersion: 1 as const, tasks: merge(current.tasks, incoming.tasks), events: merge(current.events, incoming.events), sessions: merge(current.sessions, incoming.sessions), activities: merge(current.activities, incoming.activities) };
  return validateData(merged);
}
