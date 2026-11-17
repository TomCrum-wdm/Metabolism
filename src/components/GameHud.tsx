import React, { useState } from 'react';
import {
  Box,
  Camera,
  ChevronDown,
  ChevronUp,
  Cloud,
  Crosshair,
  ExternalLink,
  Hand,
  Magnet,
  Map as MapIcon,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Sliders,
  Terminal,
  Thermometer,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  BrushMode,
  MaterialId,
  TerrainOverlayMode,
} from '../engine/voxelPlanet';
import {
  CameraMode,
  SandboxConfig,
  SandboxTelemetry,
} from '../engine/webgpuScene';
import { NumericCadInput } from './NumericCadInput';
import { OfflineIndicator } from './OfflineIndicator';
import { PWAInstallButton } from './PWAInstallButton';

interface GameHudProps {
  telemetry: SandboxTelemetry;
  config: SandboxConfig;
  debugOpen: boolean;
  mapsOpen: boolean;
  atmosPanelOpen: boolean;
  dockOpen: boolean;
  touchEnabled: boolean;
  newTabUrl: string;
  onToggleDock: () => void;
  onToggleTouch: () => void;
  onPrepareNewTab: () => void;
  onUpdateConfig: (partial: Partial<SandboxConfig>) => void;
  onClearWater: () => void;
  onResetPlanet: () => void;
  onOpenSeedModal: () => void;
  onToggleMaps: () => void;
  onToggleAtmosPanel: () => void;
  onToggleDebug: () => void;
  onReselectLanding: () => void;
  onFocusCamera: () => void;
  onPause: () => void;
}

const TOOL_ITEMS: ReadonlyArray<{
  id: BrushMode;
  keyHint: string;
  label: string;
  accent: string;
}> = [
  { id: 'carve', keyHint: '1', label: '雕刻', accent: '#f97316' },
  { id: 'build', keyHint: '2', label: '建造', accent: '#10b981' },
  { id: 'smooth', keyHint: '3', label: '平滑', accent: '#a78bfa' },
  { id: 'flatten', keyHint: '4', label: '整平', accent: '#facc15' },
  { id: 'water', keyHint: '5', label: '注水', accent: '#38bdf8' },
];

const MATERIAL_ITEMS: ReadonlyArray<{
  id: MaterialId;
  label: string;
  swatch: string;
}> = [
  { id: MaterialId.Soil, label: '沃土', swatch: '#4a8f4f' },
  { id: MaterialId.Stone, label: '灰岩', swatch: '#7a828f' },
  { id: MaterialId.Basalt, label: '玄武岩', swatch: '#333845' },
  { id: MaterialId.Sandstone, label: '砂岩', swatch: '#c27d57' },
  { id: MaterialId.Crystal, label: '晶矿', swatch: '#29d1e0' },
  { id: MaterialId.Ice, label: '极冰', swatch: '#d6edfc' },
];

const CAMERA_LABEL: Record<CameraMode, string> = {
  explorer: '探索',
  orbit: '轨道',
  detail: '细节放大',
  fps: 'FPS自由',
  landing: '降落FPS',
  perspective: '透视',
};

const CAMERA_MODES: ReadonlyArray<{
  id: CameraMode;
  label: string;
  desc: string;
}> = [
  { id: 'explorer', label: '探索视角', desc: '地表第三人称角色跟随' },
  { id: 'orbit', label: '轨道视角', desc: '环绕行星全局俯瞰' },
  { id: 'detail', label: '细节摄像机', desc: '射线锁定体素区域安全放大' },
  { id: 'fps', label: '自由 FPS 摄像机', desc: '无约束 6DoF 自由飞行' },
  { id: 'landing', label: '降落摄像机', desc: '先选址着陆，再按地表 FPS 行走' },
  { id: 'perspective', label: '透视摄像机', desc: '可调 FOV / Shift平移视点透视相机' },
];

const NEXT_CAMERA_MODE: Record<CameraMode, CameraMode> = {
  explorer: 'orbit',
  orbit: 'detail',
  detail: 'fps',
  fps: 'landing',
  landing: 'perspective',
  perspective: 'explorer',
};

const OVERLAY_LABEL: Record<TerrainOverlayMode, string> = {
  material: '材质',
  temperature: '温度',
  density: '层析',
  lod: 'LOD',
};

const NEXT_OVERLAY: Record<TerrainOverlayMode, TerrainOverlayMode> = {
  material: 'temperature',
  temperature: 'density',
  density: 'material',
  lod: 'material',
};

function fmtRadius(r: number): string {
  if (r >= 100) return `${r.toFixed(0)}m`;
  if (r >= 10) return `${r.toFixed(1)}m`;
  return `${r.toFixed(2)}m`;
}

export const GameHud: React.FC<GameHudProps> = ({
  telemetry,
  config,
  debugOpen,
  mapsOpen,
  atmosPanelOpen,
  dockOpen,
  touchEnabled,
  newTabUrl,
  onToggleDock,
  onToggleTouch,
  onPrepareNewTab,
  onUpdateConfig,
  onClearWater,
  onResetPlanet,
  onOpenSeedModal,
  onToggleMaps,
  onToggleAtmosPanel,
  onToggleDebug,
  onReselectLanding,
  onFocusCamera,
  onPause,
}) => {
  const [camMenuOpen, setCamMenuOpen] = useState(false);
  const altStr = `${telemetry.altitude >= 0 ? '+' : ''}${telemetry.altitude.toFixed(1)}m`;
  const gravStr = `${telemetry.localGravity.toFixed(2)}m/s²`;
  const escStr = `${telemetry.escapeVelocity.toFixed(1)}m/s`;
  const tempStr = `${telemetry.localTempC.toFixed(1)}°C`;
  const pressStr = `${telemetry.localPressureAtm.toFixed(2)}atm`;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between">
      {/* Slim CAD Engineering Top Bar */}
      <header
        data-testid="cad-top-bar"
        className="pointer-events-auto w-full min-h-9 border-b border-slate-800 bg-[#090d18]/92 px-2.5 py-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
      >
        {/* Left: Brand & Live Tabular Physics Telemetry */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-mono-tabular">
          <div className="flex items-center gap-1.5 pr-1 border-r border-slate-800">
            <span className="font-display font-semibold text-xs text-white tracking-tight">
              TerraSphere
            </span>
            <span className="text-[10px] text-sky-400">{telemetry.backend}</span>
          </div>

          <div className="hidden sm:flex items-center gap-1">
            <span className="text-slate-500">SEED</span>
            <span className="text-sky-300 font-medium" data-testid="hud-seed-readout">
              #{telemetry.seed}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-slate-500">R₀</span>
            <span className="text-slate-100 font-medium" data-testid="hud-radius-readout">
              {fmtRadius(telemetry.planetRadius)}
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-1">
            <span className="text-slate-500">RES</span>
            <span className="text-emerald-300 font-medium" data-testid="hud-res-readout">
              {telemetry.voxelRadius >= 1e8
                ? `${Number((telemetry.voxelRadius / 1e8).toFixed(2))}亿块`
                : telemetry.voxelRadius >= 1000
                  ? `${telemetry.voxelRadius.toLocaleString()}块`
                  : `${Math.round(telemetry.voxelRadius)}块`}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-slate-500">ALT</span>
            <span className="text-white">{altStr}</span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-slate-500">g</span>
            <span className="text-sky-300">{gravStr}</span>
          </div>

          <div className="hidden sm:flex items-center gap-1">
            <span className="text-slate-500">Ve</span>
            <span className="text-slate-300">{escStr}</span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-slate-500">T</span>
            <span className="text-amber-300" data-testid="hud-temp-readout">
              {tempStr}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-1">
            <span className="text-slate-500">P</span>
            <span className="text-cyan-200">{pressStr}</span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-slate-500">H₂O</span>
            <span className="text-cyan-300">
              {Math.round(telemetry.waterParticles)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-emerald-300">{telemetry.fps} FPS</span>
          </div>

          {(config.cameraMode === 'fps' ||
            (config.cameraMode === 'landing' && telemetry.landingStage === 'landed')) && (
            <div className="flex items-center gap-1">
              <span className="text-slate-500">SPD</span>
              <span className="text-amber-300">
                {telemetry.fpsSpeed.toFixed(1)}m/s
              </span>
            </div>
          )}

          {config.cameraMode === 'detail' && (
            <div className="flex items-center gap-1">
              <span className="text-slate-500">MAG</span>
              <span className="text-cyan-300" data-testid="hud-detail-mag">
                ×{telemetry.detailZoomMag.toFixed(1)}
              </span>
            </div>
          )}

          {config.cameraMode === 'perspective' && (
            <div className="flex items-center gap-1">
              <span className="text-slate-500">FOV</span>
              <span className="text-indigo-300">{Math.round(config.perspectiveFov)}°</span>
            </div>
          )}

          {config.simPaused && (
            <span className="px-1.5 py-0.5 rounded-xs border border-amber-500/60 bg-amber-950/60 text-[10px] font-semibold text-amber-300">
              模拟冻结
            </span>
          )}
        </div>

        {/* Right: Compact Engineering Action Strip */}
        <div className="flex flex-wrap items-center gap-1">
          <OfflineIndicator />
          <PWAInstallButton compact />

          <div className="relative flex items-center">
            <button
              type="button"
              tabIndex={-1}
              data-testid="camera-mode-btn"
              title="切换摄像机模式 (Tab)"
              onClick={(e) => {
                e.currentTarget.blur();
                onUpdateConfig({
                  cameraMode: NEXT_CAMERA_MODE[config.cameraMode],
                });
              }}
              className="h-7 px-2 rounded-l-xs border border-slate-700/80 bg-[#0d1322] hover:border-sky-400/80 text-[11px] font-medium text-slate-200 transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <Camera className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>{CAMERA_LABEL[config.cameraMode]} [Tab]</span>
            </button>
            <button
              type="button"
              tabIndex={-1}
              data-testid="camera-menu-toggle-btn"
              title="选择摄像机模式"
              aria-expanded={camMenuOpen}
              onClick={(e) => {
                e.currentTarget.blur();
                setCamMenuOpen((v) => !v);
              }}
              className="h-7 px-1 rounded-r-xs border border-l-0 border-slate-700/80 bg-[#0d1322] hover:border-sky-400/80 text-slate-300 hover:text-white transition-colors cursor-pointer flex items-center justify-center shrink-0"
            >
              <ChevronDown className="w-3 h-3" />
            </button>

            {camMenuOpen && (
              <div
                data-testid="camera-mode-menu"
                className="absolute right-0 top-8 z-30 w-60 rounded-sm border border-slate-700 bg-[#090d18]/96 p-1 shadow-xl flex flex-col gap-0.5"
              >
                {CAMERA_MODES.map((m) => {
                  const active = config.cameraMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      tabIndex={-1}
                      data-testid={`camera-option-${m.id}`}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onUpdateConfig({ cameraMode: m.id });
                        setCamMenuOpen(false);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-xs border transition-colors cursor-pointer flex flex-col ${
                        active
                          ? 'border-sky-400/80 bg-sky-950/70 text-white'
                          : 'border-transparent hover:bg-slate-800/80 text-slate-300'
                      }`}
                    >
                      <span className="text-[11px] font-medium flex items-center justify-between">
                        <span>{m.label}</span>
                        {active && (
                          <span className="text-[10px] text-sky-300 font-mono-tabular">
                            当前
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {m.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            tabIndex={-1}
            data-testid="sim-pause-btn"
            title="冻结或恢复流体与物理模拟 (K)"
            onClick={(e) => {
              e.currentTarget.blur();
              onUpdateConfig({ simPaused: !config.simPaused });
            }}
            className={`h-7 px-2 rounded-xs border text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
              config.simPaused
                ? 'border-amber-400 bg-amber-950/60 text-amber-200'
                : 'border-slate-700/80 bg-[#0d1322] text-slate-200 hover:border-slate-500'
            }`}
          >
            {config.simPaused ? (
              <>
                <Play className="w-3 h-3 shrink-0" />
                <span>恢复 [K]</span>
              </>
            ) : (
              <>
                <Pause className="w-3 h-3 shrink-0" />
                <span>冻结 [K]</span>
              </>
            )}
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="voxel-blocky-btn"
            aria-pressed={config.terrainRenderMode === 'blocky'}
            title="切换平滑等值面与方块化(Minecraft风格)体素几何 (V)"
            onClick={(e) => {
              e.currentTarget.blur();
              onUpdateConfig({
                terrainRenderMode:
                  config.terrainRenderMode === 'blocky' ? 'smooth' : 'blocky',
              });
            }}
            className={`h-7 px-2 rounded-xs border text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
              config.terrainRenderMode === 'blocky'
                ? 'border-emerald-400 bg-emerald-950/70 text-emerald-200'
                : 'border-slate-700/80 bg-[#0d1322] text-slate-200 hover:border-slate-500'
            }`}
          >
            <Box className="w-3.5 h-3.5 shrink-0" />
            <span>
              {config.terrainRenderMode === 'blocky' ? '方块 [V]' : '方块化 [V]'}
            </span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="terrain-overlay-btn"
            title="切换地形表面着色：岩性材质 / 三维温度 / 径向层析 (T)"
            onClick={(e) => {
              e.currentTarget.blur();
              onUpdateConfig({
                terrainOverlay: NEXT_OVERLAY[config.terrainOverlay],
              });
            }}
            className={`h-7 px-2 rounded-xs border text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
              config.terrainOverlay !== 'material'
                ? 'border-amber-400 bg-amber-950/70 text-amber-200'
                : 'border-slate-700/80 bg-[#0d1322] text-slate-200 hover:border-slate-500'
            }`}
          >
            <Thermometer className="w-3.5 h-3.5 shrink-0" />
            <span>{OVERLAY_LABEL[config.terrainOverlay]} [T]</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="atmos-panel-btn"
            aria-pressed={atmosPanelOpen}
            title="大气层、积云模拟与三维温度场设置 (C)"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleAtmosPanel();
            }}
            className={`h-7 px-2 rounded-xs border text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
              atmosPanelOpen
                ? 'border-sky-400 bg-sky-950/70 text-sky-200'
                : 'border-slate-700/80 bg-[#0d1322] text-slate-200 hover:border-slate-500'
            }`}
          >
            <Cloud className="w-3.5 h-3.5 shrink-0" />
            <span>大气/云温 [C]</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="maps-modal-btn"
            aria-pressed={mapsOpen}
            title="打开多投影行星地图、地质图、等高线、温度图与星球剖面图 (N)"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMaps();
            }}
            className={`h-7 px-2 rounded-xs border text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
              mapsOpen
                ? 'border-cyan-400 bg-cyan-950/70 text-cyan-200'
                : 'border-slate-700/80 bg-[#0d1322] text-slate-200 hover:border-slate-500'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5 shrink-0" />
            <span>地图/剖面 [N]</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="gravity-field-btn"
            title="显示或隐藏牛顿引力矢量场 (G)"
            onClick={(e) => {
              e.currentTarget.blur();
              onUpdateConfig({
                showGravityVectors: !config.showGravityVectors,
              });
            }}
            className={`h-7 px-2 rounded-xs border text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
              config.showGravityVectors
                ? 'border-sky-400 bg-sky-950/60 text-sky-200'
                : 'border-slate-700/80 bg-[#0d1322] text-slate-300 hover:text-white'
            }`}
          >
            <Magnet className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden xl:inline">引力场</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="touch-toggle-btn"
            aria-pressed={touchEnabled}
            title="开启或关闭触屏虚拟摇杆与手势控制"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleTouch();
            }}
            className={`h-7 px-2 rounded-xs border text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
              touchEnabled
                ? 'border-cyan-400 bg-cyan-950/70 text-cyan-200'
                : 'border-slate-700/80 bg-[#0d1322] text-slate-300 hover:border-slate-500'
            }`}
          >
            <Hand className="w-3.5 h-3.5 shrink-0" />
            <span>触屏:{touchEnabled ? '开' : '关'}</span>
          </button>

          <a
            href={newTabUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-new-tab-link"
            onPointerDown={onPrepareNewTab}
            onClick={onPrepareNewTab}
            title="在新标签页中打开当前星球种子与实时地形/水体状态"
            className="h-7 px-2 rounded-xs border border-slate-700/80 bg-[#0d1322] hover:border-sky-400/80 text-[11px] font-medium text-slate-200 hover:text-white transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="hidden lg:inline">新标签页</span>
          </a>

          <button
            type="button"
            tabIndex={-1}
            data-testid="seed-modal-btn"
            title="星球复杂种子与持久化存档 (B)"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenSeedModal();
            }}
            className="h-7 px-2 rounded-xs border border-slate-700/80 bg-[#0d1322] hover:border-emerald-400/80 text-[11px] font-medium text-slate-200 hover:text-white transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Sliders className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>种子/存档 [B]</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="debug-menu-btn"
            title="调试与体素格式检查器 (F3)"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleDebug();
            }}
            className={`h-7 px-2 rounded-xs border text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
              debugOpen
                ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200'
                : 'border-slate-700/80 bg-[#0d1322] text-slate-200 hover:border-slate-500'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 shrink-0" />
            <span>体素 [F3]</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label={config.muted ? '取消静音 (M)' : '静音 (M)'}
            title={config.muted ? '取消静音 (M)' : '静音 (M)'}
            onClick={(e) => {
              e.currentTarget.blur();
              onUpdateConfig({ muted: !config.muted });
            }}
            className="w-7 h-7 rounded-xs border border-slate-700/80 bg-[#0d1322] text-slate-200 hover:border-slate-500 transition-colors cursor-pointer flex items-center justify-center shrink-0"
          >
            {config.muted ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="pause-menu-btn"
            aria-label="暂停菜单 (P)"
            title="暂停菜单 (P)"
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            className="w-7 h-7 rounded-xs border border-slate-700/80 bg-[#0d1322] text-slate-200 hover:border-slate-500 transition-colors cursor-pointer flex items-center justify-center shrink-0"
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Mode-Specific Compact Camera Strip */}
      {(config.cameraMode === 'detail' ||
        config.cameraMode === 'landing' ||
        config.cameraMode === 'perspective') && (
        <div className="pointer-events-none flex justify-center pt-1.5 px-2">
          <div
            data-testid="camera-mode-context-bar"
            className="pointer-events-auto h-7 px-2.5 rounded-xs border border-slate-700/80 bg-[#090d18]/90 text-[11px] text-slate-200 flex items-center gap-2.5 shadow-md"
          >
            {config.cameraMode === 'detail' && (
              <>
                <span className="flex items-center gap-1 text-cyan-300 font-medium">
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>细节放大 ×{telemetry.detailZoomMag.toFixed(1)}</span>
                </span>
                <span className="hidden sm:inline text-slate-400 text-[10px]">
                  滚轮向指针体素拉近 · 右键俯仰 · WASD平移视点
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="detail-focus-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onFocusCamera();
                  }}
                  className="h-5 px-2 rounded-xs border border-cyan-500/60 bg-cyan-950/60 hover:bg-cyan-900/70 text-[10px] text-cyan-200 cursor-pointer"
                >
                  锁定视角中心 [F]
                </button>
              </>
            )}

            {config.cameraMode === 'landing' && (
              <>
                <span className="flex items-center gap-1 text-emerald-300 font-medium">
                  <Navigation className="w-3.5 h-3.5" />
                  <span>
                    {telemetry.landingStage === 'selecting'
                      ? '降落选址中 · 左键点击星球表面降落'
                      : telemetry.landingStage === 'descending'
                        ? '正在精准降落着陆...'
                        : '已着陆 · WASD地表FPS · 空格跳跃 · Shift疾跑'}
                  </span>
                </span>
                {telemetry.landingStage !== 'selecting' && (
                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="landing-reselect-btn"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onReselectLanding();
                    }}
                    className="h-5 px-2 rounded-xs border border-emerald-500/60 bg-emerald-950/60 hover:bg-emerald-900/70 text-[10px] text-emerald-200 cursor-pointer flex items-center gap-1"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>重选降落点 [R]</span>
                  </button>
                )}
              </>
            )}

            {config.cameraMode === 'perspective' && (
              <>
                <span className="text-indigo-300 font-medium">
                  透视视角
                </span>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-300">
                  <span>FOV</span>
                  <input
                    type="range"
                    min={18}
                    max={115}
                    step={1}
                    value={config.perspectiveFov}
                    onChange={(e) =>
                      onUpdateConfig({
                        perspectiveFov: Number(e.target.value),
                      })
                    }
                    className="w-24 accent-indigo-400 cursor-pointer"
                  />
                  <span className="font-mono-tabular text-indigo-200 w-7 text-right">
                    {Math.round(config.perspectiveFov)}°
                  </span>
                </label>
                <span className="hidden md:inline text-slate-400 text-[10px]">
                  Shift/中键拖拽平移 · [F]聚焦目标 · 滚轮推拉
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="persp-focus-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onFocusCamera();
                  }}
                  className="h-5 px-2 rounded-xs border border-indigo-500/60 bg-indigo-950/60 hover:bg-indigo-900/70 text-[10px] text-indigo-200 cursor-pointer"
                >
                  重置聚焦 [F]
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Center Reticle */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        aria-hidden="true"
      >
        <div className="w-1.5 h-1.5 rounded-full border border-white/70 bg-sky-400/50" />
      </div>

      {/* Compact Collapsible Bottom CAD Dock */}
      <div className="flex flex-col items-center px-2 pb-1.5">
        <button
          type="button"
          tabIndex={-1}
          aria-expanded={dockOpen}
          data-testid="toggle-dock-btn"
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleDock();
          }}
          className="pointer-events-auto mb-1 h-5 px-2.5 rounded-t-xs border border-b-0 border-slate-800 bg-[#090d18]/92 text-[10px] font-mono-tabular text-slate-400 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
        >
          {dockOpen ? (
            <>
              <ChevronDown className="w-3 h-3" />
              <span>收起工程工具栏</span>
            </>
          ) : (
            <>
              <ChevronUp className="w-3 h-3" />
              <span>展开工程工具栏</span>
            </>
          )}
        </button>

        {dockOpen && (
          <div
            data-testid="cad-bottom-dock"
            className="pointer-events-auto w-full max-w-[980px] rounded-sm border border-slate-800 bg-[#090d18]/92 px-2.5 py-1.5 flex flex-col gap-1.5"
          >
            {/* Row 1: Sculpt Tools & Materials */}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1">
                {TOOL_ITEMS.map((t) => {
                  const active = config.tool === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onUpdateConfig({ tool: t.id });
                      }}
                      className={`h-7 px-2 rounded-xs border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                        active
                          ? 'border-sky-400 bg-sky-950/70 text-white'
                          : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-xs inline-block shrink-0"
                        style={{ backgroundColor: t.accent }}
                      />
                      <span className="font-mono-tabular text-slate-400 text-[10px]">
                        {t.keyHint}
                      </span>
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {MATERIAL_ITEMS.map((mat) => {
                  const active = config.material === mat.id;
                  return (
                    <button
                      key={mat.id}
                      type="button"
                      tabIndex={-1}
                      aria-label={`材质 ${mat.label}`}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onUpdateConfig({ material: mat.id });
                      }}
                      className={`h-7 px-2 rounded-xs border text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                        active
                          ? 'border-emerald-400 text-white bg-slate-800'
                          : 'border-slate-800 text-slate-400 hover:text-slate-200 bg-[#0d1322]'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: mat.swatch }}
                      />
                      <span>{mat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Row 2: Unrestricted Numeric CAD Parameters + Quick World Actions */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pt-1.5 border-t border-slate-800/90 text-[11px] text-slate-300">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-slate-400">笔刷半径</span>
                  <NumericCadInput
                    value={config.brushRadius}
                    minValid={1e-9}
                    unit="m"
                    ariaLabel="笔刷半径"
                    testId="hud-brush-radius-input"
                    sliderScale="log"
                    sliderMin={Math.max(
                      1e-8,
                      Number((telemetry.nativeVoxelSize * 1.5).toPrecision(2)),
                    )}
                    sliderMax={Math.max(10, Number((telemetry.planetRadius * 0.6).toFixed(1)))}
                    className="w-24"
                    onChangeValue={(v) => onUpdateConfig({ brushRadius: v })}
                  />
                </label>

                <label className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-slate-400">笔刷强度</span>
                  <NumericCadInput
                    value={config.brushStrength}
                    minValid={0.01}
                    ariaLabel="笔刷强度"
                    testId="hud-brush-strength-input"
                    sliderMin={0.1}
                    sliderMax={6}
                    sliderStep={0.05}
                    className="w-20"
                    onChangeValue={(v) => onUpdateConfig({ brushStrength: v })}
                  />
                </label>

                <label className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-slate-400">引力系数</span>
                  <NumericCadInput
                    value={config.gravityScale}
                    unit="g"
                    ariaLabel="引力系数"
                    testId="hud-gravity-scale-input"
                    sliderMin={0}
                    sliderMax={4}
                    sliderStep={0.05}
                    className="w-20"
                    onChangeValue={(v) => onUpdateConfig({ gravityScale: v })}
                  />
                </label>

                <label className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-slate-400">太阳高度</span>
                  <NumericCadInput
                    value={config.sunElevationDeg}
                    unit="°"
                    ariaLabel="太阳高度角"
                    testId="hud-sun-el-input"
                    sliderMin={-90}
                    sliderMax={90}
                    sliderStep={1}
                    className="w-20"
                    onChangeValue={(v) =>
                      onUpdateConfig({ sunElevationDeg: v })
                    }
                  />
                </label>
              </div>

              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onClearWater();
                  }}
                  className="h-7 px-2.5 rounded-xs border border-slate-700 hover:border-cyan-400/80 bg-[#0d1322] text-slate-300 hover:text-white text-[11px] cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                >
                  排空水体
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onResetPlanet();
                  }}
                  className="h-7 px-2.5 rounded-xs border border-slate-700 hover:border-amber-400/80 bg-[#0d1322] text-slate-300 hover:text-white text-[11px] cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                >
                  随机重置
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
