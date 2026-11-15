import React, { useEffect, useState } from 'react';
import {
  decodeSeedCode,
  DEFAULT_SEED_CONFIG,
  encodeSeedCode,
  hashSeedString,
  PLANET_PRESETS,
  PlanetSeedConfig,
} from '../engine/voxelPlanet';
import { PlanetSaveSummary } from '../engine/persistence';
import { NumericCadInput } from './NumericCadInput';

interface WorldSeedModalProps {
  currentSeedConfig: PlanetSeedConfig;
  saves: PlanetSaveSummary[];
  autoSaveEnabled: boolean;
  onToggleAutoSave: (enabled: boolean) => void;
  onGenerateWithSeed: (seedConfig: PlanetSeedConfig) => void;
  onSaveSlot: (name: string) => Promise<void>;
  onLoadSlot: (id: string) => Promise<void>;
  onDeleteSlot: (id: string) => Promise<void>;
  onClose: () => void;
}

export const WorldSeedModal: React.FC<WorldSeedModalProps> = ({
  currentSeedConfig,
  saves,
  autoSaveEnabled,
  onToggleAutoSave,
  onGenerateWithSeed,
  onSaveSlot,
  onLoadSlot,
  onDeleteSlot,
  onClose,
}) => {
  const [draft, setDraft] = useState<PlanetSeedConfig>({ ...currentSeedConfig });
  const [seedText, setSeedText] = useState<string>(String(currentSeedConfig.seed));
  const [codeInput, setCodeInput] = useState<string>(encodeSeedCode(currentSeedConfig));
  const [saveName, setSaveName] = useState<string>(
    `星球 #${currentSeedConfig.seed}`,
  );
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    setCodeInput(encodeSeedCode(draft));
  }, [draft]);

  const handleSeedInputChange = (val: string) => {
    setSeedText(val);
    setDraft((prev) => ({ ...prev, seed: hashSeedString(val || '1') }));
  };

  const handleApplyCode = () => {
    const decoded = decodeSeedCode(codeInput);
    if (!decoded) {
      setStatusMsg('种子编码格式无效 (支持 TS2|... 或 TS1-... 12段编码)');
      return;
    }
    setDraft(decoded);
    setSeedText(String(decoded.seed));
    setStatusMsg('已解析复杂种子参数');
  };

  const handleRandomSeed = () => {
    const nextSeed = Math.floor(100000 + Math.random() * 899999);
    setSeedText(String(nextSeed));
    setDraft((prev) => ({ ...prev, seed: nextSeed }));
  };

  const handleQuickSave = async () => {
    const trimmed = saveName.trim() || `星球 #${draft.seed}`;
    await onSaveSlot(trimmed);
    setStatusMsg(`已持久化保存「${trimmed}」至 IndexedDB`);
  };

  return (
    <div
      data-testid="world-seed-modal"
      className="fixed inset-0 z-30 flex items-center justify-center p-3"
      style={{ backgroundColor: 'rgba(4, 7, 15, 0.80)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="world-seed-title"
    >
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-sm border border-slate-700/90 bg-[#090d18]/97 overflow-hidden text-slate-200">
        {/* CAD Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-[#0d1322]">
          <div>
            <h2
              id="world-seed-title"
              className="font-display text-sm font-bold text-white"
            >
              星球参数工程面板 & 持久化存档
            </h2>
            <p className="text-[11px] text-slate-400">
              所有参数支持自由输入任意数字（自动等比例缩放世界边界、SPH 流体与牛顿引力 R₀）
            </p>
          </div>
          <button
            type="button"
            tabIndex={-1}
            onClick={onClose}
            className="h-7 px-2.5 rounded-xs border border-slate-700 hover:border-slate-500 text-xs text-slate-300 hover:text-white cursor-pointer"
          >
            关闭
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Unrestricted Seed Parameters */}
          <div className="lg:col-span-7 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {PLANET_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    setDraft({ ...p.config });
                    setSeedText(String(p.config.seed));
                    setStatusMsg(`已载入预设「${p.label}」`);
                  }}
                  className="px-2.5 py-1.5 rounded-xs border border-slate-800 hover:border-sky-400/70 bg-[#0d1322] text-left cursor-pointer transition-colors"
                >
                  <div className="text-[11px] font-semibold text-white">{p.label}</div>
                  <div className="text-[10px] text-slate-400 truncate">{p.desc}</div>
                </button>
              ))}
            </div>

            {/* Seed String & Composite Code */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-sm border border-slate-800 bg-[#0d1322] p-2.5">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  主种子 (任意数字或文本)
                </label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={seedText}
                    onChange={(e) => handleSeedInputChange(e.target.value)}
                    className="flex-1 min-w-0 h-7 rounded-xs border border-slate-700 bg-[#050810] px-2 text-xs font-mono-tabular text-white focus:border-sky-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={handleRandomSeed}
                    className="h-7 px-2 rounded-xs border border-slate-700 hover:border-sky-400 text-[11px] text-slate-200 cursor-pointer shrink-0"
                  >
                    随机
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  复合种子编码 (支持分享与 URL 传递)
                </label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    className="flex-1 min-w-0 h-7 rounded-xs border border-slate-700 bg-[#050810] px-2 text-[11px] font-mono-tabular text-sky-300 focus:border-sky-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={handleApplyCode}
                    className="h-7 px-2 rounded-xs border border-slate-700 hover:border-emerald-400 text-[11px] text-slate-200 cursor-pointer shrink-0"
                  >
                    解析
                  </button>
                </div>
              </div>
            </div>

            {/* Unrestricted Parameter Matrix */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 rounded-sm border border-slate-800 bg-[#0d1322] p-3 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">星球半径 R₀</span>
                <NumericCadInput
                  value={draft.radius}
                  minValid={0.05}
                  unit="m"
                  ariaLabel="星球半径"
                  testId="seed-radius-input"
                  className="h-7 w-full"
                  onChangeValue={(v) => setDraft((p) => ({ ...p, radius: v }))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">初始水体倍率</span>
                <NumericCadInput
                  value={draft.waterFill}
                  minValid={0}
                  unit="x"
                  ariaLabel="初始水体倍率"
                  testId="seed-water-input"
                  className="h-7 w-full"
                  onChangeValue={(v) => setDraft((p) => ({ ...p, waterFill: v }))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">大陆起伏幅度</span>
                <NumericCadInput
                  value={draft.continentAmp}
                  ariaLabel="大陆起伏幅度"
                  testId="seed-continent-input"
                  className="h-7 w-full"
                  onChangeValue={(v) => setDraft((p) => ({ ...p, continentAmp: v }))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">山脊崎岖度</span>
                <NumericCadInput
                  value={draft.ridgeAmp}
                  ariaLabel="山脊崎岖度"
                  testId="seed-ridge-amp-input"
                  className="h-7 w-full"
                  onChangeValue={(v) => setDraft((p) => ({ ...p, ridgeAmp: v }))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">山脉噪声频率</span>
                <NumericCadInput
                  value={draft.ridgeFreq}
                  ariaLabel="山脉噪声频率"
                  testId="seed-ridge-freq-input"
                  className="h-7 w-full"
                  onChangeValue={(v) => setDraft((p) => ({ ...p, ridgeFreq: v }))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">陨石坑数量</span>
                <NumericCadInput
                  value={draft.craterCount}
                  minValid={0}
                  integer
                  unit="个"
                  ariaLabel="陨石坑数量"
                  testId="seed-crater-count-input"
                  className="h-7 w-full"
                  onChangeValue={(v) => setDraft((p) => ({ ...p, craterCount: v }))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">陨石坑深度</span>
                <NumericCadInput
                  value={draft.craterDepth}
                  unit="m"
                  ariaLabel="陨石坑深度"
                  testId="seed-crater-depth-input"
                  className="h-7 w-full"
                  onChangeValue={(v) => setDraft((p) => ({ ...p, craterDepth: v }))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">地下洞穴孔隙率</span>
                <NumericCadInput
                  value={draft.caveDensity}
                  minValid={0}
                  unit="x"
                  ariaLabel="地下洞穴孔隙率"
                  testId="seed-cave-input"
                  className="h-7 w-full"
                  onChangeValue={(v) => setDraft((p) => ({ ...p, caveDensity: v }))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">晶矿脉丰度</span>
                <NumericCadInput
                  value={draft.crystalRichness}
                  ariaLabel="晶矿脉丰度"
                  testId="seed-crystal-input"
                  className="h-7 w-full"
                  onChangeValue={(v) =>
                    setDraft((p) => ({ ...p, crystalRichness: v }))
                  }
                />
              </label>

              <div className="col-span-2 sm:col-span-3 flex items-center justify-between pt-2 border-t border-slate-800/80">
                <span className="text-[11px] text-slate-300">
                  天然岩石拱桥地标 · 体素网格自动缩放至 ±{(draft.radius * 1.54).toFixed(2)}m
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() =>
                    setDraft((p) => ({ ...p, hasArch: !p.hasArch }))
                  }
                  className={`h-7 px-2.5 rounded-xs border text-[11px] cursor-pointer ${
                    draft.hasArch
                      ? 'border-emerald-400 bg-emerald-950/50 text-emerald-200'
                      : 'border-slate-700 bg-[#050810] text-slate-400'
                  }`}
                >
                  拱桥地标: {draft.hasArch ? '开启' : '关闭'}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                tabIndex={-1}
                data-testid="apply-seed-btn"
                onClick={() => {
                  onGenerateWithSeed(draft);
                  setStatusMsg(`已按种子 #${draft.seed} (R=${draft.radius}m) 生成星球`);
                }}
                className="flex-1 h-8 rounded-xs bg-sky-500 hover:bg-sky-400 text-slate-950 font-display font-semibold text-xs cursor-pointer transition-colors"
              >
                应用参数并生成星球
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  setDraft({ ...DEFAULT_SEED_CONFIG });
                  setSeedText(String(DEFAULT_SEED_CONFIG.seed));
                }}
                className="h-8 px-3 rounded-xs border border-slate-700 hover:border-slate-500 text-xs text-slate-300 cursor-pointer"
              >
                恢复默认
              </button>
            </div>
          </div>

          {/* Right: IndexedDB Persistence & Save Slots */}
          <div className="lg:col-span-5 flex flex-col gap-2.5 border-t lg:border-t-0 lg:border-l border-slate-800 pt-3 lg:pt-0 lg:pl-4">
            <div className="flex items-center justify-between">
              <span className="font-display font-semibold text-xs text-white">
                体素持久化存档 (IndexedDB)
              </span>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onToggleAutoSave(!autoSaveEnabled)}
                className={`h-6 px-2 rounded-xs border text-[10px] cursor-pointer ${
                  autoSaveEnabled
                    ? 'border-emerald-400/70 bg-emerald-950/50 text-emerald-200'
                    : 'border-slate-700 bg-[#0d1322] text-slate-400'
                }`}
              >
                自动保存: {autoSaveEnabled ? '开' : '关'}
              </button>
            </div>

            <div className="flex gap-1.5">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="输入存档名称..."
                className="flex-1 min-w-0 h-7 rounded-xs border border-slate-700 bg-[#050810] px-2.5 text-xs text-white focus:border-sky-400 focus:outline-none"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => void handleQuickSave()}
                className="h-7 px-3 rounded-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs cursor-pointer shrink-0 transition-colors"
              >
                保存当前星球
              </button>
            </div>

            {statusMsg && (
              <div className="rounded-xs border border-sky-500/40 bg-sky-950/40 px-2.5 py-1.5 text-[11px] text-sky-200">
                {statusMsg}
              </div>
            )}

            <div className="flex-1 min-h-[180px] max-h-[320px] overflow-y-auto space-y-1.5 pr-1">
              {saves.length === 0 ? (
                <div className="rounded-xs border border-slate-800 bg-[#0d1322] p-4 text-[11px] text-slate-400 text-center">
                  暂无本地存档。点击「保存当前星球」即可把完整体素网格与流体粒子持久化存储。
                </div>
              ) : (
                saves.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-xs border border-slate-800 bg-[#0d1322] p-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {s.isAutosave ? '自动存档 · ' : ''}
                        {s.name}
                      </div>
                      <div className="font-mono-tabular text-[10px] text-slate-400 mt-0.5">
                        #{s.seed} · R={s.radius}m · 水={s.waterParticles}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(s.updatedAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => {
                          void onLoadSlot(s.id).then(() =>
                            setStatusMsg(`已加载「${s.name}」`),
                          );
                        }}
                        className="h-6 px-2 rounded-xs border border-sky-500/60 hover:bg-sky-500/20 text-[11px] text-sky-200 cursor-pointer"
                      >
                        加载
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => void onDeleteSlot(s.id)}
                        className="h-6 px-2 rounded-xs border border-slate-700 hover:border-rose-500/70 text-[11px] text-slate-400 hover:text-rose-300 cursor-pointer"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
