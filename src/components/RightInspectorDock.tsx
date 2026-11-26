import React from 'react';
import {
  Cloud,
  Compass,
  FlaskConical,
  SlidersHorizontal,
  Terminal,
  Wrench,
} from 'lucide-react';
import { SandboxConfig } from '../engine/webgpuScene';

export type RightInspectorTab =
  | 'system'
  | 'debug'
  | 'metabolism'
  | 'atmos'
  | 'survey'
  | 'studio';

interface RightInspectorDockProps {
  activeTab: RightInspectorTab | null;
  onSelectTab: (tab: RightInspectorTab) => void;
  config: SandboxConfig;
  surveyBenchmarkCount: number;
  legendNode?: React.ReactNode;
  children?: React.ReactNode;
}

const RAIL_ITEMS: ReadonlyArray<{
  id: RightInspectorTab;
  label: string;
  hint: string;
  activeAccent: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'system',
    label: '系统',
    hint: '全局系统设置与多尺度参数',
    activeAccent: 'border-sky-400 bg-sky-950/75 text-sky-200',
    icon: <SlidersHorizontal className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'debug',
    label: '性能',
    hint: '性能监测、LOD 与体素探针 [F3]',
    activeAccent: 'border-emerald-400 bg-emerald-950/70 text-emerald-200',
    icon: <Terminal className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'metabolism',
    label: '代谢',
    hint: '欧拉耗散代谢与地质演化 [J]',
    activeAccent: 'border-emerald-400 bg-emerald-950/70 text-emerald-200',
    icon: <FlaskConical className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'atmos',
    label: '大气',
    hint: '大气散射、积云与三维温度场 [C]',
    activeAccent: 'border-sky-400 bg-sky-950/75 text-sky-200',
    icon: <Cloud className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'survey',
    label: '测绘',
    hint: '地质测绘与多坐标系工作站 [U]',
    activeAccent: 'border-teal-400 bg-teal-950/70 text-teal-200',
    icon: <Compass className="w-4 h-4 shrink-0" />,
  },
  {
    id: 'studio',
    label: '工坊',
    hint: '工具属性调校与自定义工具工坊',
    activeAccent: 'border-amber-400 bg-amber-950/70 text-amber-200',
    icon: <Wrench className="w-4 h-4 shrink-0" />,
  },
];

export const RightInspectorDock: React.FC<RightInspectorDockProps> = ({
  activeTab,
  onSelectTab,
  config,
  surveyBenchmarkCount,
  legendNode,
  children,
}) => {
  const hasDockedLegendOnly = activeTab === null && config.terrainOverlay !== 'material' && Boolean(legendNode);

  return (
    <div
      data-testid="right-inspector-dock"
      className="h-full shrink-0 flex overflow-hidden bg-[#080c15]"
    >
      {/* Docked Content Column (Never overlaps 3D canvas) */}
      {activeTab !== null && children && (
        <div
          data-testid="right-inspector-pane"
          className="w-[388px] xl:w-[416px] max-w-[44vw] h-full border-l border-slate-800 bg-[#080c15] flex flex-col min-h-0 overflow-hidden"
        >
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {children}
          </div>
          {legendNode && (
            <div className="shrink-0 max-h-[215px] overflow-y-auto">
              {legendNode}
            </div>
          )}
        </div>
      )}

      {/* Standalone Docked Field Legend Column when overlay != material and no inspector tab is open */}
      {hasDockedLegendOnly && (
        <div
          data-testid="right-legend-dock"
          className="w-[292px] max-w-[34vw] h-full border-l border-slate-800 bg-[#080c15] flex flex-col justify-between overflow-y-auto"
        >
          <div className="p-2.5 text-[10px] text-slate-400 border-b border-slate-800 bg-[#0b101d] shrink-0">
            实时物理场可视化已启用，体素数值图例停靠在侧边栏以避免遮挡 3D 视口。
          </div>
          <div className="mt-auto">{legendNode}</div>
        </div>
      )}

      {/* Far-Right CAD Activity Rail */}
      <nav
        aria-label="工程检查器切换栏"
        data-testid="right-activity-rail"
        className="w-11 shrink-0 h-full border-l border-slate-800 bg-[#070b14] py-1.5 px-1 flex flex-col items-center gap-1 select-none"
      >
        {RAIL_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              tabIndex={-1}
              data-testid={`rail-tab-${item.id}`}
              aria-pressed={active}
              title={item.hint}
              onClick={(e) => {
                e.currentTarget.blur();
                onSelectTab(item.id);
              }}
              className={`relative w-9 py-1.5 rounded-xs border flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors shrink-0 ${
                active
                  ? item.activeAccent
                  : 'border-transparent bg-transparent text-slate-400 hover:text-white hover:bg-[#0d1322] hover:border-slate-800'
              }`}
            >
              {item.icon}
              <span className="text-[9.5px] font-medium leading-none whitespace-nowrap">
                {item.label}
              </span>
              {item.id === 'survey' && surveyBenchmarkCount > 0 && (
                <span className="text-[8.5px] font-mono-tabular text-teal-300 leading-none">
                  {surveyBenchmarkCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
