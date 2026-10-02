import { useEffect, useRef, useState } from 'react';
import { newId, nowIso } from './data';
import type { Settings, TimeSession } from './data';

export type FocusPhase = 'focus' | 'short' | 'long';
export const phaseLabels = { focus: '专注', short: '短休息', long: '长休息' };
const TIMER_KEY = 'personal-workspace-pomodoro-v1';
export interface TimerState {
  phase: FocusPhase;
  taskId: string | null;
  remaining: number;
  total: number;
  deadline: number | null;
  running: boolean;
  sessionId: string | null;
  startedAt: string | null;
  round: number;
}
export const phaseSeconds = (phase: FocusPhase, settings: Settings) => (phase === 'focus' ? settings.focusMinutes : phase === 'short' ? settings.shortBreakMinutes : settings.longBreakMinutes) * 60;
export const remainingSeconds = (timer: TimerState, now = Date.now()) => timer.running && timer.deadline !== null ? Math.max(0, Math.ceil((timer.deadline - now) / 1000)) : timer.remaining;
const freshTimer = (settings: Settings): TimerState => ({ phase: 'focus', taskId: null, remaining: settings.focusMinutes * 60, total: settings.focusMinutes * 60, deadline: null, running: false, sessionId: null, startedAt: null, round: 0 });
export function restoreTimer(value: unknown, settings: Settings): TimerState {
  const t = value as TimerState | null;
  if (!t || !['focus', 'short', 'long'].includes(t.phase) || typeof t.running !== 'boolean' || !Number.isFinite(t.remaining) || t.remaining < 0 || !Number.isFinite(t.total) || t.total < 1 || t.total > 10800 || t.remaining > t.total || !Number.isInteger(t.round) || t.round < 0 || (t.taskId !== null && typeof t.taskId !== 'string') || (t.deadline !== null && !Number.isFinite(t.deadline)) || (t.running && (t.deadline === null || !t.sessionId || !t.startedAt)) || (t.startedAt !== null && !Number.isFinite(Date.parse(t.startedAt))) || (t.sessionId !== null && typeof t.sessionId !== 'string')) return freshTimer(settings);
  return t;
}

export function usePomodoro(settings: Settings, ready: boolean, record: (session: TimeSession) => void, notify: (message: string) => void) {
  const [timer, setTimer] = useState<TimerState>(() => {
    try { return restoreTimer(JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null'), settings); }
    catch { return freshTimer(settings); }
  });
  const [now, setNow] = useState(Date.now());
  const handled = useRef(new Set<string>());
  const sound = useRef<AudioContext | null>(null);
  const callbacks = useRef({ record, notify });
  callbacks.current = { record, notify };
  const remaining = remainingSeconds(timer, now);
  const elapsed = timer.total - remaining;
  const busy = timer.running || timer.sessionId !== null;

  useEffect(() => {
    try { localStorage.setItem(TIMER_KEY, JSON.stringify(timer)); }
    catch { callbacks.current.notify('无法保存番茄钟状态，刷新后计时可能无法恢复。'); }
  }, [timer]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    const sync = () => setNow(Date.now());
    document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', sync); };
  }, []);
  useEffect(() => {
    if (!ready || timer.sessionId || timer.running) return;
    const seconds = phaseSeconds(timer.phase, settings);
    setTimer(previous => previous.total === seconds ? previous : { ...previous, total: seconds, remaining: seconds });
  }, [ready, settings, timer.phase, timer.sessionId, timer.running]);

  const saveSession = (completed: boolean, endAt: string, seconds: number) => {
    if (timer.phase !== 'focus' || !timer.sessionId || !timer.startedAt || seconds < 1 || handled.current.has(timer.sessionId)) return;
    handled.current.add(timer.sessionId);
    callbacks.current.record({ id: timer.sessionId, taskId: timer.taskId, startAt: timer.startedAt, endAt, source: 'pomodoro', focusedSeconds: seconds, completed });
  };
  useEffect(() => {
    if (!ready || !timer.running || remaining > 0 || !timer.sessionId) return;
    saveSession(true, new Date(timer.deadline ?? Date.now()).toISOString(), timer.total);
    const round = timer.round + (timer.phase === 'focus' ? 1 : 0);
    const phase: FocusPhase = timer.phase === 'focus' ? round % settings.longBreakEvery === 0 ? 'long' : 'short' : 'focus';
    const seconds = phaseSeconds(phase, settings);
    // Start an automatic break at the moment the completed timer is observed.
    const auto = timer.phase === 'focus' && settings.autoBreak;
    setTimer({ ...timer, phase, remaining: seconds, total: seconds, round, running: auto, deadline: auto ? Date.now() + seconds * 1000 : null, sessionId: auto ? newId() : null, startedAt: auto ? nowIso() : null });
    callbacks.current.notify(timer.phase === 'focus' ? '本轮专注已完成，休息一下吧。' : '休息结束，可以开始下一轮专注。');
    if (settings.sound && sound.current) {
      try {
        const context = sound.current;
        const oscillator = context.createOscillator(); const gain = context.createGain();
        oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 660;
        gain.gain.setValueAtTime(0.12, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.7);
        oscillator.start(); oscillator.stop(context.currentTime + 0.7);
      } catch { /* A suspended browser audio context does not interrupt the timer. */ }
    }
  });

  const toggle = () => {
    if (!ready) return;
    const at = Date.now(); setNow(at);
    if (timer.running) { setTimer({ ...timer, running: false, remaining: remainingSeconds(timer, at), deadline: null }); return; }
    if (settings.sound) {
      try { sound.current ??= new AudioContext(); void sound.current.resume().catch(() => undefined); } catch { /* Audio is optional. */ }
    }
    setTimer({ ...timer, running: true, deadline: at + timer.remaining * 1000, sessionId: timer.sessionId ?? newId(), startedAt: timer.startedAt ?? new Date(at).toISOString() });
  };
  const reset = () => {
    const seconds = timer.total - remainingSeconds(timer);
    if (busy && seconds > 0 && !confirm(timer.phase === 'focus' ? '结束本轮专注？已投入的时间会保留。' : '结束当前休息？')) return;
    saveSession(false, nowIso(), seconds);
    const total = phaseSeconds(timer.phase, settings);
    setTimer({ ...timer, remaining: total, total, running: false, deadline: null, sessionId: null, startedAt: null });
  };
  const selectPhase = (phase: FocusPhase) => {
    if (busy) return;
    const seconds = phaseSeconds(phase, settings);
    setTimer(previous => ({ ...previous, phase, remaining: seconds, total: seconds }));
  };
  const selectTask = (taskId: string | null) => {
    if (busy) { callbacks.current.notify('请先结束当前计时，再切换专注任务。'); return false; }
    setTimer(previous => ({ ...previous, taskId })); return true;
  };
  return { timer, remaining, elapsed, busy, toggle, reset, selectPhase, selectTask };
}
export type PomodoroController = ReturnType<typeof usePomodoro>;
