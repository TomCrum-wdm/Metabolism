import React, { useState } from 'react';
import { Copy, Plus, RotateCcw, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { MaterialId } from '../engine/voxelPlanet';
import {
  createCustomToolTemplate,
  PlanetToolDef,
  TOOL_BEHAVIOR_PRESETS,
  ToolAttributes,
  ToolBehavior,
  ToolIconName,
} from '../engine/toolRegistry';
import { TOOL_ICON_OPTIONS, ToolIcon } from './ToolIcon';

interface ToolStudioDrawerProps {
  activeTool: PlanetToolDef;
  paletteExpanded?: boolean;
  hasOverride: boolean;
  onUpdateActiveAttributes: (partial: Partial<ToolAttributes>) => void;
  onResetBuiltinOverride: (toolId: string) => void;
  onSaveCustomTool: (tool: PlanetToolDef, activate?: boolean) => void;
  onDeleteCustomTool: (toolId: string) => void;
  onClose: () => void;
}

const MATERIAL_CHOICES: ReadonlyArray<{
  value: 'active' | MaterialId;
  label: string;
}> = [
  { value: 'active', label: '跟随当前材质' },
  { value: MaterialId.Soil, label: '沃土 Soil' },
  { value: MaterialId.Stone, label: '灰岩 Stone' },
  { value: MaterialId.Basalt, label: '玄武岩 Basalt' },
  { value: MaterialId.Sandstone, label: '砂岩 Sandstone' },
  { value: MaterialId.Crystal, label: '晶矿 Crystal' },
  { value: MaterialId.Ice, label: '极冰 Ice' },
  { value: MaterialId.Magma, label: '熔岩 Magma' },
];

const RIM_MATERIAL_CHOICES: ReadonlyArray<{
  value: 'none' | 'active' | MaterialId;
  label: string;
}> = [
  { value: 'none', label: '无焦化/沉积边缘' },
  { value: 'active', label: '跟随当前材质' },
  { value: MaterialId.Basalt, label: '玄武岩焦壳' },
  { value: MaterialId.Magma, label: '熔融岩浆缘' },
  { value: MaterialId.Crystal, label: '晶化玻璃' },
  { value: MaterialId.Sandstone, label: '焦化砂岩' },
  { value: MaterialId.Ice, label: '寒冰覆盖' },
  { value: MaterialId.Soil, label: '沃土覆盖' },
];

const ACCENT_SWATCHES = [
  '#ff2e63',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#84cc16',
  '#10b981',
  '#22d3ee',
  '#60a5fa',
  '#818cf8',
  '#ec4899',
];

export const ToolStudioDrawer: React.FC<ToolStudioDrawerProps> = ({
  activeTool,
  paletteExpanded,
  hasOverride,
  onUpdateActiveAttributes,
  onResetBuiltinOverride,
  onSaveCustomTool,
  onDeleteCustomTool,
  onClose,
}) => {
  const [tab, setTab] = useState<'inspect' | 'create'>('inspect');

  // Create/Draft Custom Tool state
  const [draftName, setDraftName] = useState('超级等离子炮');
  const [draftDesc, setDraftDesc] = useState('高威力自定义行星工程工具');
  const [draftIcon, setDraftIcon] = useState<ToolIconName>('sun');
  const [draftBehavior, setDraftBehavior] = useState<ToolBehavior>('megaLaser');
  const [draftAttrs, setDraftAttrs] = useState<ToolAttributes>(() =>
    createCustomToolTemplate('megaLaser').attributes,
  );

  // Sync draft base when user switches behavior preset in Create tab
  const handleSelectPresetBehavior = (behavior: ToolBehavior) => {
    const preset = TOOL_BEHAVIOR_PRESETS.find((p) => p.behavior === behavior);
    setDraftBehavior(behavior);
    if (preset) {
      setDraftIcon(preset.defaultIcon);
      setDraftName(`自定${preset.label}`);
      setDraftDesc(preset.desc);
      setDraftAttrs({
        behavior,
        ...preset.defaults,
        colorHex: preset.defaultColor,
      });
    }
  };

  // Clone active tool into Create tab so user can modify & save as a new custom tool
  const handleCloneActiveToCreate = () => {
    setDraftName(`${activeTool.name} Pro`);
    setDraftDesc(activeTool.desc);
    setDraftIcon(activeTool.iconName);
    setDraftBehavior(activeTool.attributes.behavior);
    setDraftAttrs({ ...activeTool.attributes });
    setTab('create');
  };

  const curAttrs = tab === 'inspect' ? activeTool.attributes : draftAttrs;
  const setAttr = (partial: Partial<ToolAttributes>) => {
    if (tab === 'inspect') {
      onUpdateActiveAttributes(partial);
    } else {
      setDraftAttrs((prev) => ({ ...prev, ...partial }));
    }
  };

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = draftName.trim() || '自定义工具';
    const created = createCustomToolTemplate(draftBehavior, {
      name: trimmedName,
      desc: draftDesc.trim() || '玩家自定义工程工具',
      iconName: draftIcon,
      attributes: {
        ...draftAttrs,
        behavior: draftBehavior,
      },
    });
    onSaveCustomTool(created, true);
    setTab('inspect');
  };

  return (
    <section
      data-testid="tool-studio-drawer"
      className="flex-1 min-h-0 flex flex-col bg-[#080c15] text-slate-200 overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-800 bg-[#0d1322] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <h2 className="font-display text-xs font-semibold text-white truncate">
            工具属性与工坊
          </h2>
        </div>
        <button
          type="button"
          tabIndex={-1}
          data-testid="close-tool-studio-btn"
          onClick={onClose}
          className="w-6 h-6 rounded-xs hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
          aria-label="关闭工具属性工坊"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="px-2.5 pt-2 pb-1.5 border-b border-slate-800/90 flex items-center gap-1 shrink-0">
        <button
          type="button"
          tabIndex={-1}
          data-testid="studio-tab-inspect"
          onClick={() => setTab('inspect')}
          className={`flex-1 h-7 px-2 rounded-xs border text-[11px] font-medium cursor-pointer whitespace-nowrap transition-colors ${
            tab === 'inspect'
              ? 'border-sky-400 bg-sky-950/70 text-white'
              : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-slate-200'
          }`}
        >
          调校当前工具
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-testid="studio-tab-create"
          onClick={() => setTab('create')}
          className={`flex-1 h-7 px-2 rounded-xs border text-[11px] font-medium cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
            tab === 'create'
              ? 'border-emerald-400 bg-emerald-950/60 text-white'
              : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-slate-200'
          }`}
        >
          <Plus className="w-3.5 h-3.5 shrink-0" />
          <span>新建工具</span>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-3 text-[11px] text-slate-200">
        {tab === 'inspect' ? (
          <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-7 h-7 rounded-xs border border-slate-700 bg-[#0d1322] flex items-center justify-center shrink-0"
                style={{ color: activeTool.attributes.colorHex }}
              >
                <ToolIcon iconName={activeTool.iconName} className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="font-display font-semibold text-white text-xs truncate">
                  {activeTool.name}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {activeTool.isCustom ? '自定义工具' : '内置预设'} · {activeTool.attributes.behavior}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                tabIndex={-1}
                title="克隆当前参数创建新工具"
                onClick={handleCloneActiveToCreate}
                className="h-6 px-2 rounded-xs border border-slate-700 hover:border-sky-400 bg-[#0d1322] text-[10px] text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Copy className="w-3 h-3" />
                <span>另存</span>
              </button>
              {activeTool.isCustom ? (
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="delete-custom-tool-btn"
                  title="删除自定义工具"
                  onClick={() => onDeleteCustomTool(activeTool.id)}
                  className="h-6 w-6 rounded-xs border border-rose-500/40 hover:bg-rose-950/60 text-rose-300 flex items-center justify-center cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              ) : (
                hasOverride && (
                  <button
                    type="button"
                    tabIndex={-1}
                    title="重置为出厂参数"
                    onClick={() => onResetBuiltinOverride(activeTool.id)}
                    className="h-6 w-6 rounded-xs border border-slate-700 hover:border-amber-400 text-amber-300 flex items-center justify-center cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                )
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 pb-2 border-b border-slate-800">
            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">工具名称</span>
              <input
                type="text"
                data-testid="custom-tool-name-input"
                value={draftName}
                maxLength={20}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="例如：行星分裂激光"
                className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[11px] focus:border-emerald-400 focus:outline-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">效果说明</span>
              <input
                type="text"
                value={draftDesc}
                maxLength={60}
                onChange={(e) => setDraftDesc(e.target.value)}
                className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-slate-200 text-[11px] focus:border-emerald-400 focus:outline-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">核心物理行为模板</span>
              <select
                data-testid="custom-tool-behavior-select"
                value={draftBehavior}
                onChange={(e) => handleSelectPresetBehavior(e.target.value as ToolBehavior)}
                className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[11px] focus:border-emerald-400 focus:outline-none"
              >
                {TOOL_BEHAVIOR_PRESETS.map((p) => (
                  <option key={p.behavior} value={p.behavior}>
                    {p.label} — {p.desc}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1">
              <span className="text-[10px] text-slate-400">同步显示图标</span>
              <div className="grid grid-cols-6 gap-1">
                {TOOL_ICON_OPTIONS.map((ico) => {
                  const selected = draftIcon === ico.id;
                  return (
                    <button
                      key={ico.id}
                      type="button"
                      tabIndex={-1}
                      title={ico.label}
                      onClick={() => setDraftIcon(ico.id)}
                      className={`h-7 rounded-xs border flex items-center justify-center cursor-pointer transition-colors ${
                        selected
                          ? 'border-emerald-400 bg-emerald-950/60 text-white'
                          : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
                      }`}
                    >
                      <ToolIcon iconName={ico.id} className="w-3.5 h-3.5" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Shared Live Physics / Voxel / Thermal Attribute Controls */}
        <div className="space-y-2.5">
          <div className="text-[10px] font-semibold text-slate-400 tracking-wide">
            物理与破坏属性配置
          </div>

          <label className="block space-y-0.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-300">影响半径倍率</span>
              <span className="font-mono-tabular text-sky-300">
                {curAttrs.radiusMult.toFixed(2)}×
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={6.0}
              step={0.05}
              data-testid="attr-radius-mult"
              value={curAttrs.radiusMult}
              onChange={(e) => setAttr({ radiusMult: Number(e.target.value) })}
              className="w-full accent-sky-400 cursor-pointer"
            />
          </label>

          <label className="block space-y-0.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-300">破坏 / 塑形强度倍率</span>
              <span className="font-mono-tabular text-amber-300">
                {curAttrs.strengthMult.toFixed(2)}×
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={6.0}
              step={0.05}
              data-testid="attr-strength-mult"
              value={curAttrs.strengthMult}
              onChange={(e) => setAttr({ strengthMult: Number(e.target.value) })}
              className="w-full accent-amber-400 cursor-pointer"
            />
          </label>

          <label className="block space-y-0.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-300">触发冷却间隔 (连射频率)</span>
              <span className="font-mono-tabular text-emerald-300">
                {Math.round(curAttrs.cooldownSec * 1000)} ms
              </span>
            </div>
            <input
              type="range"
              min={0.02}
              max={0.8}
              step={0.01}
              value={curAttrs.cooldownSec}
              onChange={(e) => setAttr({ cooldownSec: Number(e.target.value) })}
              className="w-full accent-emerald-400 cursor-pointer"
            />
          </label>

          <label className="block space-y-0.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-300">射线贯穿深度 (×R₀)</span>
              <span className="font-mono-tabular text-rose-300">
                {curAttrs.pierceDepthRatio.toFixed(2)} R₀
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={3.5}
              step={0.05}
              value={curAttrs.pierceDepthRatio}
              onChange={(e) => setAttr({ pierceDepthRatio: Number(e.target.value) })}
              className="w-full accent-rose-400 cursor-pointer"
            />
          </label>

          <label className="block space-y-0.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-300">温度冲击 (热核加热 / 极冰急冻)</span>
              <span className="font-mono-tabular text-orange-300">
                {curAttrs.thermalDeltaC >= 0 ? `+${curAttrs.thermalDeltaC}` : curAttrs.thermalDeltaC} °C
              </span>
            </div>
            <input
              type="range"
              min={-350}
              max={2500}
              step={10}
              value={curAttrs.thermalDeltaC}
              onChange={(e) => setAttr({ thermalDeltaC: Number(e.target.value) })}
              className="w-full accent-orange-400 cursor-pointer"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-0.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-300">碎石飞溅</span>
                <span className="font-mono-tabular text-slate-200">{curAttrs.debrisCount}</span>
              </div>
              <input
                type="range"
                min={0}
                max={64}
                step={2}
                value={curAttrs.debrisCount}
                onChange={(e) => setAttr({ debrisCount: Number(e.target.value) })}
                className="w-full accent-slate-300 cursor-pointer"
              />
            </label>

            <label className="block space-y-0.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-300">生成数量/节数</span>
                <span className="font-mono-tabular text-slate-200">{curAttrs.entityCount}</span>
              </div>
              <input
                type="range"
                min={1}
                max={16}
                step={1}
                value={curAttrs.entityCount}
                onChange={(e) => setAttr({ entityCount: Number(e.target.value) })}
                className="w-full accent-lime-400 cursor-pointer"
              />
            </label>
          </div>

          <label className="block space-y-0.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-300">实体运动速度 (陨石/蠕虫/喷泉)</span>
              <span className="font-mono-tabular text-cyan-300">
                {curAttrs.entitySpeed.toFixed(1)}×
              </span>
            </div>
            <input
              type="range"
              min={0.3}
              max={4.0}
              step={0.1}
              value={curAttrs.entitySpeed}
              onChange={(e) => setAttr({ entitySpeed: Number(e.target.value) })}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">核心生成材质</span>
              <select
                value={String(curAttrs.depositMaterial)}
                onChange={(e) =>
                  setAttr({
                    depositMaterial:
                      e.target.value === 'active'
                        ? 'active'
                        : (Number(e.target.value) as MaterialId),
                  })
                }
                className="w-full h-7 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] text-slate-100 text-[10px]"
              >
                {MATERIAL_CHOICES.map((c) => (
                  <option key={String(c.value)} value={String(c.value)}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] text-slate-400">边缘焦化/沉淀</span>
              <select
                value={String(curAttrs.rimMaterial)}
                onChange={(e) =>
                  setAttr({
                    rimMaterial:
                      e.target.value === 'none' || e.target.value === 'active'
                        ? e.target.value
                        : (Number(e.target.value) as MaterialId),
                  })
                }
                className="w-full h-7 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] text-slate-100 text-[10px]"
              >
                {RIM_MATERIAL_CHOICES.map((c) => (
                  <option key={String(c.value)} value={String(c.value)}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={curAttrs.leaveRim}
                onChange={(e) => setAttr({ leaveRim: e.target.checked })}
                className="accent-amber-400 cursor-pointer"
              />
              <span>弹坑边缘隆起</span>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={curAttrs.continuousBeam}
                onChange={(e) => setAttr({ continuousBeam: e.target.checked })}
                className="accent-rose-400 cursor-pointer"
              />
              <span>轨道激光光束</span>
            </label>
          </div>

          {/* Color Accent Picker */}
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>工具图标与激光束色调</span>
              <span className="font-mono-tabular text-slate-300">{curAttrs.colorHex}</span>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {ACCENT_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  tabIndex={-1}
                  onClick={() => setAttr({ colorHex: hex })}
                  className={`w-4 h-4 rounded-xs border cursor-pointer ${
                    curAttrs.colorHex.toLowerCase() === hex
                      ? 'border-white scale-110'
                      : 'border-slate-700'
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
              <input
                type="color"
                value={curAttrs.colorHex}
                onChange={(e) => setAttr({ colorHex: e.target.value })}
                className="w-5 h-5 bg-transparent border-0 cursor-pointer p-0"
                title="自定义任意十六进制颜色"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer Save CTA in Create Tab */}
      {tab === 'create' && (
        <form
          onSubmit={handleSubmitCreate}
          className="p-2.5 border-t border-slate-800 bg-[#0d1322] flex items-center gap-2 shrink-0"
        >
          <button
            type="submit"
            data-testid="save-custom-tool-btn"
            className="flex-1 h-8 px-3 rounded-xs bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>保存并启用工具</span>
          </button>
        </form>
      )}
    </section>
  );
};
