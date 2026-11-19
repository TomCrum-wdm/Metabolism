import React, { useMemo, useState } from 'react';
import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import { MaterialId } from '../engine/voxelPlanet';
import {
  BUILTIN_TOOLS,
  PlanetToolDef,
  TOOL_GROUP_LABELS,
  ToolGroup,
} from '../engine/toolRegistry';
import { SandboxConfig, SandboxTelemetry } from '../engine/webgpuScene';
import { ToolIcon } from './ToolIcon';

export const EDITOR_MATERIALS: ReadonlyArray<{
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

type CategoryFilter = 'all' | ToolGroup;

interface LeftToolPaletteProps {
  config: SandboxConfig;
  telemetry: SandboxTelemetry;
  tools: ReadonlyArray<PlanetToolDef>;
  activeTool: PlanetToolDef;
  expanded: boolean;
  studioOpen: boolean;
  onToggleExpanded: () => void;
  onToggleStudio: () => void;
  onSelectTool: (tool: PlanetToolDef) => void;
  onUpdateConfig: (partial: Partial<SandboxConfig>) => void;
}

const GROUP_FILTERS: ReadonlyArray<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'pierce', label: '射线' },
  { id: 'cataclysm', label: '天灾' },
  { id: 'sculpt', label: '塑形' },
  { id: 'paint', label: '流霜' },
  { id: 'custom', label: '自定' },
];

const GROUP_ORDER: ReadonlyArray<ToolGroup> = [
  'custom',
  'inspect',
  'pierce',
  'cataclysm',
  'sculpt',
  'paint',
];

export const LeftToolPalette: React.FC<LeftToolPaletteProps> = ({
  config,
  telemetry,
  tools,
  activeTool,
  expanded,
  studioOpen,
  onToggleExpanded,
  onToggleStudio,
  onSelectTool,
  onUpdateConfig,
}) => {
  const [groupFilter, setGroupFilter] = useState<CategoryFilter>('all');
  const [swatchOpen, setSwatchOpen] = useState(false);

  const activeMat =
    EDITOR_MATERIALS.find((m) => m.id === config.material) ??
    EDITOR_MATERIALS[0];

  const customCount = useMemo(
    () => tools.filter((t) => t.group === 'custom').length,
    [tools],
  );

  const visibleGroups = useMemo(() => {
    const order =
      groupFilter === 'all'
        ? GROUP_ORDER
        : ([groupFilter] as ReadonlyArray<ToolGroup>);
    return order
      .map((g) => ({
        group: g,
        label: TOOL_GROUP_LABELS[g],
        items: tools.filter((t) => t.group === g),
      }))
      .filter((sec) => sec.items.length > 0);
  }, [groupFilter, tools]);

  return (
    <aside
      data-testid="left-tool-palette"
      className="fixed left-2 top-11 bottom-16 z-20 pointer-events-none flex items-start gap-1.5"
    >
      <div
        className={`pointer-events-auto max-h-full flex flex-col rounded-sm border border-slate-800 bg-[#090d18]/94 shadow-xl overflow-hidden ${
          expanded ? 'w-[200px]' : 'w-10'
        }`}
      >
        {/* Palette Header */}
        <div className="h-7 px-1.5 border-b border-slate-800 bg-[#0d1322] flex items-center justify-between gap-1 shrink-0">
          {expanded && (
            <span className="font-display text-[10px] font-semibold tracking-wide text-slate-200 pl-1 whitespace-nowrap">
              工具箱 · {tools.length}
            </span>
          )}
          <div className="flex items-center gap-0.5 ml-auto">
            {expanded && (
              <button
                type="button"
                tabIndex={-1}
                data-testid="open-tool-studio-btn"
                title="属性调校与自定义工具工坊"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleStudio();
                }}
                className={`h-5 px-1.5 rounded-xs text-[10px] flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  studioOpen
                    ? 'bg-sky-950 text-sky-300 border border-sky-500/60'
                    : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>自定</span>
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              data-testid="toggle-left-palette-btn"
              title={expanded ? '折叠为极简图标栏' : '展开工程工具箱'}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleExpanded();
              }}
              className="w-6 h-5 rounded-xs hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
            >
              {expanded ? (
                <PanelLeftClose className="w-3.5 h-3.5" />
              ) : (
                <PanelLeftOpen className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Category Tabs when expanded */}
        {expanded && (
          <div className="px-1 py-1 border-b border-slate-800/90 bg-[#0b101d] flex flex-wrap gap-0.5 shrink-0">
            {GROUP_FILTERS.map((f) => {
              if (f.id === 'custom' && customCount === 0) return null;
              const active = groupFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setGroupFilter(f.id);
                  }}
                  className={`h-5 px-1.5 rounded-xs text-[10px] cursor-pointer whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-sky-950/90 text-sky-300 border border-sky-500/60'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Tool Grid / Icon Stack */}
        <div className="flex-1 min-h-0 overflow-y-auto p-1 space-y-1.5">
          {visibleGroups.map((sec, idx) => (
            <div
              key={sec.group}
              className={idx > 0 ? 'pt-1 border-t border-slate-800/80' : ''}
            >
              {expanded && (
                <div className="px-1 pb-0.5 text-[9px] font-medium text-slate-500 flex items-center justify-between">
                  <span>{sec.label}</span>
                  <span className="font-mono-tabular">{sec.items.length}</span>
                </div>
              )}
              <div
                className={
                  expanded ? 'grid grid-cols-2 gap-0.5' : 'flex flex-col gap-0.5'
                }
              >
                {sec.items.map((tool) => {
                  const active = config.tool === tool.id;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      tabIndex={-1}
                      data-testid={`left-tool-${tool.id}`}
                      aria-pressed={active}
                      title={`${tool.name}${tool.keyHint ? ` [${tool.keyHint}]` : ''} · ${tool.desc}`}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onSelectTool(tool);
                      }}
                      className={`h-7 rounded-xs border transition-colors cursor-pointer flex items-center whitespace-nowrap shrink-0 ${
                        expanded ? 'px-1.5 gap-1.5 min-w-0' : 'w-8 justify-center px-0'
                      } ${
                        active
                          ? 'border-sky-400/90 bg-sky-950/80 text-white'
                          : 'border-transparent bg-transparent hover:border-slate-700 hover:bg-[#0d1322] text-slate-300'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 flex items-center justify-center shrink-0"
                        style={{ color: tool.attributes.colorHex }}
                      >
                        <ToolIcon iconName={tool.iconName} className="w-3.5 h-3.5" />
                      </span>
                      {expanded && (
                        <span className="text-[10.5px] font-medium truncate">
                          {tool.name}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Add Custom Tool Quick Action + Active Material Swatch Footer */}
        <div className="p-1.5 border-t border-slate-800 bg-[#0d1322] space-y-1 shrink-0">
          <button
            type="button"
            tabIndex={-1}
            data-testid="palette-add-custom-btn"
            title="新建或编辑自定义工具属性"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleStudio();
            }}
            className={`w-full h-6 rounded-xs border border-slate-700/80 hover:border-emerald-400/80 bg-[#090d18] text-[10.5px] text-emerald-300 hover:text-white flex items-center cursor-pointer transition-colors whitespace-nowrap ${
              expanded ? 'justify-center gap-1 px-2' : 'justify-center px-0'
            }`}
          >
            <Plus className="w-3 h-3 shrink-0" />
            {expanded && <span>自定义工具 / 属性</span>}
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="left-material-swatch-btn"
            title={`当前矿物材质：${activeMat.label}（点击切换）`}
            onClick={(e) => {
              e.currentTarget.blur();
              setSwatchOpen((v) => !v);
            }}
            className={`w-full rounded-xs border border-slate-700/80 hover:border-emerald-400/80 bg-[#090d18] p-1 flex items-center cursor-pointer transition-colors ${
              expanded ? 'justify-between gap-1.5' : 'justify-center'
            }`}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-3.5 h-3.5 rounded-xs border border-white/25 shrink-0"
                style={{ backgroundColor: activeMat.swatch }}
              />
              {expanded && (
                <span className="text-[11px] font-medium text-slate-200 truncate">
                  {activeMat.label}
                </span>
              )}
            </span>
            {expanded && (
              <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
            )}
          </button>

          {expanded && (
            <div className="px-0.5 flex items-center justify-between text-[9px] font-mono-tabular text-slate-400">
              <span>{(config.brushRadius * activeTool.attributes.radiusMult).toPrecision(3)}m</span>
              <span>R₀ {telemetry.planetRadius.toFixed(1)}m</span>
            </div>
          )}
        </div>
      </div>

      {/* Floating Material Swatch & Active Tool Tip Drawer */}
      {swatchOpen && (
        <div
          data-testid="left-material-drawer"
          className="pointer-events-auto self-end mb-1 w-44 rounded-sm border border-slate-700 bg-[#090d18]/96 p-2 shadow-2xl space-y-1.5"
        >
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
            <span>选择地质材质</span>
            <span
              className="w-2 h-2 rounded-xs"
              style={{ backgroundColor: activeTool.attributes.colorHex }}
            />
          </div>
          <div className="grid grid-cols-2 gap-1">
            {EDITOR_MATERIALS.map((mat) => {
              const active = config.material === mat.id;
              return (
                <button
                  key={mat.id}
                  type="button"
                  tabIndex={-1}
                  data-testid={`left-material-${mat.id}`}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onUpdateConfig({ material: mat.id });
                    setSwatchOpen(false);
                  }}
                  className={`h-7 px-1.5 rounded-xs border text-[11px] flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors ${
                    active
                      ? 'border-emerald-400 bg-emerald-950/60 text-white'
                      : 'border-slate-800 bg-[#0d1322] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: mat.swatch }}
                  />
                  <span className="truncate">{mat.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 leading-snug pt-1 border-t border-slate-800">
            <span className="text-slate-200 font-medium">{activeTool.name}：</span>
            {activeTool.desc}
          </p>
        </div>
      )}
    </aside>
  );
};

// Keep re-export convenience for consumers checking BUILTIN_TOOLS
export { BUILTIN_TOOLS };
