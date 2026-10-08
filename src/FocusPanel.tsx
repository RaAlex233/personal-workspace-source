import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Settings, WorkspaceData } from './data';
import Icon from './Icon';
import { dateKey, sessionSeconds, weeklyFocusSummary } from './useWorkspace';
import { phaseLabels } from './usePomodoro';
import type { FocusPhase, PomodoroController } from './usePomodoro';
import { Empty, PanelTitle, displayDateTime, displayMinutes } from './ui';
import { focusBreakdown } from './focusStats';
import type { FocusRange } from './focusStats';
import { useLocalDay } from './localDay';

export function FocusPanel({ focus, data, saveSettings, expand, detailed = false, disabled = false }: { focus: PomodoroController; data: WorkspaceData; saveSettings: (settings: Settings) => boolean; expand?: () => void; detailed?: boolean; disabled?: boolean }) {
  const today = dateKey(new Date());
  const sessions = data.sessions.filter(session => session.source === 'pomodoro' && dateKey(new Date(session.startAt)) === today);
  const count = sessions.filter(session => session.completed).length;
  const seconds = sessions.reduce((sum, session) => sum + sessionSeconds(session), 0);
  const task = data.tasks.find(item => item.id === focus.timer.taskId);
  const available = data.tasks.filter(item => !item.completedAt || item.id === focus.timer.taskId);
  const minutes = String(Math.floor(focus.remaining / 60)).padStart(2, '0'); const remainingSeconds = String(focus.remaining % 60).padStart(2, '0');
  return <section className={`panel focus-panel ${detailed ? 'detailed' : ''} ${focus.timer.phase !== 'focus' ? 'break-mode' : ''}`}><PanelTitle title="留一段时间，专注当下" subtitle={detailed ? '一次只做一件事，慢慢靠近目标' : '你的番茄钟'} action={!detailed && <button className="icon-button" onClick={expand} aria-label="打开专注详情"><Icon name="arrow" size={17}/></button>}/><div className="focus-body"><div className="timer-ring" style={{ '--timer-progress': `${(1 - focus.remaining / focus.timer.total) * 360}deg` } as CSSProperties}><div className="timer-ring-inner"><span className="timer-phase"><span className={`status-dot ${focus.timer.running ? 'running' : ''}`}/>{focus.timer.running ? `${phaseLabels[focus.timer.phase]}中` : focus.busy ? '已暂停' : phaseLabels[focus.timer.phase] === '专注' ? '准备专注' : phaseLabels[focus.timer.phase]}</span><strong className="timer-digits" aria-label={`剩余 ${minutes} 分 ${remainingSeconds} 秒`}>{minutes}<span>:</span>{remainingSeconds}</strong><small>{focus.timer.phase === 'focus' ? '让注意力回到此刻' : '放松眼睛，活动一下'}</small></div></div><label className="focus-task-select"><Icon name="check" size={15}/><select aria-label="关联专注任务" value={task?.id ?? ''} disabled={disabled || !focus.available || focus.settling || focus.busy} onChange={event => focus.selectTask(event.target.value || null)}><option value="">自由专注 · 不关联任务</option>{available.map(item => <option value={item.id} key={item.id}>{item.title}{item.completedAt ? '（已完成）' : ''}</option>)}</select></label><FocusDuration data={data} focus={focus} disabled={disabled} saveSettings={saveSettings}/><div className="focus-controls"><button className="primary-button" onClick={focus.toggle} disabled={disabled || !focus.available || focus.settling}><Icon name={focus.timer.running ? 'pause' : 'play'} size={17}/>{focus.settling ? '正在保存' : focus.timer.running ? '暂停' : focus.busy ? '继续专注' : focus.timer.phase === 'focus' ? '开始专注' : '开始休息'}</button><button className="reset-button" disabled={disabled || !focus.available || focus.settling} onClick={focus.reset} aria-label="重置番茄钟" title="结束并重置本轮计时"><Icon name="reset" size={18}/></button></div><div className="focus-today"><span><strong>{count}</strong> 今日番茄</span><i/><span><strong>{Math.floor(seconds / 60)}</strong> 专注分钟</span></div></div><footer className="panel-options focus-options"><div className="segmented" aria-label="番茄钟模式">{(['focus', 'short', 'long'] as FocusPhase[]).map(phase => <button disabled={disabled || !focus.available || focus.settling || focus.busy} key={phase} className={focus.timer.phase === phase ? 'selected' : ''} onClick={() => focus.selectPhase(phase)}>{phaseLabels[phase]}</button>)}</div></footer></section>;
}

export function FocusHistory({ data }: { data: WorkspaceData }) {
  return <div className="focus-history"><FocusPie data={data}/><FocusRecords data={data}/></div>;
}

function FocusRecords({ data }: { data: WorkspaceData }) {
  const sessions = data.sessions.filter(session => session.source === 'pomodoro').sort((a, b) => b.startAt.localeCompare(a.startAt));
  const { total, completed, days, dayValues } = weeklyFocusSummary(sessions);
  const maximum = Math.max(60, ...dayValues);
  return <><section className="panel"><PanelTitle title="专注积累" subtitle="过去 7 天 · 按专注开始日期统计"/><div className="focus-summary"><div><strong>{completed}</strong><span>完成番茄</span></div><div><strong>{displayMinutes(total)}</strong><span>累计专注</span></div></div><div className="week-chart" role="img" aria-label={days.map((day, index) => `${day.toLocaleDateString('zh-CN')} ${displayMinutes(dayValues[index])}`).join('，')}>{days.map((day, index) => <div className="week-column" key={dateKey(day)}><small>{Math.floor(dayValues[index] / 60)}分</small><div className="week-bar-track"><span style={{ height: `${Math.max(3, dayValues[index] / maximum * 100)}%` }} className={index === 6 ? 'today' : ''}/></div><label>{index === 6 ? '今天' : ['日', '一', '二', '三', '四', '五', '六'][day.getDay()]}</label></div>)}</div></section><section className="panel"><PanelTitle title="专注记录" subtitle="每一小段时间，都算数"/>{sessions.length ? <div className="session-list">{sessions.slice(0, 30).map(session => <article className="session-row" key={session.id}><span className="session-icon"><Icon name="focus" size={17}/></span><div><strong>{data.tasks.find(task => task.id === session.taskId)?.title ?? '自由专注'}</strong><small>{displayDateTime(session.startAt)} · {session.completed ? '本轮完成' : '提前结束'}</small></div><span>{displayMinutes(sessionSeconds(session))}</span></article>)}</div> : <Empty title="你的第一颗番茄，正在等待" detail="完成或结束一次专注后，记录会出现在这里。"/>}</section></>;
}

function FocusDuration({ data, focus, disabled, saveSettings }: { data: WorkspaceData; focus: PomodoroController; disabled: boolean; saveSettings: (settings: Settings) => boolean }) {
  const [minutes, setMinutes] = useState(String(data.settings.focusMinutes));
  useEffect(() => { setMinutes(String(data.settings.focusMinutes)); }, [data.settings.focusMinutes]);
  return <form className="focus-duration" onSubmit={event => { event.preventDefault(); saveSettings({ ...data.settings, focusMinutes: Number(minutes) }); }}>
    <div><label htmlFor="focus-minutes">专注时长</label><div className="duration-field"><input id="focus-minutes" aria-label="自定义专注时长（分钟）" type="number" required min={1} max={180} step={1} value={minutes} disabled={disabled || !focus.available || focus.settling} onChange={event => setMinutes(event.target.value)}/><span>分钟</span><button className="subtle-button" type="submit" disabled={disabled || !focus.available || focus.settling || Number(minutes) === data.settings.focusMinutes}>应用</button></div></div>
    <small>{focus.busy ? `本轮保持 ${Math.round(focus.timer.total / 60)} 分钟，修改后下轮生效` : '1–180 分钟 · 按自己的节奏安排'}</small>
  </form>;
}

const pieColors = ['#005fb8', '#0f8b76', '#8056b5', '#d17b24', '#be4562', '#718096'];
function FocusPie({ data }: { data: WorkspaceData }) {
  const [range, setRange] = useState<FocusRange>('week');
  const today = useLocalDay();
  const { total, slices } = focusBreakdown(data.sessions, data.tasks, range, new Date(`${today}T12:00:00`));
  let position = 0;
  const gradient = slices.map((item, index) => { const start = position; position += item.percent; return `${pieColors[index]} ${start}% ${position}%`; }).join(', ');
  return <section className="panel focus-pie-panel"><PanelTitle title="时间花在哪里" subtitle="按任务统计实际专注时间 · 不含休息"/>
    <div className="pie-range segmented" aria-label="专注统计范围">{([{ key: 'today', label: '今天' }, { key: 'week', label: '过去 7 天' }, { key: 'all', label: '全部' }] as const).map(item => <button key={item.key} aria-pressed={range === item.key} className={range === item.key ? 'selected' : ''} onClick={() => setRange(item.key)}>{item.label}</button>)}</div>
    {total > 0 ? <div className="focus-pie-content"><div className="pie-figure"><div className="focus-pie" style={{ background: `conic-gradient(${gradient})` }} role="img" aria-label={slices.map(item => `${item.title}：${displayMinutes(item.seconds)}，占 ${item.percent.toFixed(1)}%`).join('；')}/><strong>{displayMinutes(total)}</strong><span>累计专注</span></div><ul className="pie-legend">{slices.map((item, index) => <li key={item.id ?? 'free'}><i style={{ background: pieColors[index] }}/><div><strong>{item.title}</strong><span>{displayMinutes(item.seconds)} · {item.percent.toFixed(1)}%</span></div></li>)}</ul></div> : <Empty title="还没有专注记录" detail="完成或提前结束一轮专注后，饼图会展示各任务的时间占比。"/>}
  </section>;
}
