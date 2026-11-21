import React, { useRef, useState } from 'react';
import {
  Camera,
  Flame,
  Plus,
  SlidersHorizontal,
  Sun,
  Trash2,
  ZoomIn,
} from 'lucide-react';
import {
  DirectorTimelineProject,
  formatSmpteTimecode,
  WORLD_EVENT_META,
} from '../../engine/director';

export type SelectedTimelineItem =
  | { track: 'camera'; id: string }
  | { track: 'env'; id: string }
  | { track: 'event'; id: string }
  | { track: 'postfx'; id: string }
  | null;

interface TimelineTrackPanelProps {
  project: DirectorTimelineProject;
  playheadSec: number;
  selectedItem: SelectedTimelineItem;
  disabled?: boolean;
  onScrubTime: (timeSec: number) => void;
  onSetInOut: (inTimeSec: number, outTimeSec: number) => void;
  onSelectItem: (item: SelectedTimelineItem) => void;
  onMoveItemTime: (track: 'camera' | 'env' | 'event' | 'postfx', id: string, timeSec: number) => void;
  onAddCameraKeyframeAtPlayhead: () => void;
  onAddEnvKeyframeAtPlayhead: () => void;
  onAddEventAtPlayhead: () => void;
  onAddPostFxKeyframeAtPlayhead: () => void;
  onDeleteSelectedItem: () => void;
}

type DragTarget =
  | { kind: 'playhead' }
  | { kind: 'inHandle' }
  | { kind: 'outHandle' }
  | { kind: 'item'; track: 'camera' | 'env' | 'event' | 'postfx'; id: string };

export const TimelineTrackPanel: React.FC<TimelineTrackPanelProps> = ({
  project,
  playheadSec,
  selectedItem,
  disabled,
  onScrubTime,
  onSetInOut,
  onSelectItem,
  onMoveItemTime,
  onAddCameraKeyframeAtPlayhead,
  onAddEnvKeyframeAtPlayhead,
  onAddEventAtPlayhead,
  onAddPostFxKeyframeAtPlayhead,
  onDeleteSelectedItem,
}) => {
  const [pxPerSec, setPxPerSec] = useState(96);
  const laneScrollRef = useRef<HTMLDivElement | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);

  const dur = Math.max(0.5, project.durationSec);
  const timelineWidthPx = Math.max(640, Math.round(dur * pxPerSec + 48));
  const minGap = 1 / Math.max(1, project.fps);

  const clientXToTime = (clientX: number): number => {
    const el = laneScrollRef.current;
    if (!el) return playheadSec;
    const rect = el.getBoundingClientRect();
    const xInside = clientX - rect.left + el.scrollLeft - 14;
    return Math.max(0, Math.min(dur, xInside / pxPerSec));
  };

  const handleLanePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragTarget || disabled) return;
    const t = Number(clientXToTime(e.clientX).toFixed(3));
    if (dragTarget.kind === 'playhead') {
      onScrubTime(t);
    } else if (dragTarget.kind === 'inHandle') {
      onSetInOut(Math.min(t, project.outTimeSec - minGap), project.outTimeSec);
    } else if (dragTarget.kind === 'outHandle') {
      onSetInOut(project.inTimeSec, Math.max(t, project.inTimeSec + minGap));
    } else if (dragTarget.kind === 'item') {
      onMoveItemTime(dragTarget.track, dragTarget.id, t);
    }
  };

  const handleLanePointerUp = () => {
    setDragTarget(null);
  };

  const timeToLeftPx = (t: number) => 14 + Math.max(0, Math.min(dur, t)) * pxPerSec;

  const tickStepSec = pxPerSec >= 140 ? 0.5 : pxPerSec >= 75 ? 1 : 2;
  const ticks: number[] = [];
  for (let t = 0; t <= dur + 1e-6; t += tickStepSec) {
    ticks.push(Number(t.toFixed(2)));
  }

  const playheadLeft = timeToLeftPx(playheadSec);
  const inLeft = timeToLeftPx(project.inTimeSec);
  const outLeft = timeToLeftPx(project.outTimeSec);

  return (
    <section
      data-testid="director-timeline-panel"
      className="h-[228px] shrink-0 border-t border-slate-800 bg-[#070a12] flex flex-col overflow-hidden"
    >
      {/* Timeline Sub-toolbar */}
      <div className="h-8 px-3 border-b border-slate-800/90 bg-[#0b101d] flex items-center justify-between gap-3 shrink-0 text-[11px]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-semibold text-slate-200 whitespace-nowrap">
            多轨道非线性时间轴 (NLE)
          </span>
          <span className="font-mono-tabular text-cyan-300 whitespace-nowrap">
            {formatSmpteTimecode(playheadSec, project.fps)} · {playheadSec.toFixed(2)}s / {dur.toFixed(1)}s
          </span>
          <span className="hidden md:inline font-mono-tabular text-[10px] text-slate-400 whitespace-nowrap">
            工作区间 I {project.inTimeSec.toFixed(2)}s — O {project.outTimeSec.toFixed(2)}s
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {selectedItem && (
            <button
              type="button"
              tabIndex={-1}
              data-testid="timeline-delete-selected-btn"
              disabled={disabled}
              onClick={onDeleteSelectedItem}
              className="h-6 px-2 rounded-xs border border-rose-500/40 bg-rose-950/40 hover:bg-rose-900/50 text-rose-200 text-[10px] flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" />
              <span>删除选中节点</span>
            </button>
          )}
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <ZoomIn className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="range"
              min={32}
              max={240}
              step={4}
              value={pxPerSec}
              onChange={(e) => setPxPerSec(Number(e.target.value))}
              className="studio-slider w-20"
              aria-label="时间轴缩放"
            />
          </div>
        </div>
      </div>

      {/* Main Split: Fixed Track Headers Left + Synchronized Scrollable Lanes Right */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Track Headers Column */}
        <div className="w-48 shrink-0 border-r border-slate-800 bg-[#090d17] flex flex-col">
          {/* Ruler Header Spacer */}
          <div className="h-7 px-2.5 border-b border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
            <span>轨道 / 节点操作</span>
            <span className="font-mono-tabular">{project.fps} FPS</span>
          </div>

          {/* Track 1 Header: Camera & Lens */}
          <div className="flex-1 px-2.5 border-b border-slate-800/70 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Camera className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="text-[11px] text-slate-200 truncate">机位与光学</span>
              <span className="text-[10px] font-mono-tabular text-slate-500">
                {project.cameraTrack.length}
              </span>
            </div>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              data-testid="track-add-camera-kf-btn"
              onClick={onAddCameraKeyframeAtPlayhead}
              title="在播放头位置捕获当前摄像机关键帧 [K]"
              className="h-5 px-1.5 rounded-xs border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-200 text-[10px] flex items-center gap-0.5 cursor-pointer whitespace-nowrap disabled:opacity-40"
            >
              <Plus className="w-3 h-3" />
              <span>机位</span>
            </button>
          </div>

          {/* Track 2 Header: Sun & Atmosphere */}
          <div className="flex-1 px-2.5 border-b border-slate-800/70 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-[11px] text-slate-200 truncate">日照与气象</span>
              <span className="text-[10px] font-mono-tabular text-slate-500">
                {project.envTrack.length}
              </span>
            </div>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              data-testid="track-add-env-kf-btn"
              onClick={onAddEnvKeyframeAtPlayhead}
              title="在播放头位置插入日照/大气/云量关键帧"
              className="h-5 px-1.5 rounded-xs border border-amber-500/40 bg-amber-950/40 hover:bg-amber-900/60 text-amber-200 text-[10px] flex items-center gap-0.5 cursor-pointer whitespace-nowrap disabled:opacity-40"
            >
              <Plus className="w-3 h-3" />
              <span>气候</span>
            </button>
          </div>

          {/* Track 3 Header: Planetary Disasters & Events */}
          <div className="flex-1 px-2.5 border-b border-slate-800/70 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Flame className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="text-[11px] text-slate-200 truncate">灾害与工程</span>
              <span className="text-[10px] font-mono-tabular text-slate-500">
                {project.eventTrack.length}
              </span>
            </div>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              data-testid="track-add-event-btn"
              onClick={onAddEventAtPlayhead}
              title="在播放头位置添加星球定时灾害/工程事件"
              className="h-5 px-1.5 rounded-xs border border-rose-500/40 bg-rose-950/40 hover:bg-rose-900/60 text-rose-200 text-[10px] flex items-center gap-0.5 cursor-pointer whitespace-nowrap disabled:opacity-40"
            >
              <Plus className="w-3 h-3" />
              <span>事件</span>
            </button>
          </div>

          {/* Track 4 Header: Post-FX & LUT */}
          <div className="flex-1 px-2.5 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-[11px] text-slate-200 truncate">调色与后期</span>
              <span className="text-[10px] font-mono-tabular text-slate-500">
                {project.postFxTrack.length}
              </span>
            </div>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              data-testid="track-add-postfx-kf-btn"
              onClick={onAddPostFxKeyframeAtPlayhead}
              title="在播放头位置添加 LUT 调色/光晕/颗粒关键帧"
              className="h-5 px-1.5 rounded-xs border border-emerald-500/40 bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-200 text-[10px] flex items-center gap-0.5 cursor-pointer whitespace-nowrap disabled:opacity-40"
            >
              <Plus className="w-3 h-3" />
              <span>调色</span>
            </button>
          </div>
        </div>

        {/* Scrollable Time Lanes */}
        <div
          ref={laneScrollRef}
          onPointerMove={handleLanePointerMove}
          onPointerUp={handleLanePointerUp}
          onPointerCancel={handleLanePointerUp}
          className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden relative bg-[#05070d]"
        >
          <div
            className="h-full flex flex-col relative select-none"
            style={{ width: `${timelineWidthPx}px` }}
          >
            {/* Active Work Area Band (In..Out) */}
            <div
              className="pointer-events-none absolute top-7 bottom-0 bg-sky-500/[0.04] border-x border-sky-500/20"
              style={{
                left: `${inLeft}px`,
                width: `${Math.max(2, outLeft - inLeft)}px`,
              }}
            />

            {/* Ruler Track */}
            <div
              data-testid="timeline-ruler"
              className="h-7 border-b border-slate-800/90 bg-[#090d18] relative cursor-ew-resize shrink-0"
              onPointerDown={(e) => {
                if (disabled) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragTarget({ kind: 'playhead' });
                onScrubTime(Number(clientXToTime(e.clientX).toFixed(3)));
              }}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 flex flex-col justify-between pointer-events-none"
                  style={{ left: `${timeToLeftPx(t)}px` }}
                >
                  <span className="text-[9px] font-mono-tabular text-slate-400 pl-1 leading-none pt-1">
                    {t.toFixed(t % 1 === 0 ? 0 : 1)}s
                  </span>
                  <div className="w-px h-2 bg-slate-600/80" />
                </div>
              ))}

              {/* In Handle */}
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                title={`入点 In: ${project.inTimeSec.toFixed(2)}s (拖动调整)`}
                onPointerDown={(e) => {
                  if (disabled) return;
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setDragTarget({ kind: 'inHandle' });
                }}
                style={{ left: `${inLeft - 4}px` }}
                className="absolute top-0 bottom-0 w-2 bg-emerald-500/75 hover:bg-emerald-400 cursor-ew-resize z-10"
              />

              {/* Out Handle */}
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                title={`出点 Out: ${project.outTimeSec.toFixed(2)}s (拖动调整)`}
                onPointerDown={(e) => {
                  if (disabled) return;
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setDragTarget({ kind: 'outHandle' });
                }}
                style={{ left: `${outLeft - 4}px` }}
                className="absolute top-0 bottom-0 w-2 bg-amber-500/75 hover:bg-amber-400 cursor-ew-resize z-10"
              />
            </div>

            {/* Lane 1: Camera Keyframes */}
            <div className="flex-1 border-b border-slate-800/70 relative">
              {project.cameraTrack.length >= 2 && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-1 bg-cyan-500/25 rounded-xs pointer-events-none"
                  style={{
                    left: `${timeToLeftPx(Math.min(...project.cameraTrack.map((k) => k.timeSec)))}px`,
                    width: `${Math.max(
                      4,
                      (Math.max(...project.cameraTrack.map((k) => k.timeSec)) -
                        Math.min(...project.cameraTrack.map((k) => k.timeSec))) *
                        pxPerSec,
                    )}px`,
                  }}
                />
              )}
              {project.cameraTrack.map((kf) => {
                const isSel = selectedItem?.track === 'camera' && selectedItem.id === kf.id;
                return (
                  <button
                    key={kf.id}
                    type="button"
                    tabIndex={-1}
                    title={`${kf.label} (${kf.timeSec.toFixed(2)}s · FOV ${Math.round(kf.fovDeg)}°)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectItem({ track: 'camera', id: kf.id });
                      onScrubTime(kf.timeSec);
                    }}
                    onPointerDown={(e) => {
                      if (disabled) return;
                      e.stopPropagation();
                      onSelectItem({ track: 'camera', id: kf.id });
                      setDragTarget({ kind: 'item', track: 'camera', id: kf.id });
                    }}
                    style={{ left: `${timeToLeftPx(kf.timeSec)}px` }}
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rotate-45 border cursor-grab active:cursor-grabbing transition-transform ${
                      isSel
                        ? 'bg-cyan-300 border-white scale-115 shadow-[0_0_8px_rgba(34,211,238,0.85)]'
                        : 'bg-cyan-500/85 border-slate-950 hover:bg-cyan-300'
                    }`}
                  />
                );
              })}
            </div>

            {/* Lane 2: Environment / Sun Keyframes */}
            <div className="flex-1 border-b border-slate-800/70 relative">
              {project.envTrack.map((kf) => {
                const isSel = selectedItem?.track === 'env' && selectedItem.id === kf.id;
                return (
                  <button
                    key={kf.id}
                    type="button"
                    tabIndex={-1}
                    title={`日照/大气 (${kf.timeSec.toFixed(2)}s · 仰角 ${Math.round(kf.sunElevationDeg)}° · 方位 ${Math.round(kf.sunAzimuthDeg)}°)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectItem({ track: 'env', id: kf.id });
                      onScrubTime(kf.timeSec);
                    }}
                    onPointerDown={(e) => {
                      if (disabled) return;
                      e.stopPropagation();
                      onSelectItem({ track: 'env', id: kf.id });
                      setDragTarget({ kind: 'item', track: 'env', id: kf.id });
                    }}
                    style={{ left: `${timeToLeftPx(kf.timeSec)}px` }}
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rotate-45 border cursor-grab active:cursor-grabbing ${
                      isSel
                        ? 'bg-amber-300 border-white scale-115 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                        : 'bg-amber-500/85 border-slate-950 hover:bg-amber-300'
                    }`}
                  />
                );
              })}
            </div>

            {/* Lane 3: Planetary Disasters & Engineering Events */}
            <div className="flex-1 border-b border-slate-800/70 relative">
              {project.eventTrack.map((ev) => {
                const meta = WORLD_EVENT_META.find((m) => m.type === ev.type);
                const isSel = selectedItem?.track === 'event' && selectedItem.id === ev.id;
                const leftPx = timeToLeftPx(ev.triggerTimeSec);
                const widthPx = Math.max(46, Math.round(ev.durationSec * pxPerSec));
                return (
                  <button
                    key={ev.id}
                    type="button"
                    tabIndex={-1}
                    title={`${ev.label} @ ${ev.triggerTimeSec.toFixed(2)}s (${ev.latDeg.toFixed(1)}°, ${ev.lonDeg.toFixed(1)}°)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectItem({ track: 'event', id: ev.id });
                      onScrubTime(ev.triggerTimeSec);
                    }}
                    onPointerDown={(e) => {
                      if (disabled) return;
                      e.stopPropagation();
                      onSelectItem({ track: 'event', id: ev.id });
                      setDragTarget({ kind: 'item', track: 'event', id: ev.id });
                    }}
                    style={{
                      left: `${leftPx}px`,
                      width: `${widthPx}px`,
                      borderColor: isSel ? '#ffffff' : meta?.colorHex ?? '#f43f5e',
                    }}
                    className={`absolute top-1 bottom-1 px-1.5 rounded-xs border text-[10px] text-left truncate cursor-grab active:cursor-grabbing flex items-center gap-1 ${
                      ev.enabled
                        ? 'bg-rose-950/75 text-white'
                        : 'bg-slate-900/60 text-slate-500 opacity-60'
                    }`}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: meta?.colorHex ?? '#f43f5e' }}
                    />
                    <span className="truncate">{ev.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Lane 4: Post-FX & LUT Keyframes */}
            <div className="flex-1 relative">
              {project.postFxTrack.map((kf) => {
                const isSel = selectedItem?.track === 'postfx' && selectedItem.id === kf.id;
                return (
                  <button
                    key={kf.id}
                    type="button"
                    tabIndex={-1}
                    title={`调色 (${kf.timeSec.toFixed(2)}s · ${kf.lutPreset})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectItem({ track: 'postfx', id: kf.id });
                      onScrubTime(kf.timeSec);
                    }}
                    onPointerDown={(e) => {
                      if (disabled) return;
                      e.stopPropagation();
                      onSelectItem({ track: 'postfx', id: kf.id });
                      setDragTarget({ kind: 'item', track: 'postfx', id: kf.id });
                    }}
                    style={{ left: `${timeToLeftPx(kf.timeSec)}px` }}
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-5 px-1.5 rounded-xs border text-[9px] font-mono-tabular whitespace-nowrap cursor-grab active:cursor-grabbing flex items-center ${
                      isSel
                        ? 'bg-emerald-500 text-slate-950 border-white font-semibold'
                        : 'bg-emerald-950/80 text-emerald-200 border-emerald-500/60 hover:border-emerald-300'
                    }`}
                  >
                    {kf.lutPreset.replace('_', ' ')}
                  </button>
                );
              })}
            </div>

            {/* Vertical Red Playhead Line across all lanes */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-rose-500 z-20"
              style={{ left: `${playheadLeft}px` }}
            >
              <div className="w-2.5 h-3 -ml-[5px] bg-rose-500 rounded-t-[1px]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
