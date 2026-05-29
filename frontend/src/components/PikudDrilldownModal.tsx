"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, Pause, RotateCcw, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { BACKEND_DIRECT } from "@/lib/api";

interface Props {
    onClose: () => void;
    pikudDbRange: { earliest: number | null; latest: number | null };
    setPikudTimeOffset: React.Dispatch<React.SetStateAction<number | null>>;
    pikudTimeOffset: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtAge(ts: number): string {
    const sec = Math.floor((Date.now() / 1000) - ts);
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    return h ? `${d}d ${h}h` : `${d}d`;
}

function fmtTs(ts: number): string {
    return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function fmtDisplay(ts: number): string {
    const d = new Date(ts * 1000);
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

// UTC midnight of the day containing ts
function dayStart(ts: number): number {
    const d = new Date(ts * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
}

// ── Calendar Picker ───────────────────────────────────────────────────────────

interface CalendarPickerProps {
    value: number;           // current Unix ts
    onChange: (ts: number) => void;
    minTs: number;           // earliest allowed ts (fades days before)
    maxTs: number;           // latest allowed ts (fades days after)
    label: string;
}

function CalendarPicker({ value, onChange, minTs, maxTs, label }: CalendarPickerProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Calendar view month (UTC)
    const [viewYear, setViewYear] = useState(() => new Date(value * 1000).getUTCFullYear());
    const [viewMonth, setViewMonth] = useState(() => new Date(value * 1000).getUTCMonth());

    // Time fields (UTC)
    const [hour, setHour] = useState(() => new Date(value * 1000).getUTCHours());
    const [minute, setMinute] = useState(() => new Date(value * 1000).getUTCMinutes());

    // Sync time fields when value changes externally
    useEffect(() => {
        const d = new Date(value * 1000);
        setHour(d.getUTCHours());
        setMinute(d.getUTCMinutes());
        setViewYear(d.getUTCFullYear());
        setViewMonth(d.getUTCMonth());
    }, [value]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Build calendar grid for viewYear/viewMonth
    const firstDow = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay(); // 0=Sun
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const minDay = dayStart(minTs);
    const maxDay = dayStart(maxTs);
    const selectedDay = dayStart(value);

    const selectDay = (dayTs: number) => {
        const ts = dayTs + hour * 3600 + minute * 60;
        onChange(Math.max(minTs, Math.min(maxTs, ts)));
    };

    const applyTime = (h: number, m: number) => {
        const base = dayStart(value);
        const ts = base + h * 3600 + m * 60;
        onChange(Math.max(minTs, Math.min(maxTs, ts)));
    };

    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const DAYS = ['SU','MO','TU','WE','TH','FR','SA'];

    const prevMonth = () => {
        if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
        else setViewMonth(m => m - 1);
    };
    const nextMonth = () => {
        if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
        else setViewMonth(m => m + 1);
    };

    return (
        <div className="flex flex-col gap-1 flex-1 relative" ref={ref}>
            <span className="text-[8px] font-mono text-[var(--text-muted)] tracking-widest">{label}</span>
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] hover:border-red-700/60 rounded px-2 py-1.5 text-[10px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-red-700 transition-colors text-left"
            >
                <Calendar size={10} className="text-red-400/60 flex-shrink-0" />
                <span>{fmtDisplay(value)}</span>
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        className="absolute top-full left-0 mt-1 z-[10100] w-[220px] bg-[var(--bg-secondary)] border border-red-900/40 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.6)] overflow-hidden"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.1 }}
                    >
                        {/* Month nav */}
                        <div className="flex items-center justify-between px-3 py-2 border-b border-red-900/20">
                            <button onClick={prevMonth} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-0.5">
                                <ChevronLeft size={12} />
                            </button>
                            <span className="text-[10px] font-mono text-[var(--text-primary)] tracking-widest">
                                {MONTHS[viewMonth]} {viewYear}
                            </span>
                            <button onClick={nextMonth} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-0.5">
                                <ChevronRight size={12} />
                            </button>
                        </div>

                        {/* Day-of-week headers */}
                        <div className="grid grid-cols-7 px-2 pt-2">
                            {DAYS.map(d => (
                                <div key={d} className="text-center text-[7px] font-mono text-[var(--text-muted)] pb-1">{d}</div>
                            ))}
                        </div>

                        {/* Day grid */}
                        <div className="grid grid-cols-7 px-2 pb-2">
                            {/* Leading empty cells */}
                            {Array.from({ length: firstDow }).map((_, i) => (
                                <div key={`e${i}`} />
                            ))}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const dayTs = Date.UTC(viewYear, viewMonth, i + 1) / 1000;
                                const isSelected = dayTs === selectedDay;
                                const outOfRange = dayTs < minDay || dayTs > maxDay;
                                return (
                                    <button
                                        key={i}
                                        disabled={outOfRange}
                                        onClick={() => { selectDay(dayTs); setOpen(false); }}
                                        className={[
                                            'text-[9px] font-mono rounded py-0.5 transition-colors',
                                            isSelected
                                                ? 'bg-red-600 text-white'
                                                : outOfRange
                                                    ? 'text-[var(--text-muted)] opacity-25 cursor-not-allowed'
                                                    : 'text-[var(--text-secondary)] hover:bg-red-950/40 hover:text-red-400 cursor-pointer',
                                        ].join(' ')}
                                    >
                                        {i + 1}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Time picker */}
                        <div className="flex items-center gap-1 px-3 py-2 border-t border-red-900/20">
                            <span className="text-[8px] font-mono text-[var(--text-muted)] mr-1">TIME (UTC)</span>
                            <input
                                type="number"
                                min={0} max={23}
                                value={String(hour).padStart(2, '0')}
                                onChange={e => {
                                    const h = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                                    setHour(h);
                                    applyTime(h, minute);
                                }}
                                className="w-9 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded px-1 py-0.5 text-[10px] font-mono text-[var(--text-primary)] text-center focus:outline-none focus:border-red-700"
                            />
                            <span className="text-[var(--text-muted)] font-mono text-[10px]">:</span>
                            <input
                                type="number"
                                min={0} max={59}
                                value={String(minute).padStart(2, '0')}
                                onChange={e => {
                                    const m = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                                    setMinute(m);
                                    applyTime(hour, m);
                                }}
                                className="w-9 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded px-1 py-0.5 text-[10px] font-mono text-[var(--text-primary)] text-center focus:outline-none focus:border-red-700"
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function PikudDrilldownModal({ onClose, pikudDbRange, setPikudTimeOffset, pikudTimeOffset }: Props) {
    const earliest = pikudDbRange.earliest;
    const latest = pikudDbRange.latest ?? Math.floor(Date.now() / 1000);
    const nowSec = Math.floor(Date.now() / 1000);

    const [rangeStart, setRangeStart] = useState<number>(earliest ?? latest - 86400);
    const [rangeEnd, setRangeEnd] = useState<number>(latest);
    const [incidentCount, setIncidentCount] = useState<number | null>(null);
    const [countLoading, setCountLoading] = useState(false);

    const [scrubTs, setScrubTs] = useState<number>(latest);
    const [playing, setPlaying] = useState(false);
    const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Fetch incident count (debounced)
    const countTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (countTimerRef.current) clearTimeout(countTimerRef.current);
        countTimerRef.current = setTimeout(() => {
            setCountLoading(true);
            fetch(`${BACKEND_DIRECT}/api/pikud-alerts/history?from_ts=${rangeStart}&until_ts=${rangeEnd}`)
                .then(r => r.json())
                .then(d => setIncidentCount(d.alerts?.length ?? 0))
                .catch(() => setIncidentCount(null))
                .finally(() => setCountLoading(false));
        }, 400);
        return () => { if (countTimerRef.current) clearTimeout(countTimerRef.current); };
    }, [rangeStart, rangeEnd]);

    // Clamp scrubTs when range changes
    useEffect(() => {
        setScrubTs(ts => Math.max(rangeStart, Math.min(rangeEnd, ts)));
    }, [rangeStart, rangeEnd]);

    // Sync scrubber → map offset
    useEffect(() => {
        const offsetMins = Math.round((scrubTs - nowSec) / 60);
        setPikudTimeOffset(offsetMins === 0 ? null : offsetMins);
    }, [scrubTs, setPikudTimeOffset, nowSec]);

    // Playback
    const stopPlay = useCallback(() => {
        if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
        setPlaying(false);
    }, []);

    useEffect(() => {
        if (!playing) { stopPlay(); return; }
        playRef.current = setInterval(() => {
            setScrubTs(ts => {
                const next = ts + 5 * 60;
                if (next >= rangeEnd) { stopPlay(); return rangeEnd; }
                return next;
            });
        }, 500);
        return stopPlay;
    }, [playing, rangeEnd, stopPlay]);

    const span = rangeEnd - rangeStart || 1;
    const sliderVal = Math.round(((scrubTs - rangeStart) / span) * 1000);

    const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPlaying(false);
        const frac = parseInt(e.target.value) / 1000;
        setScrubTs(Math.round(rangeStart + frac * span));
    };

    const handleReset = () => {
        setPlaying(false);
        setRangeStart(earliest ?? latest - 86400);
        setRangeEnd(latest);
        setScrubTs(latest);
        setPikudTimeOffset(null);
    };

    const scrubAge = nowSec - scrubTs;
    const scrubLabel = scrubAge < 60
        ? 'LIVE'
        : scrubAge < 3600
            ? `${Math.floor(scrubAge / 60)}m ago`
            : scrubAge < 86400
                ? `${Math.floor(scrubAge / 3600)}h ${Math.floor((scrubAge % 3600) / 60)}m ago`
                : (() => {
                    const d = Math.floor(scrubAge / 86400);
                    const h = Math.floor((scrubAge % 86400) / 3600);
                    return h ? `${d}d ${h}h ago` : `${d}d ago`;
                })();

    return (
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 z-[9000] flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            >
                <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

                <motion.div
                    className="relative w-[520px] bg-[var(--bg-secondary)] border border-red-900/40 rounded-xl shadow-[0_0_40px_rgba(255,0,0,0.1)] overflow-visible"
                    initial={{ scale: 0.95, opacity: 0, y: 10 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 10 }}
                    transition={{ duration: 0.15 }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-red-900/30 bg-red-950/20 rounded-t-xl">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-[11px] font-mono tracking-[0.25em] text-red-400">PIKUD HAОREF — ARCHIVE DRILL-DOWN</span>
                        </div>
                        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                            <X size={14} />
                        </button>
                    </div>

                    <div className="px-5 py-4 flex flex-col gap-4">

                        {/* Archive stats */}
                        <div className="flex items-center gap-4 text-[10px] font-mono">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[var(--text-muted)] tracking-widest">OLDEST RECORD</span>
                                <span className="text-red-400">
                                    {earliest ? `${fmtAge(earliest)} ago — ${fmtTs(earliest)}` : '—'}
                                </span>
                            </div>
                            <div className="w-px h-8 bg-[var(--border-primary)]" />
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[var(--text-muted)] tracking-widest">INCIDENTS IN WINDOW</span>
                                <span className={`text-red-400 ${countLoading ? 'opacity-50' : ''}`}>
                                    {countLoading ? 'COUNTING...' : incidentCount !== null ? incidentCount.toLocaleString() : '—'}
                                </span>
                            </div>
                        </div>

                        {/* Calendar pickers */}
                        <div className="flex flex-col gap-2">
                            <span className="text-[9px] font-mono tracking-widest text-[var(--text-muted)]">PLAYBACK WINDOW</span>
                            <div className="flex items-start gap-3">
                                <CalendarPicker
                                    label="FROM"
                                    value={rangeStart}
                                    onChange={ts => setRangeStart(Math.min(ts, rangeEnd - 60))}
                                    minTs={earliest ?? 0}
                                    maxTs={rangeEnd - 60}
                                />
                                <CalendarPicker
                                    label="TO"
                                    value={rangeEnd}
                                    onChange={ts => setRangeEnd(Math.max(ts, rangeStart + 60))}
                                    minTs={rangeStart + 60}
                                    maxTs={nowSec}
                                />
                            </div>
                        </div>

                        {/* Timeline scrubber */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-mono tracking-widest text-[var(--text-muted)]">TIMELINE</span>
                                <span className="text-[10px] font-mono text-red-400">{scrubLabel}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setPlaying(p => !p)}
                                    className="w-7 h-7 flex items-center justify-center rounded border border-red-500/40 text-red-400 hover:bg-red-950/40 transition-colors flex-shrink-0"
                                >
                                    {playing ? <Pause size={12} /> : <Play size={12} />}
                                </button>
                                <input
                                    type="range"
                                    min={0}
                                    max={1000}
                                    step={1}
                                    value={sliderVal}
                                    onChange={handleSlider}
                                    className="flex-1 h-1 accent-red-500 cursor-pointer"
                                />
                            </div>
                            <div className="flex justify-between text-[8px] font-mono text-[var(--text-muted)]">
                                <span>{fmtTs(rangeStart)}</span>
                                <span>{fmtTs(rangeEnd)}</span>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between pt-1 border-t border-[var(--border-primary)]">
                            <button
                                onClick={handleReset}
                                className="flex items-center gap-1.5 text-[9px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            >
                                <RotateCcw size={10} /> RESET TO FULL ARCHIVE
                            </button>
                            <button
                                onClick={() => { setPikudTimeOffset(null); onClose(); }}
                                className="text-[9px] font-mono text-red-400 hover:text-red-300 transition-colors"
                            >
                                RETURN TO LIVE
                            </button>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
