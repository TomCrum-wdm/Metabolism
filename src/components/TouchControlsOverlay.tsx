import React, { useCallback, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Compass, Hammer, Hand } from 'lucide-react';
import { CameraMode } from '../engine/webgpuScene';

interface TouchControlsOverlayProps {
  cameraMode: CameraMode;
  touchActionMode: 'sculpt' | 'look';
  dockOpen: boolean;
  onChangeTouchActionMode: (mode: 'sculpt' | 'look') => void;
  onJoystickMove: (x: number, y: number) => void;
  onVerticalChange: (up: boolean, down: boolean) => void;
  onJump: () => void;
}

const JOYSTICK_RADIUS = 44;

export const TouchControlsOverlay: React.FC<TouchControlsOverlayProps> = ({
  cameraMode,
  touchActionMode,
  dockOpen,
  onChangeTouchActionMode,
  onJoystickMove,
  onVerticalChange,
  onJump,
}) => {
  const padRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [upHeld, setUpHeld] = useState(false);
  const [downHeld, setDownHeld] = useState(false);

  const updateStickFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const el = padRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > JOYSTICK_RADIUS) {
        const s = JOYSTICK_RADIUS / dist;
        dx *= s;
        dy *= s;
      }
      setKnobOffset({ x: dx, y: dy });
      // Screen +Y is down, so forward movement is -dy / JOYSTICK_RADIUS
      onJoystickMove(dx / JOYSTICK_RADIUS, -dy / JOYSTICK_RADIUS);
    },
    [onJoystickMove],
  );

  const releaseStick = useCallback(() => {
    activePointerId.current = null;
    setKnobOffset({ x: 0, y: 0 });
    onJoystickMove(0, 0);
  }, [onJoystickMove]);

  const bottomOffset = dockOpen ? 'bottom-36 sm:bottom-28' : 'bottom-10';

  return (
    <div
      data-testid="touch-controls-overlay"
      className="fixed inset-0 z-15 pointer-events-none select-none"
    >
      {/* Bottom-Left: Virtual Analog Joystick */}
      <div
        ref={padRef}
        data-testid="touch-joystick"
        onPointerDown={(e) => {
          e.stopPropagation();
          if (activePointerId.current !== null) return;
          activePointerId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateStickFromClient(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (activePointerId.current !== e.pointerId) return;
          e.stopPropagation();
          updateStickFromClient(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (activePointerId.current !== e.pointerId) return;
          e.stopPropagation();
          releaseStick();
        }}
        onPointerCancel={(e) => {
          if (activePointerId.current !== e.pointerId) return;
          releaseStick();
        }}
        style={{
          touchAction: 'none',
          backgroundColor: 'rgba(9, 13, 24, 0.72)',
        }}
        className={`pointer-events-auto fixed left-4 ${bottomOffset} w-28 h-28 rounded-full border border-sky-400/50 flex items-center justify-center transition-all`}
        aria-label="虚拟摇杆移动"
      >
        {/* Crosshair guides */}
        <div className="absolute inset-3 rounded-full border border-slate-700/60 pointer-events-none" />
        <div className="w-px h-full bg-slate-700/40 absolute pointer-events-none" />
        <div className="h-px w-full bg-slate-700/40 absolute pointer-events-none" />
        {/* Thumb knob */}
        <div
          className="w-11 h-11 rounded-full border border-sky-300 bg-sky-500/45 pointer-events-none"
          style={{
            transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
          }}
        />
      </div>

      {/* Bottom-Right: Touch Action Mode & Jump / Altitude Buttons */}
      <div
        className={`pointer-events-auto fixed right-4 ${bottomOffset} flex flex-col items-end gap-2 transition-all`}
        style={{ touchAction: 'none' }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            tabIndex={-1}
            data-testid="touch-action-mode-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.currentTarget.blur();
              onChangeTouchActionMode(
                touchActionMode === 'sculpt' ? 'look' : 'sculpt',
              );
            }}
            className={`min-h-11 px-3 rounded-sm border text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              touchActionMode === 'sculpt'
                ? 'border-orange-400 bg-orange-950/75 text-orange-100'
                : 'border-sky-400 bg-sky-950/75 text-sky-100'
            }`}
          >
            {touchActionMode === 'sculpt' ? (
              <>
                <Hammer className="w-4 h-4 shrink-0" />
                <span>触屏: 雕刻/注水</span>
              </>
            ) : (
              <>
                <Compass className="w-4 h-4 shrink-0" />
                <span>触屏: 旋转视角</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {cameraMode === 'fps' ? (
            <>
              <button
                type="button"
                tabIndex={-1}
                data-testid="touch-descend-btn"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDownHeld(true);
                  onVerticalChange(upHeld, true);
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  setDownHeld(false);
                  onVerticalChange(upHeld, false);
                }}
                onPointerLeave={() => {
                  if (downHeld) {
                    setDownHeld(false);
                    onVerticalChange(upHeld, false);
                  }
                }}
                className={`w-14 h-12 rounded-sm border flex flex-col items-center justify-center text-[10px] font-medium cursor-pointer ${
                  downHeld
                    ? 'border-sky-400 bg-sky-900/70 text-white'
                    : 'border-slate-700 bg-[#090d18]/85 text-slate-200'
                }`}
              >
                <ArrowDown className="w-4 h-4" />
                <span>下降</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-testid="touch-ascend-btn"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setUpHeld(true);
                  onVerticalChange(true, downHeld);
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  setUpHeld(false);
                  onVerticalChange(false, downHeld);
                }}
                onPointerLeave={() => {
                  if (upHeld) {
                    setUpHeld(false);
                    onVerticalChange(false, downHeld);
                  }
                }}
                className={`w-14 h-12 rounded-sm border flex flex-col items-center justify-center text-[10px] font-medium cursor-pointer ${
                  upHeld
                    ? 'border-emerald-400 bg-emerald-900/70 text-white'
                    : 'border-slate-700 bg-[#090d18]/85 text-slate-200'
                }`}
              >
                <ArrowUp className="w-4 h-4" />
                <span>上升</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                tabIndex={-1}
                data-testid="touch-jetpack-btn"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setUpHeld(true);
                  onVerticalChange(true, false);
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  setUpHeld(false);
                  onVerticalChange(false, false);
                }}
                onPointerLeave={() => {
                  if (upHeld) {
                    setUpHeld(false);
                    onVerticalChange(false, false);
                  }
                }}
                className={`w-14 h-12 rounded-sm border flex flex-col items-center justify-center text-[10px] font-medium cursor-pointer ${
                  upHeld
                    ? 'border-amber-400 bg-amber-900/70 text-white'
                    : 'border-slate-700 bg-[#090d18]/85 text-slate-200'
                }`}
              >
                <ArrowUp className="w-4 h-4" />
                <span>喷气</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-testid="touch-jump-btn"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onJump();
                }}
                className="w-14 h-12 rounded-sm border border-sky-500/70 bg-sky-950/80 active:bg-sky-800/80 text-sky-100 flex flex-col items-center justify-center text-[10px] font-semibold cursor-pointer"
              >
                <Hand className="w-4 h-4" />
                <span>跳跃</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
