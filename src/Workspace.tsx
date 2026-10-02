import { useEffect, useState } from 'react';
import type { Task, ScheduleEvent } from './data';
import Icon from './Icon';
import type { IconName } from './Icon';
import { useWorkspace, blankTask, blankEvent, dateKey, localDateTime, isUrgent } from './useWorkspace';
import type { TaskDraft, EventDraft } from './useWorkspace';
import { TaskPanel, TaskEditor, defaultFilters } from './TaskPanel';
import { CalendarPanel, EventEditor } from './CalendarPanel';
import type { CalendarMode } from './CalendarPanel';
import { TimeTree } from './TimeTree';
import { FocusPanel, FocusHistory } from './FocusPanel';
import { usePomodoro } from './usePomodoro';
import { Profile } from './Profile';

type Page = 'home' | 'views' | 'focus' | 'agent' | 'profile';
type ViewTab = 'calendar' | 'tree' | 'tasks';
const navigation: { page: Page; label: string; icon: IconName; color: string }[] = [{ page: 'home', label: '主页', icon: 'home', color: 'green' }, { page: 'views', label: '视图', icon: 'calendar', color: 'blue' }, { page: 'focus', label: '专注', icon: 'focus', color: 'orange' }, { page: 'agent', label: 'Agent', icon: 'agent', color: 'purple' }, { page: 'profile', label: '我的', icon: 'user', color: 'slate' }];
const pageFromHash = (): Page => navigation.find(item => `#${item.page}` === window.location.hash)?.page ?? 'home';

export default function Workspace() {
  const work = useWorkspace();
  const { data } = work;
  const focus = usePomodoro(data.settings, work.ready && !work.error, work.recordFocus, work.setNotice);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [viewTab, setViewTab] = useState<ViewTab>('calendar');
  const [filters, setFilters] = useState(defaultFilters);
  const [calendarAnchor, setCalendarAnchor] = useState(new Date());
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month');
  const [selectedDay, setSelectedDay] = useState(dateKey(new Date()));
  const [treeAnchor, setTreeAnchor] = useState(new Date());
  const [showCompletedTree, setShowCompletedTree] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  useEffect(() => {
    const change = () => { setPage(pageFromHash()); window.scrollTo({ top: 0, behavior: 'instant' }); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => { document.documentElement.dataset.theme = data.settings.theme === 'system' ? media.matches ? 'dark' : 'light' : data.settings.theme; };
    update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, [data.settings.theme]);
  const navigate = (next: Page) => { setPage(next); window.location.hash = next; window.scrollTo({ top: 0, behavior: 'instant' }); };
  const expandView = (tab: ViewTab) => { setViewTab(tab); navigate('views'); };
  const editTask = (task?: Task) => { setEditingTask(task ?? null); setTaskDraft(task ? { title: task.title, notes: task.notes, urgency: task.urgency, tags: [...task.tags], startAt: localDateTime(task.startAt), dueAt: localDateTime(task.dueAt), progress: task.progress } : blankTask()); };
  const editEvent = (event?: ScheduleEvent, day?: string) => { setEditingEvent(event ?? null); setEventDraft(event ? { title: event.title, notes: event.notes, startAt: localDateTime(event.startAt), endAt: localDateTime(event.endAt) } : blankEvent(day)); };
  const focusTask = (task: Task) => { if (focus.selectTask(task.id)) { focus.selectPhase('focus'); navigate('focus'); } };
  const pending = data.tasks.filter(task => !task.completedAt);
  const today = dateKey(new Date());
  const taskPanel = (detailed = false) => <TaskPanel tasks={data.tasks} filters={filters} setFilters={setFilters} create={() => editTask()} edit={editTask} focus={focusTask} toggle={work.toggleTask} detailed={detailed} expand={() => expandView('tasks')}/>;
  const calendarPanel = (detailed = false) => <CalendarPanel data={data} anchor={calendarAnchor} setAnchor={setCalendarAnchor} mode={calendarMode} setMode={setCalendarMode} selectedDay={selectedDay} setSelectedDay={setSelectedDay} editTask={editTask} editEvent={editEvent} createEvent={day => editEvent(undefined, day)} detailed={detailed} expand={() => expandView('calendar')}/>;
  const treePanel = (detailed = false) => <TimeTree data={data} anchor={treeAnchor} setAnchor={setTreeAnchor} editTask={editTask} showCompleted={showCompletedTree} setShowCompleted={setShowCompletedTree} detailed={detailed} expand={() => expandView('tree')}/>;
  return <div className="app-shell"><header className="app-header"><button className="brand" onClick={() => navigate('home')} aria-label="个人工作台主页"><span className="brand-mark"><Icon name="leaf" size={21}/></span><span>个人工作台<span className="brand-subtitle">A little more, every day.</span></span></button><div className="header-right"><span className="header-date">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span><span className={`save-status ${work.error ? 'failed' : ''}`}><i/>{work.error ? '保存异常' : work.saving ? '正在保存' : '本地已保存'}</span><button className="header-avatar" onClick={() => navigate('profile')} aria-label="打开我的设置">{data.settings.nickname.trim().slice(0, 1) || <Icon name="user" size={17}/>}</button></div></header><main className="main-content">{work.error && <div className="error-banner" role="alert"><span>{work.error} 当前修改可能尚未保存。</span><button className="secondary-button" onClick={work.retryStorage}>重试</button><button className="text-button" onClick={work.exportData}>导出当前记录</button></div>}{!work.ready ? <div className="loading">正在打开你的工作空间…</div> : <>
    {page === 'home' && <><section className="page-heading home-heading"><div><span className="eyebrow"><span className="tiny-dot shortterm"/>YOUR PERSONAL SPACE</span><h1>{data.settings.nickname ? `${data.settings.nickname}，` : ''}让今天，从容一点。</h1><p>整理待办，留出专注的时间，记录每一步进展。</p></div><button className="primary-button" onClick={() => editTask()}><Icon name="plus" size={18}/>新建任务</button></section><div className="overview-strip"><span><strong>{pending.length}</strong>待办任务</span><i/><span><strong className="warm-text">{pending.filter(isUrgent).length}</strong>需优先处理</span><i/><span><strong>{pending.filter(task => task.dueAt && dateKey(new Date(task.dueAt)) === today).length}</strong>今日截止</span><span className="overview-note"><Icon name="sun" size={16}/>按自己的节奏，慢慢来</span></div><div className="home-top-grid">{taskPanel()}<FocusPanel focus={focus} data={data} expand={() => navigate('focus')} disabled={!!work.error}/></div>{calendarPanel()}{treePanel()}</>}
    {page === 'views' && <><section className="page-heading"><div><span className="eyebrow">A CLEARER PICTURE</span><h1>给时间一个清晰的轮廓。</h1><p>日历、任务和进度，在同一处同步。</p></div><button className="primary-button" onClick={() => editTask()}><Icon name="plus" size={18}/>新建任务</button></section>{viewTab === 'calendar' ? calendarPanel(true) : viewTab === 'tree' ? treePanel(true) : taskPanel(true)}<div className="page-options"><div className="segmented" aria-label="详细视图选项">{([{ key: 'calendar', label: '日历', icon: 'calendar' }, { key: 'tree', label: '时间树', icon: 'tree' }, { key: 'tasks', label: '任务列表', icon: 'check' }] as const).map(item => <button key={item.key} className={viewTab === item.key ? 'selected' : ''} onClick={() => setViewTab(item.key)}><Icon name={item.icon} size={16}/>{item.label}</button>)}</div></div></>}
    {page === 'focus' && <><section className="page-heading"><div><span className="eyebrow">ONE THING AT A TIME</span><h1>此刻，只做一件事。</h1><p>专注和休息交替，让努力有自己的节奏。</p></div><button className="text-button" onClick={() => navigate('profile')}><Icon name="settings" size={17}/>调整专注设置</button></section><div className="focus-page-grid"><FocusPanel focus={focus} data={data} detailed disabled={!!work.error}/><FocusHistory data={data}/></div></>}
    {page === 'agent' && <section className="agent-page"><span className="agent-orbit"><Icon name="agent" size={48}/><i/><i/></span><span className="coming-label">COMING LATER</span><h1>你的工作伙伴，正在路上。</h1><p>Agent 功能将在后续版本加入。<br/>先把每一天安排好，让进展自然发生。</p><span className="agent-chip"><Icon name="leaf" size={15}/>敬请期待</span></section>}
    {page === 'profile' && <><section className="page-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h1>我的空间，我的节奏。</h1><p>调整设置，管理账号与本地记录。</p></div></section><Profile work={work}/></>}
  </>}</main><nav className="dock" aria-label="底部主导航">{navigation.map(item => <button key={item.page} className={`dock-item ${page === item.page ? 'active' : ''}`} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined}><span className={`dock-icon ${item.color}`}><Icon name={item.icon} size={24}/>{item.page === 'focus' && focus.timer.running && <i className="dock-running"/>}</span><span>{item.label}</span><i className="dock-indicator"/></button>)}</nav>{work.notice && <div className="toast" role="status">{work.notice}</div>}{taskDraft && <TaskEditor draft={taskDraft} setDraft={setTaskDraft} task={editingTask} work={work} close={() => setTaskDraft(null)}/>} {eventDraft && <EventEditor draft={eventDraft} setDraft={setEventDraft} event={editingEvent} work={work} close={() => setEventDraft(null)}/>}</div>;
}
