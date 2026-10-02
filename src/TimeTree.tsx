import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { WorkspaceData, Task } from './data';
import Icon from './Icon';
import { dateKey, sessionSeconds } from './useWorkspace';
import { Empty, PanelTitle, displayMinutes } from './ui';

const DAY_WIDTH = 42;
const DAY_COUNT = 35;
export function dayOffset(start: Date, iso: string) {
  const date = new Date(iso);
  return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000);
}
export function TimeTree({ data, anchor, setAnchor, editTask, showCompleted, setShowCompleted, detailed = false, expand }: { data: WorkspaceData; anchor: Date; setAnchor: (date: Date) => void; editTask: (task: Task) => void; showCompleted: boolean; setShowCompleted: (value: boolean) => void; detailed?: boolean; expand?: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; scroll: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const start = new Date(anchor); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 7);
  const days = Array.from({ length: DAY_COUNT }, (_, i) => { const date = new Date(start); date.setDate(start.getDate() + i); return date; });
  const todayOffset = dayOffset(start, new Date().toISOString());
  const tasks = data.tasks.filter(task => showCompleted || !task.completedAt).sort((a, b) => (a.startAt ?? a.createdAt).localeCompare(b.startAt ?? b.createdAt));
  useEffect(() => { if (viewport.current) viewport.current.scrollLeft = Math.max(0, (dayOffset(start, anchor.toISOString()) - 3) * DAY_WIDTH); }, [anchor]);
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => { if (drag.current) event.currentTarget.scrollLeft = drag.current.scroll - (event.clientX - drag.current.x); };
  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => { if (drag.current && event.currentTarget.hasPointerCapture(drag.current.id)) event.currentTarget.releasePointerCapture(drag.current.id); drag.current = null; setDragging(false); };
  const shift = (amount: number) => { const date = new Date(anchor); date.setDate(date.getDate() + amount); setAnchor(date); };
  return <section className="panel time-tree-panel"><PanelTitle title="时间树" subtitle="让持续的努力，看得见" action={<button className="text-button" onClick={detailed ? () => setShowCompleted(!showCompleted) : expand}>{detailed ? showCompleted ? '隐藏已完成' : '显示已完成' : '展开时间树'}<Icon name="arrow" size={16}/></button>}/>{tasks.length ? <div className={`tree-viewport ${dragging ? 'dragging' : ''} ${detailed ? 'full' : ''}`} ref={viewport} tabIndex={0} role="region" aria-label="横向任务时间树，可左右滚动" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}><div className="tree-content" style={{ width: `calc(var(--tree-label-width) + ${DAY_COUNT * DAY_WIDTH}px)` }}><div className="tree-header"><div className="tree-label">任务 / 持续进度</div><div className="tree-dates">{days.map(day => <div className={`tree-date ${dateKey(day) === dateKey(new Date()) ? 'current' : ''}`} key={dateKey(day)} style={{ width: DAY_WIDTH }}><small>{day.getDate() === 1 || day === days[0] ? `${day.getMonth() + 1}月` : ['日', '一', '二', '三', '四', '五', '六'][day.getDay()]}</small><strong>{day.getDate()}</strong></div>)}</div></div>{tasks.map(task => {
    const taskStart = task.startAt ?? task.createdAt;
    const rawStart = dayOffset(start, taskStart);
    const rawEnd = task.dueAt ? dayOffset(start, task.dueAt) : Math.max(rawStart, todayOffset);
    const left = Math.max(0, rawStart); const right = Math.min(DAY_COUNT - 1, rawEnd);
    const visible = right >= left && rawEnd >= 0 && rawStart < DAY_COUNT;
    const seconds = data.sessions.filter(session => session.taskId === task.id).reduce((sum, session) => sum + sessionSeconds(session), 0);
    const progressEnd = rawStart + (rawEnd - rawStart + 1) * task.progress / 100;
    const clippedProgress = Math.max(0, Math.min(right - left + 1, progressEnd - left));
    return <div className={`tree-row ${task.completedAt ? 'done' : ''}`} key={task.id}><button className="tree-label" onClick={() => editTask(task)}><strong>{task.title}</strong><span>{task.progress}% 完成{seconds > 0 ? ` · 专注 ${displayMinutes(seconds)}` : ''}</span></button><div className="tree-track" style={{ backgroundSize: `${DAY_WIDTH}px 100%` }}>{todayOffset >= 0 && todayOffset < DAY_COUNT && <span className="today-line" style={{ left: (todayOffset + 0.5) * DAY_WIDTH }}/>} {visible ? <button className={`tree-bar ${task.urgency}`} style={{ left: left * DAY_WIDTH + 3, width: Math.max(16, (right - left + 1) * DAY_WIDTH - 6) }} onClick={() => editTask(task)} title={`${task.title} · ${task.progress}% 完成${task.dueAt ? ` · 截止 ${new Date(task.dueAt).toLocaleDateString('zh-CN')}` : ' · 无截止日期'}`}><span className="tree-bar-progress" style={{ width: `${clippedProgress / (right - left + 1) * 100}%` }}/><span className="tree-bar-text">{task.progress}%{!task.dueAt && ' · 持续中'}</span></button> : <button className="tree-outside" onClick={() => { setAnchor(new Date(rawStart >= DAY_COUNT ? taskStart : task.dueAt ?? taskStart)); }}>查看任务所在日期 <Icon name="arrow" size={13}/></button>}</div></div>;
  })}</div></div> : <Empty title="从一个任务开始，留下成长轨迹" detail="设置开始日期和截止日期，更新进度后会显示在时间树中。"/>}<footer className="panel-options tree-options"><span><Icon name="tree" size={15}/>拖动空白区域，或左右滚动</span><div className="calendar-navigation"><button className="icon-button" onClick={() => shift(-14)} aria-label="时间树向前两周"><Icon name="left" size={16}/></button><button className="subtle-button" onClick={() => setAnchor(new Date())}>回到今天</button><button className="icon-button" onClick={() => shift(14)} aria-label="时间树向后两周"><Icon name="right" size={16}/></button></div><label className="inline-check"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)}/>已完成</label></footer></section>;
}
