"use client";

import React, { useState, useMemo, useCallback } from "react";
import type { OpenMeteoWeather } from "@/types/dashboard";
import { wmoCodeToDescription, windDirectionLabel } from "@/utils/weather";

interface WeatherModalProps {
  weather: OpenMeteoWeather;
  lat: number;
  lng: number;
  locationName?: string;
  onClose: () => void;
}

// ─── SVG Chart helpers ──────────────────────────────────────────────────────

const CHART_W = 1200;
const CHART_H = 120;
const CHART_PAD = { top: 18, right: 8, bottom: 20, left: 42 };

function TimeSeriesLine({
  values,
  times,
  color,
  label,
  unit,
  nowIdx,
  selectedIdx,
  fillOpacity = 0.15,
  yMin: forcedMin,
  yMax: forcedMax,
}: {
  values: number[];
  times: string[];
  color: string;
  label: string;
  unit: string;
  nowIdx: number;
  selectedIdx: number;
  fillOpacity?: number;
  yMin?: number;
  yMax?: number;
}) {
  const n = values.length;
  if (!n) return null;
  const filtered = values.filter(v => v != null && !isNaN(v));
  const yMin = forcedMin ?? Math.min(...filtered);
  const yMax = forcedMax ?? Math.max(...filtered);
  const yRange = yMax - yMin || 1;
  const xW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const yH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const xScale = (i: number) => CHART_PAD.left + (i / (n - 1)) * xW;
  const yScale = (v: number) => CHART_PAD.top + yH - ((v - yMin) / yRange) * yH;

  const pts = values.map((v, i) => `${xScale(i).toFixed(1)},${yScale(v ?? yMin).toFixed(1)}`).join(' ');
  const fillPts = `${xScale(0).toFixed(1)},${(CHART_PAD.top + yH).toFixed(1)} ${pts} ${xScale(n - 1).toFixed(1)},${(CHART_PAD.top + yH).toFixed(1)}`;

  const nowX = xScale(nowIdx);
  const selX = xScale(selectedIdx);
  const selVal = values[selectedIdx];

  // Y-axis ticks (3-4 ticks)
  const ticks = [yMin, yMin + yRange * 0.33, yMin + yRange * 0.67, yMax];

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" style={{ height: 100 }} preserveAspectRatio="none">
      {/* Grid lines */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={CHART_PAD.left} x2={CHART_W - CHART_PAD.right} y1={yScale(t)} y2={yScale(t)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          <text x={CHART_PAD.left - 4} y={yScale(t) + 3} fill="rgba(255,255,255,0.3)" fontSize={9} fontFamily="monospace" textAnchor="end">{t.toFixed(t % 1 ? 1 : 0)}</text>
        </g>
      ))}
      {/* Fill */}
      <polygon points={fillPts} fill={color} opacity={fillOpacity} />
      {/* Line */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      {/* Now line */}
      <line x1={nowX} x2={nowX} y1={CHART_PAD.top} y2={CHART_PAD.top + yH} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4 3" />
      {/* Selected cursor */}
      <line x1={selX} x2={selX} y1={CHART_PAD.top - 2} y2={CHART_PAD.top + yH + 2} stroke={color} strokeWidth={1.5} opacity={0.9} />
      {selVal != null && !isNaN(selVal) && (
        <text x={selX + 4} y={CHART_PAD.top + 10} fill={color} fontSize={10} fontFamily="monospace" fontWeight="bold">{selVal.toFixed(1)}{unit}</text>
      )}
      {/* Label */}
      <text x={CHART_PAD.left + 4} y={CHART_PAD.top - 5} fill={color} fontSize={9} fontFamily="monospace" fontWeight="bold" opacity={0.7}>{label}</text>
    </svg>
  );
}

function PrecipBars({
  rain,
  snow,
  times,
  nowIdx,
  selectedIdx,
}: {
  rain: number[];
  snow: number[];
  times: string[];
  nowIdx: number;
  selectedIdx: number;
}) {
  const n = rain.length;
  if (!n) return null;
  const maxVal = Math.max(0.1, ...rain, ...snow);
  const xW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const yH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const barW = Math.max(1, xW / n - 0.5);
  const xScale = (i: number) => CHART_PAD.left + (i / (n - 1)) * xW;
  const hScale = (v: number) => (v / maxVal) * yH;
  const baseline = CHART_PAD.top + yH;
  const nowX = xScale(nowIdx);
  const selX = xScale(selectedIdx);

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" style={{ height: 80 }} preserveAspectRatio="none">
      {rain.map((v, i) => v > 0 ? (
        <rect key={`r${i}`} x={xScale(i) - barW / 2} y={baseline - hScale(v)} width={barW} height={hScale(v)} fill="#3b82f6" opacity={0.7} rx={0.5} />
      ) : null)}
      {snow.map((v, i) => v > 0 ? (
        <rect key={`s${i}`} x={xScale(i) - barW / 2} y={baseline - hScale(v + (rain[i] || 0))} width={barW} height={hScale(v)} fill="#e2e8f0" opacity={0.8} rx={0.5} />
      ) : null)}
      <line x1={nowX} x2={nowX} y1={CHART_PAD.top} y2={baseline} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4 3" />
      <line x1={selX} x2={selX} y1={CHART_PAD.top - 2} y2={baseline + 2} stroke="#60a5fa" strokeWidth={1.5} opacity={0.9} />
      <text x={CHART_PAD.left + 4} y={CHART_PAD.top - 5} fill="#60a5fa" fontSize={9} fontFamily="monospace" fontWeight="bold" opacity={0.7}>PRECIPITATION (mm)</text>
      {/* Selected value */}
      {selectedIdx >= 0 && selectedIdx < n && (
        <text x={selX + 4} y={CHART_PAD.top + 10} fill="#60a5fa" fontSize={10} fontFamily="monospace" fontWeight="bold">
          {(rain[selectedIdx] + (snow[selectedIdx] || 0)).toFixed(1)}mm
        </text>
      )}
    </svg>
  );
}

// ─── Wind direction arrows ──────────────────────────────────────────────────

function WindChart({
  speed,
  direction,
  gusts,
  times,
  nowIdx,
  selectedIdx,
}: {
  speed: number[];
  direction: number[];
  gusts: number[];
  times: string[];
  nowIdx: number;
  selectedIdx: number;
}) {
  const n = speed.length;
  if (!n) return null;
  const maxSpd = Math.max(1, ...speed, ...gusts);
  const xW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const yH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const xScale = (i: number) => CHART_PAD.left + (i / (n - 1)) * xW;
  const yScale = (v: number) => CHART_PAD.top + yH - (v / maxSpd) * yH;

  const spdPts = speed.map((v, i) => `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');
  const gustPts = gusts.map((v, i) => `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');
  const nowX = xScale(nowIdx);
  const selX = xScale(selectedIdx);

  // Direction arrows every 6 hours
  const arrows: { x: number; y: number; dir: number }[] = [];
  for (let i = 0; i < n; i += 6) {
    arrows.push({ x: xScale(i), y: yScale(speed[i]) - 8, dir: direction[i] });
  }

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" style={{ height: 100 }} preserveAspectRatio="none">
      {/* Gusts (lighter) */}
      <polyline points={gustPts} fill="none" stroke="rgba(251,191,36,0.3)" strokeWidth={1} strokeDasharray="3 2" />
      {/* Speed */}
      <polyline points={spdPts} fill="none" stroke="#fbbf24" strokeWidth={1.5} strokeLinejoin="round" />
      {/* Direction arrows */}
      {arrows.map((a, i) => (
        <g key={i} transform={`translate(${a.x},${a.y}) rotate(${a.dir})`}>
          <line x1={0} y1={-4} x2={0} y2={4} stroke="#fbbf24" strokeWidth={1} opacity={0.6} />
          <polygon points="0,-4 -2,0 2,0" fill="#fbbf24" opacity={0.6} />
        </g>
      ))}
      <line x1={nowX} x2={nowX} y1={CHART_PAD.top} y2={CHART_PAD.top + yH} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4 3" />
      <line x1={selX} x2={selX} y1={CHART_PAD.top - 2} y2={CHART_PAD.top + yH + 2} stroke="#fbbf24" strokeWidth={1.5} opacity={0.9} />
      <text x={CHART_PAD.left + 4} y={CHART_PAD.top - 5} fill="#fbbf24" fontSize={9} fontFamily="monospace" fontWeight="bold" opacity={0.7}>WIND (km/h)</text>
      {selectedIdx >= 0 && selectedIdx < n && (
        <text x={selX + 4} y={CHART_PAD.top + 10} fill="#fbbf24" fontSize={10} fontFamily="monospace" fontWeight="bold">
          {speed[selectedIdx]?.toFixed(0)} ({windDirectionLabel(direction[selectedIdx])}) G{gusts[selectedIdx]?.toFixed(0)}
        </text>
      )}
    </svg>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function WeatherModal({ weather, lat, lng, locationName, onClose }: WeatherModalProps) {
  const { current, hourly, daily, timezone } = weather;
  const n = hourly.time.length;

  // Find the index closest to "now"
  const nowIdx = useMemo(() => {
    const now = Date.now();
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(new Date(hourly.time[i]).getTime() - now);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  }, [hourly.time, n]);

  const [selectedIdx, setSelectedIdx] = useState(nowIdx);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedIdx(parseInt(e.target.value));
  }, []);

  const selTime = hourly.time[selectedIdx] || '';
  const selDate = selTime ? new Date(selTime) : null;
  const isHistory = selectedIdx < nowIdx;
  const wx = wmoCodeToDescription(hourly.weather_code[selectedIdx] ?? 0);

  // Current conditions
  const curWx = wmoCodeToDescription(current.weather_code);

  // Daily summary cards
  const dailyCards = useMemo(() => {
    return daily.time.map((d, i) => ({
      date: d,
      dayLabel: new Date(d + 'T12:00').toLocaleDateString('en', { weekday: 'short' }),
      high: daily.temperature_2m_max[i],
      low: daily.temperature_2m_min[i],
      precip: daily.precipitation_sum[i],
      wind: daily.wind_speed_10m_max[i],
      wx: wmoCodeToDescription(daily.weather_code[i] ?? 0),
      sunrise: daily.sunrise[i]?.slice(11, 16),
      sunset: daily.sunset[i]?.slice(11, 16),
    }));
  }, [daily]);

  const btnStyle: React.CSSProperties = {
    background: 'rgba(0,0,0,0.5)',
    border: '1px solid rgba(34,197,94,0.4)',
    borderRadius: 6,
    color: '#4ade80',
    fontSize: 10,
    fontFamily: 'monospace',
    padding: '4px 12px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
  };

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 20px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'ArrowLeft') setSelectedIdx(i => Math.max(0, i - 1));
        if (e.key === 'ArrowRight') setSelectedIdx(i => Math.min(n - 1, i + 1));
      }}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div style={{
        background: 'rgba(0,0,0,0.95)', border: '1px solid rgba(34,197,94,0.5)',
        borderRadius: 12, overflow: 'hidden', width: '100%', maxWidth: 900,
        maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column',
        boxShadow: '0 0 60px rgba(34,197,94,0.2)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: 'rgba(20,83,45,0.4)',
          borderBottom: '1px solid rgba(34,197,94,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 11, color: '#4ade80', fontFamily: 'monospace', letterSpacing: '0.2em', fontWeight: 'bold' }}>
              LOCAL WEATHER
            </span>
            {locationName && (
              <span style={{ fontSize: 10, color: 'rgba(134,239,172,0.6)', fontFamily: 'monospace', marginLeft: 8 }}>
                {locationName}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 10, color: 'rgba(134,239,172,0.6)', fontFamily: 'monospace' }}>
              {lat.toFixed(4)}, {lng.toFixed(4)}
            </span>
            <span style={{ fontSize: 9, color: 'rgba(134,239,172,0.4)', fontFamily: 'monospace' }}>
              TZ: {timezone}
            </span>
            <button onClick={onClose} style={{ ...btnStyle, background: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.4)', color: '#ef4444' }}>
              ✕ CLOSE
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 12px 0' }}>

          {/* Current conditions banner */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16,
            padding: '14px 20px', borderBottom: '1px solid rgba(34,197,94,0.15)',
            background: 'rgba(20,83,45,0.15)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <span style={{ fontSize: 36 }}>{curWx.icon}</span>
              <span style={{ fontSize: 9, color: '#86efac', fontFamily: 'monospace', textAlign: 'center' }}>{curWx.label}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px 16px', fontFamily: 'monospace' }}>
              <StatCell label="TEMP" value={`${current.temperature_2m.toFixed(1)}°C`} color="#4ade80" large />
              <StatCell label="FEELS LIKE" value={`${current.apparent_temperature.toFixed(1)}°C`} color="#86efac" />
              <StatCell label="WIND" value={`${current.wind_speed_10m.toFixed(0)} km/h ${windDirectionLabel(current.wind_direction_10m)}`} color="#fbbf24" />
              <StatCell label="GUSTS" value={`${current.wind_gusts_10m.toFixed(0)} km/h`} color="#fbbf24" />
              <StatCell label="HUMIDITY" value={`${current.relative_humidity_2m}%`} color="#60a5fa" />
              <StatCell label="PRESSURE" value={`${current.pressure_msl.toFixed(0)} hPa`} color="#c084fc" />
              <StatCell label="CLOUD" value={`${current.cloud_cover}%`} color="#94a3b8" />
              <StatCell label="UV INDEX" value={`${current.uv_index.toFixed(1)}`} color={current.uv_index >= 6 ? '#ef4444' : current.uv_index >= 3 ? '#fbbf24' : '#4ade80'} />
            </div>
          </div>

          {/* Timeline scrubber */}
          <div style={{ padding: '8px 20px', borderBottom: '1px solid rgba(34,197,94,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setSelectedIdx(Math.max(0, selectedIdx - 1))} style={btnStyle}>◀</button>
              <input
                type="range" min={0} max={n - 1} step={1} value={selectedIdx}
                onChange={handleScrub}
                style={{ flex: 1, height: 4, accentColor: '#4ade80', cursor: 'pointer' }}
              />
              <button onClick={() => setSelectedIdx(Math.min(n - 1, selectedIdx + 1))} style={btnStyle}>▶</button>
              <button onClick={() => setSelectedIdx(nowIdx)} style={{ ...btnStyle, fontWeight: 'bold' }}>NOW</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: 'monospace', fontSize: 10 }}>
              <span style={{ color: isHistory ? '#f59e0b' : '#4ade80' }}>
                {wx.icon} {wx.label}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>
                {selDate?.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })} {selDate?.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
              <span style={{ color: isHistory ? '#f59e0b' : '#22d3ee', fontSize: 9 }}>
                {isHistory ? 'HISTORICAL' : selectedIdx === nowIdx ? 'NOW' : 'FORECAST'}
              </span>
            </div>
          </div>

          {/* Charts */}
          <div style={{ padding: '4px 12px' }}>
            <TimeSeriesLine
              values={hourly.temperature_2m} times={hourly.time}
              color="#4ade80" label="TEMPERATURE (°C)" unit="°C"
              nowIdx={nowIdx} selectedIdx={selectedIdx}
            />
            <TimeSeriesLine
              values={hourly.apparent_temperature} times={hourly.time}
              color="#86efac" label="FEELS LIKE (°C)" unit="°C"
              nowIdx={nowIdx} selectedIdx={selectedIdx} fillOpacity={0.05}
            />
            <PrecipBars
              rain={hourly.precipitation} snow={hourly.snowfall}
              times={hourly.time} nowIdx={nowIdx} selectedIdx={selectedIdx}
            />
            <WindChart
              speed={hourly.wind_speed_10m} direction={hourly.wind_direction_10m}
              gusts={hourly.wind_gusts_10m} times={hourly.time}
              nowIdx={nowIdx} selectedIdx={selectedIdx}
            />
            <TimeSeriesLine
              values={hourly.cloud_cover} times={hourly.time}
              color="#94a3b8" label="CLOUD COVER (%)" unit="%"
              nowIdx={nowIdx} selectedIdx={selectedIdx} yMin={0} yMax={100}
            />
            <TimeSeriesLine
              values={hourly.pressure_msl} times={hourly.time}
              color="#c084fc" label="PRESSURE (hPa)" unit=""
              nowIdx={nowIdx} selectedIdx={selectedIdx}
            />
            <TimeSeriesLine
              values={hourly.relative_humidity_2m} times={hourly.time}
              color="#60a5fa" label="HUMIDITY (%)" unit="%"
              nowIdx={nowIdx} selectedIdx={selectedIdx} yMin={0} yMax={100}
            />
          </div>

          {/* Daily summary */}
          <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(34,197,94,0.15)' }}>
            <div style={{ fontSize: 9, color: '#4ade80', fontFamily: 'monospace', letterSpacing: '0.15em', fontWeight: 'bold', marginBottom: 6 }}>
              DAILY FORECAST
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {dailyCards.map((d, i) => {
                const isToday = d.date === new Date().toISOString().slice(0, 10);
                return (
                  <div key={i} style={{
                    flex: '0 0 auto', minWidth: 85, padding: '6px 8px',
                    background: isToday ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isToday ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 6, fontFamily: 'monospace', fontSize: 9,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}>
                    <span style={{ color: isToday ? '#4ade80' : 'rgba(255,255,255,0.5)', fontWeight: 'bold' }}>
                      {isToday ? 'TODAY' : d.dayLabel.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 18 }}>{d.wx.icon}</span>
                    <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{d.high?.toFixed(0)}°</span>
                    <span style={{ color: '#60a5fa' }}>{d.low?.toFixed(0)}°</span>
                    {d.precip > 0 && <span style={{ color: '#3b82f6' }}>{d.precip.toFixed(1)}mm</span>}
                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 8 }}>{d.sunrise}-{d.sunset}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, color, large }: { label: string; value: string; color: string; large?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: large ? 16 : 11, color, fontWeight: 'bold' }}>{value}</span>
    </div>
  );
}
