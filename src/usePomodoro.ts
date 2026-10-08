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

function readTimer(settings: Settings): TimerState {
  try { return restoreTimer(JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null'), settings); }
  catch { return freshTimer(settings); }
}

export function usePomodoro(settings: Settings, ready: boolean, record: (session: TimeSession) => Promise<boolean>, notify: (message: string) => void, writable: boolean, getSavedFocus: (sessionId: string) => TimeSession | null) {
  const [timer, setTimer] = useState<TimerState>(() => readTimer(settings));
  const [now, setNow] = useState(Date.now());
  const [initialized, setInitialized] = useState(false);
  const [settling, setSettling] = useState(false);
  const settlingRef = useRef(false);
  const mounted = useRef(false);
  const owner = useRef(writable);
  owner.current = writable;
  const handled = useRef(new Set<string>());
  const sound = useRef<AudioContext | null>(null);
  const callbacks = useRef({ record, notify, getSavedFocus });
  callbacks.current = { record, notify, getSavedFocus };
  const remaining = remainingSeconds(timer, now);
  const elapsed = timer.total - remaining;
  const busy = timer.running || timer.sessionId !== null;
  const available = ready && writable && initialized;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!writable) { setInitialized(false); return; }
    // A former read-only page must reload the latest owner's timer first.
    setTimer(readTimer(settings));
    setNow(Date.now());
    setInitialized(true);
  }, [writable]);

  useEffect(() => {
    if (!writable || !initialized) return;
    try { localStorage.setItem(TIMER_KEY, JSON.stringify(timer)); }
    catch { callbacks.current.notify('无法保存番茄钟状态，刷新后计时可能无法恢复。'); }
  }, [timer, writable, initialized]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    const sync = () => setNow(Date.now());
    document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', sync); };
  }, []);
  useEffect(() => {
    if (!available || timer.sessionId || timer.running) return;
    const seconds = phaseSeconds(timer.phase, settings);
    setTimer(previous => previous.total === seconds ? previous : { ...previous, total: seconds, remaining: seconds });
  }, [available, settings, timer.phase, timer.sessionId, timer.running]);

  const saveSession = async (completed: boolean, endAt: string, seconds: number): Promise<boolean> => {
    if (timer.phase !== 'focus' || seconds < 1) return true;
    if (!timer.sessionId || !timer.startedAt) return false;
    if (handled.current.has(timer.sessionId) || callbacks.current.getSavedFocus(timer.sessionId)) return true;
    try {
      const saved = await callbacks.current.record({ id: timer.sessionId, taskId: timer.taskId, startAt: timer.startedAt, endAt, source: 'pomodoro', focusedSeconds: seconds, completed });
      if (saved) handled.current.add(timer.sessionId);
      return saved;
    } catch {
      callbacks.current.notify('专注记录保存失败，计时已保留，请恢复本地存储后重试。');
      return false;
    }
  };
  const settle = async (completed: boolean, endAt: string, seconds: number, next: TimerState) => {
    if (!available || settlingRef.current) return false;
    settlingRef.current = true;
    setSettling(true);
    try {
      if (!await saveSession(completed, endAt, seconds)) return false;
      if (!mounted.current || !owner.current) return false;
      // Give an automatic break its full duration after the record commits.
      setTimer(next.running ? { ...next, deadline: Date.now() + next.total * 1000, startedAt: nowIso() } : next);
      return true;
    } finally {
      settlingRef.current = false;
      if (mounted.current) setSettling(false);
    }
  };
  useEffect(() => {
    if (!available || !timer.sessionId || settlingRef.current) return;
    const savedFocus = timer.phase === 'focus' ? callbacks.current.getSavedFocus(timer.sessionId) : null;
    if (savedFocus && !savedFocus.completed) {
      // Recover a reset whose DB commit succeeded before the page closed.
      const total = phaseSeconds(timer.phase, settings);
      setTimer({ ...timer, total, remaining: total, running: false, deadline: null, sessionId: null, startedAt: null });
      return;
    }
    if (!savedFocus && (!timer.running || remaining > 0)) return;
    const round = timer.round + (timer.phase === 'focus' ? 1 : 0);
    const phase: FocusPhase = timer.phase === 'focus' ? round % settings.longBreakEvery === 0 ? 'long' : 'short' : 'focus';
    const seconds = phaseSeconds(phase, settings);
    // The next phase starts only after the focus record is durably saved.
    const auto = timer.phase === 'focus' && settings.autoBreak;
    void settle(true, new Date(timer.deadline ?? Date.now()).toISOString(), timer.total, { ...timer, phase, remaining: seconds, total: seconds, round, running: auto, deadline: auto ? Date.now() + seconds * 1000 : null, sessionId: auto ? newId() : null, startedAt: auto ? nowIso() : null }).then(saved => {
      if (!saved) return;
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
  });

  const toggle = () => {
    if (!available || settlingRef.current) return;
    const at = Date.now(); setNow(at);
    if (timer.running) { setTimer({ ...timer, running: false, remaining: remainingSeconds(timer, at), deadline: null }); return; }
    if (settings.sound) {
      try { sound.current ??= new AudioContext(); void sound.current.resume().catch(() => undefined); } catch { /* Audio is optional. */ }
    }
    setTimer({ ...timer, running: true, deadline: at + timer.remaining * 1000, sessionId: timer.sessionId ?? newId(), startedAt: timer.startedAt ?? new Date(at).toISOString() });
  };
  const reset = async () => {
    if (!available || settlingRef.current) return;
    const seconds = timer.total - remainingSeconds(timer);
    if (busy && seconds > 0 && !confirm(timer.phase === 'focus' ? '结束本轮专注？已投入的时间会保留。' : '结束当前休息？')) return;
    const total = phaseSeconds(timer.phase, settings);
    await settle(false, nowIso(), seconds, { ...timer, remaining: total, total, running: false, deadline: null, sessionId: null, startedAt: null });
  };
  const selectPhase = (phase: FocusPhase) => {
    if (!available || busy || settlingRef.current) return;
    const seconds = phaseSeconds(phase, settings);
    setTimer(previous => ({ ...previous, phase, remaining: seconds, total: seconds }));
  };
  const selectTask = (taskId: string | null) => {
    if (!available || settlingRef.current) return false;
    if (busy) { callbacks.current.notify('请先结束当前计时，再切换专注任务。'); return false; }
    setTimer(previous => ({ ...previous, taskId })); return true;
  };
  return { timer, remaining, elapsed, busy, available, settling, toggle, reset, selectPhase, selectTask };
}
export type PomodoroController = ReturnType<typeof usePomodoro>;
