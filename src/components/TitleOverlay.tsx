import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  RotateCcw,
  Shuffle,
  Star,
  Trash2,
} from 'lucide-react';
import { OfflineIndicator } from './OfflineIndicator';
import { PWAInstallButton } from './PWAInstallButton';
import { NumericCadInput } from './NumericCadInput';
import {
  decodeSeedCode,
  encodeSeedCode,
  hashSeedString,
  PlanetSeedConfig,
} from '../engine/voxelPlanet';
import { buildNewTabLaunchUrl, PlanetSaveSummary } from '../engine/persistence';
import {
  computeTilePlanetPreview,
  createCustomSeedTile,
  loadSeedTiles,
  PlanetTileItem,
  resetStarterTiles,
  saveSeedTiles,
  TILE_ACCENT_PALETTE,
} from '../engine/seedTiles';

interface TitleOverlayProps {
  saves: PlanetSaveSummary[];
  initialSeedConfig?: PlanetSeedConfig;
  isGenerating: boolean;
  onGenerateAndEnter: (seedConfig: PlanetSeedConfig) => void;
  onLoadSaveSlot: (slotId: string) => void;
  onDeleteSaveSlot: (slotId: string) => void;
}

type TileTab = 'all' | 'pinned' | 'saves';

const PlanetPreviewDisc: React.FC<{
  config: PlanetSeedConfig;
  size?: number;
}> = ({ config, size = 56 }) => {
  const preview = useMemo(() => computeTilePlanetPreview(config), [config]);
  const clipId = useMemo(
    () => `planet-clip-${Math.abs(config.seed)}-${Math.round(config.radius * 10)}-${Math.round(config.waterFill * 100)}`,
    [config.radius, config.seed, config.waterFill],
  );

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="32" cy="32" r="22" />
        </clipPath>
        <radialGradient id={`${clipId}-shade`} cx="35%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="65%" stopColor="#050810" stopOpacity="0.0" />
          <stop offset="100%" stopColor="#02040a" stopOpacity="0.65" />
        </radialGradient>
      </defs>

      {/* Atmospheric rim */}
      <circle
        cx="32"
        cy="32"
        r="24.5"
        fill="none"
        stroke={preview.atmoColor}
        strokeWidth="1.2"
        strokeOpacity="0.42"
      />

      {/* Rock arch indicator if enabled */}
      {config.hasArch && (
        <path
          d="M 43 13 A 9 9 0 0 1 51 22"
          fill="none"
          stroke="#cbd5e1"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      )}

      <g clipPath={`url(#${clipId})`}>
        {/* Base Crust */}
        <circle cx="32" cy="32" r="22" fill={preview.landColor} />

        {/* Ocean basins */}
        {preview.waterOpacity > 0.02 && (
          <>
            <ellipse
              cx={26 + preview.continentShiftX * 0.4}
              cy={34 + preview.continentShiftY * 0.3}
              rx={16 * Math.min(1.2, 0.5 + config.waterFill * 0.35)}
              ry={12 * Math.min(1.2, 0.5 + config.waterFill * 0.3)}
              fill={preview.oceanColor}
              opacity={preview.waterOpacity}
            />
            <ellipse
              cx={42 - preview.continentShiftX * 0.3}
              cy={24 - preview.continentShiftY * 0.25}
              rx="11"
              ry="8"
              fill={preview.oceanColor}
              opacity={preview.waterOpacity * 0.9}
            />
          </>
        )}

        {/* Mountain ridge band */}
        <path
          d={`M 10 ${32 + preview.continentShiftY * 0.4} Q 28 ${18 - config.ridgeAmp * 1.6}, 54 ${35 - preview.continentShiftY * 0.4}`}
          fill="none"
          stroke={preview.ridgeColor}
          strokeWidth={Math.min(6, Math.max(1.5, config.ridgeAmp * 1.15))}
          strokeLinecap="round"
          opacity="0.72"
        />

        {/* Polar Ice Caps */}
        <ellipse cx="32" cy="11" rx="15" ry="5" fill="#e0f2fe" opacity={preview.iceOpacity} />
        <ellipse cx="32" cy="53" rx="14" ry="4.5" fill="#e0f2fe" opacity={preview.iceOpacity * 0.85} />

        {/* Crater rings */}
        {preview.craters.map((cr, idx) => (
          <circle
            key={idx}
            cx={cr.cx}
            cy={cr.cy}
            r={cr.r}
            fill="#090d18"
            fillOpacity="0.35"
            stroke="#94a3b8"
            strokeOpacity="0.45"
            strokeWidth="0.9"
          />
        ))}

        {/* Crystal vein sparkle */}
        {config.crystalRichness > 0.45 && (
          <circle cx="24" cy="40" r="1.8" fill={preview.crystalGlow} opacity="0.85" />
        )}

        {/* Spherical light/shadow overlay */}
        <circle cx="32" cy="32" r="22" fill={`url(#${clipId}-shade)`} />
      </g>
    </svg>
  );
};

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  saves,
  initialSeedConfig,
  isGenerating,
  onGenerateAndEnter,
  onLoadSaveSlot,
  onDeleteSaveSlot,
}) => {
  const [tiles, setTiles] = useState<PlanetTileItem[]>(() => {
    const loaded = loadSeedTiles();
    if (initialSeedConfig) {
      const code = encodeSeedCode(initialSeedConfig);
      const match = loaded.find((t) => encodeSeedCode(t.config) === code);
      if (!match) {
        const injected = createCustomSeedTile(
          initialSeedConfig,
          `链接方案 #${initialSeedConfig.seed}`,
          '来自 URL 种子参数，可直接编辑与保存',
        );
        return [injected, ...loaded];
      }
    }
    return loaded;
  });

  const [selectedId, setSelectedId] = useState<string>(() => tiles[0]?.id ?? '');
  const [activeTab, setActiveTab] = useState<TileTab>('all');
  const [inlineRenameId, setInlineRenameId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [seedText, setSeedText] = useState<string>('');
  const [codeInput, setCodeInput] = useState<string>('');
  const [codeNotice, setCodeNotice] = useState<string | null>(null);

  useEffect(() => {
    saveSeedTiles(tiles);
  }, [tiles]);

  const selectedTile = useMemo(
    () => tiles.find((t) => t.id === selectedId) ?? tiles[0] ?? null,
    [selectedId, tiles],
  );

  useEffect(() => {
    if (!selectedTile) return;
    setSeedText(String(selectedTile.config.seed));
    setCodeInput(encodeSeedCode(selectedTile.config));
    setCodeNotice(null);
  }, [selectedTile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedTile) return;
    setCodeInput(encodeSeedCode(selectedTile.config));
  }, [selectedTile?.config]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSelectedTile = (
    updater: (tile: PlanetTileItem) => PlanetTileItem,
  ) => {
    if (!selectedTile) return;
    const targetId = selectedTile.id;
    setTiles((prev) =>
      prev.map((t) =>
        t.id === targetId ? { ...updater(t), updatedAt: Date.now() } : t,
      ),
    );
  };

  const updateSelectedConfig = (partial: Partial<PlanetSeedConfig>) => {
    updateSelectedTile((tile) => ({
      ...tile,
      config: { ...tile.config, ...partial },
    }));
  };

  const handleAddTile = () => {
    const newTile = createCustomSeedTile(
      selectedTile
        ? {
            ...selectedTile.config,
            seed: Math.floor(100000 + Math.random() * 899999),
          }
        : undefined,
    );
    setTiles((prev) => [...prev, newTile]);
    setSelectedId(newTile.id);
    setActiveTab('all');
  };

  const handleDuplicateTile = (source: PlanetTileItem) => {
    const clone = createCustomSeedTile(
      { ...source.config },
      `${source.title} · 副本`,
      source.notes,
      source.accent,
    );
    setTiles((prev) => {
      const idx = prev.findIndex((t) => t.id === source.id);
      if (idx === -1) return [...prev, clone];
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
    setSelectedId(clone.id);
    setActiveTab('all');
  };

  const handleTogglePin = (id: string) => {
    setTiles((prev) =>
      prev.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)),
    );
  };

  const handleDeleteTile = (id: string) => {
    setTiles((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? '');
      }
      return next;
    });
  };

  const handleResetPresets = () => {
    const fresh = resetStarterTiles();
    setTiles(fresh);
    setSelectedId(fresh[0]?.id ?? '');
    setActiveTab('all');
  };

  const handleApplyCode = () => {
    const decoded = decodeSeedCode(codeInput);
    if (!decoded) {
      setCodeNotice('种子编码无效（支持 TS3|... / TS2|... / TS1-...）');
      return;
    }
    updateSelectedConfig(decoded);
    setSeedText(String(decoded.seed));
    setCodeNotice('已将编码参数写入当前磁贴');
  };

  const handleRandomSeed = () => {
    const nextSeed = Math.floor(100000 + Math.random() * 899999);
    setSeedText(String(nextSeed));
    updateSelectedConfig({ seed: nextSeed });
  };

  const filteredTiles = useMemo(() => {
    if (activeTab === 'pinned') {
      return tiles.filter((t) => t.pinned);
    }
    return tiles;
  }, [activeTab, tiles]);

  const selectedLaunchUrl = useMemo(() => {
    if (!selectedTile) return '?autostart=1';
    return buildNewTabLaunchUrl(selectedTile.config);
  }, [selectedTile]);

  const latestSave = saves[0];

  return (
    <div
      data-testid="title-launcher"
      className="fixed inset-0 z-20 flex flex-col bg-[#050810]/72 backdrop-blur-[2px] text-slate-200 overflow-hidden"
    >
      {/* Subtle CAD coordinate grid scrim */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(56,189,248,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.08) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Top 3-Zone Engineering Strip */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-2 px-4 md:px-6 py-3 border-b border-slate-800/90 bg-[#090d18]/92">
        {/* Left: Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <svg
            viewBox="0 0 56 56"
            className="w-8 h-8 shrink-0"
            aria-hidden="true"
          >
            <circle
              cx="28"
              cy="28"
              r="18"
              fill="#0c192c"
              stroke="#38bdf8"
              strokeWidth="2"
            />
            <path
              d="M12 24 C19 18, 28 21, 35 16 C40 13, 44 17, 45 22"
              fill="none"
              stroke="#34d399"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <ellipse
              cx="28"
              cy="28"
              rx="25"
              ry="8"
              transform="rotate(-22 28 28)"
              fill="none"
              stroke="#f97316"
              strokeWidth="1.6"
              strokeDasharray="4 3"
            />
          </svg>
          <div className="min-w-0">
            <h1 className="font-display text-lg md:text-xl font-bold tracking-tight text-white leading-none">
              TerraSphere
            </h1>
            <p className="text-[11px] text-slate-400 font-mono-tabular mt-1 truncate">
              选定或编辑星球种子磁贴，随后异步生成并进入世界
            </p>
          </div>
        </div>

        {/* Center: Tile View Filter & Expansion Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              { id: 'all', label: `全部磁贴 (${tiles.length})` },
              {
                id: 'pinned',
                label: `已收藏 (${tiles.filter((t) => t.pinned).length})`,
              },
              { id: 'saves', label: `本地存档 (${saves.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-testid={`tile-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`h-7 px-2.5 rounded-xs border text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === tab.id
                  ? 'border-sky-400 bg-sky-950/70 text-sky-200'
                  : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}

          <button
            type="button"
            data-testid="add-seed-tile-top-btn"
            onClick={handleAddTile}
            className="h-7 px-2.5 rounded-xs border border-emerald-500/60 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-200 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>新建磁贴</span>
          </button>

          <button
            type="button"
            onClick={handleResetPresets}
            title="恢复内置初始磁贴"
            className="h-7 px-2 rounded-xs border border-slate-800 bg-[#0d1322] hover:border-slate-600 text-slate-400 hover:text-slate-200 text-[11px] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3 h-3 shrink-0" />
            <span>重置预设</span>
          </button>
        </div>

        {/* Right: Offline / PWA / Open in New Tab */}
        <div className="flex items-center gap-2 shrink-0">
          <OfflineIndicator />
          <PWAInstallButton />
          <a
            href={selectedLaunchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="h-8 px-2.5 rounded-xs border border-slate-700/90 bg-[#0d1322] hover:border-sky-400/80 text-xs font-medium text-slate-200 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>新标签页打开</span>
          </a>
        </div>
      </header>

      {/* Main Content: Tile Grid + Selected Tile Editor */}
      <div className="relative z-10 flex-1 min-h-0 max-w-7xl w-full mx-auto px-4 md:px-6 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-y-auto lg:overflow-hidden">
        {/* Left: Expandable Editable Tile Grid */}
        <section className="lg:col-span-7 flex flex-col min-h-0 lg:overflow-y-auto lg:pr-1">
          {activeTab === 'saves' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {saves.length === 0 ? (
                <div className="sm:col-span-2 rounded-sm border border-slate-800 bg-[#090d18]/90 p-8 text-center text-xs text-slate-400">
                  暂无 IndexedDB 本地存档。选择左侧磁贴生成世界后，可随时自动或手动保存地形进度。
                </div>
              ) : (
                saves.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-sm border border-slate-800 bg-[#090d18]/92 border-t-2 border-t-emerald-400 p-3 flex flex-col justify-between gap-2.5"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm font-semibold text-white truncate">
                          {s.isAutosave ? '自动存档 · ' : ''}
                          {s.name}
                        </span>
                        <span className="font-mono-tabular text-[10px] text-emerald-300 shrink-0">
                          #{s.seed}
                        </span>
                      </div>
                      <div className="font-mono-tabular text-[11px] text-slate-400 mt-1">
                        R₀={s.radius}m · 流体粒子={s.waterParticles}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {new Date(s.updatedAt).toLocaleString('zh-CN')}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/80">
                      <button
                        type="button"
                        disabled={isGenerating}
                        onClick={() => onLoadSaveSlot(s.id)}
                        className="flex-1 h-7 rounded-xs bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs whitespace-nowrap cursor-pointer"
                      >
                        载入此存档进入
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSaveSlot(s.id)}
                        className="h-7 px-2 rounded-xs border border-slate-700 hover:border-rose-500/70 text-slate-400 hover:text-rose-300 text-xs cursor-pointer"
                        aria-label={`删除存档 ${s.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pb-2">
              {filteredTiles.map((tile) => {
                const isSelected = selectedTile?.id === tile.id;
                const isRenaming = inlineRenameId === tile.id;

                return (
                  <div
                    key={tile.id}
                    data-testid={`seed-tile-${tile.id}`}
                    onClick={() => setSelectedId(tile.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.target === e.currentTarget) {
                        setSelectedId(tile.id);
                      }
                    }}
                    className={`group rounded-sm border bg-[#090d18]/92 p-3 flex flex-col justify-between gap-2.5 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-sky-400 ring-1 ring-sky-400/30 bg-[#0c1324]'
                        : 'border-slate-800 hover:border-slate-600'
                    }`}
                    style={{ borderTopWidth: '2px', borderTopColor: tile.accent }}
                  >
                    <div className="flex items-start gap-2.5">
                      <PlanetPreviewDisc config={tile.config} size={54} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          {isRenaming ? (
                            <input
                              type="text"
                              autoFocus
                              value={tile.title}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const v = e.target.value;
                                setTiles((prev) =>
                                  prev.map((t) =>
                                    t.id === tile.id
                                      ? { ...t, title: v, updatedAt: Date.now() }
                                      : t,
                                  ),
                                );
                              }}
                              onBlur={() => setInlineRenameId(null)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  setInlineRenameId(null);
                                }
                              }}
                              className="w-full h-6 rounded-xs border border-sky-400 bg-[#050810] px-1.5 text-xs font-semibold text-white focus:outline-none"
                            />
                          ) : (
                            <div className="font-display text-sm font-semibold text-white truncate">
                              {tile.title || '未命名星球'}
                            </div>
                          )}

                          {tile.pinned && (
                            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
                          )}
                        </div>

                        <div className="font-mono-tabular text-[11px] text-sky-300/90 mt-0.5 truncate">
                          #{tile.config.seed} · R={tile.config.radius}m ·{' '}
                          {tile.config.voxelRadius >= 1000
                            ? `${(tile.config.voxelRadius / 1000).toFixed(tile.config.voxelRadius % 1000 === 0 ? 0 : 1)}k`
                            : tile.config.voxelRadius}
                          块
                        </div>

                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-snug">
                          {tile.notes || '点击右侧参数工作台自定义地形与水体'}
                        </p>
                      </div>
                    </div>

                    {/* Tile Metadata & Quick Edit Actions */}
                    <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-800/80 text-[10px] font-mono-tabular text-slate-400">
                      <span className="truncate">
                        水{Math.round(tile.config.waterFill * 100)}% · 坑{tile.config.craterCount} ·{' '}
                        {tile.config.hasArch ? '岩拱' : '无拱'}
                      </span>

                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          title="重命名磁贴"
                          data-testid={`tile-rename-${tile.id}`}
                          onClick={() => {
                            setSelectedId(tile.id);
                            setInlineRenameId(tile.id);
                          }}
                          className="p-1 rounded-xs border border-transparent hover:border-slate-700 text-slate-400 hover:text-white cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          title={tile.pinned ? '取消收藏' : '收藏磁贴'}
                          data-testid={`tile-pin-${tile.id}`}
                          onClick={() => handleTogglePin(tile.id)}
                          className={`p-1 rounded-xs border border-transparent hover:border-slate-700 cursor-pointer ${
                            tile.pinned
                              ? 'text-amber-400'
                              : 'text-slate-400 hover:text-amber-300'
                          }`}
                        >
                          <Star className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          title="复制拓展为新磁贴"
                          data-testid={`tile-clone-${tile.id}`}
                          onClick={() => handleDuplicateTile(tile)}
                          className="p-1 rounded-xs border border-transparent hover:border-slate-700 text-slate-400 hover:text-sky-300 cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        {tiles.length > 1 && (
                          <button
                            type="button"
                            title="删除磁贴"
                            data-testid={`tile-delete-${tile.id}`}
                            onClick={() => handleDeleteTile(tile.id)}
                            className="p-1 rounded-xs border border-transparent hover:border-rose-500/50 text-slate-500 hover:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Expandable "+ New Custom Tile" Card */}
              <button
                type="button"
                data-testid="add-seed-tile-btn"
                onClick={handleAddTile}
                className="min-h-[122px] rounded-sm border border-dashed border-slate-700 hover:border-sky-400/80 bg-[#090d18]/45 hover:bg-[#0d1322]/80 p-4 flex flex-col items-center justify-center gap-1.5 text-slate-400 hover:text-sky-300 transition-colors cursor-pointer"
              >
                <Plus className="w-5 h-5" />
                <span className="font-display text-xs font-semibold">
                  拓展新星球磁贴
                </span>
                <span className="text-[10px] text-slate-500">
                  自由编辑名称、种子、半径与分辨率并永久保存
                </span>
              </button>
            </div>
          )}
        </section>

        {/* Right: Selected Tile Live Inspector & Launch Console */}
        <aside className="lg:col-span-5 flex flex-col min-h-0 rounded-sm border border-slate-800 bg-[#090d18]/95 overflow-hidden">
          {selectedTile ? (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3">
                {/* Identity & Live Preview Header */}
                <div className="flex items-start gap-3 pb-3 border-b border-slate-800">
                  <PlanetPreviewDisc config={selectedTile.config} size={60} />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <input
                      type="text"
                      aria-label="磁贴名称"
                      data-testid="tile-title-input"
                      value={selectedTile.title}
                      onChange={(e) =>
                        updateSelectedTile((t) => ({ ...t, title: e.target.value }))
                      }
                      placeholder="输入星球磁贴名称..."
                      className="w-full h-7 rounded-xs border border-slate-700 bg-[#050810] px-2 font-display text-sm font-semibold text-white focus:border-sky-400 focus:outline-none"
                    />
                    <input
                      type="text"
                      aria-label="磁贴备注"
                      data-testid="tile-notes-input"
                      value={selectedTile.notes}
                      onChange={(e) =>
                        updateSelectedTile((t) => ({ ...t, notes: e.target.value }))
                      }
                      placeholder="添加星系注释、地貌说明..."
                      className="w-full h-6 rounded-xs border border-slate-800 bg-[#050810] px-2 text-[11px] text-slate-300 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Accent Swatches + Seed String */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                  <div className="sm:col-span-7">
                    <label className="block text-[10px] text-slate-400 mb-1">
                      主种子 (支持任意数字或文本哈希)
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        data-testid="title-seed-input"
                        value={seedText}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSeedText(v);
                          updateSelectedConfig({
                            seed: hashSeedString(v || '1'),
                          });
                        }}
                        className="flex-1 min-w-0 h-7 rounded-xs border border-slate-700 bg-[#050810] px-2 text-xs font-mono-tabular text-white focus:border-sky-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        data-testid="title-random-seed-btn"
                        onClick={handleRandomSeed}
                        className="h-7 px-2 rounded-xs border border-slate-700 hover:border-sky-400 text-[11px] text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Shuffle className="w-3 h-3 text-sky-400" />
                        <span>随机</span>
                      </button>
                    </div>
                  </div>

                  <div className="sm:col-span-5">
                    <span className="block text-[10px] text-slate-400 mb-1">
                      磁贴色标
                    </span>
                    <div className="flex items-center gap-1.5 h-7">
                      {TILE_ACCENT_PALETTE.map((col) => (
                        <button
                          key={col}
                          type="button"
                          aria-label={`色标 ${col}`}
                          onClick={() =>
                            updateSelectedTile((t) => ({ ...t, accent: col }))
                          }
                          className={`w-4 h-4 rounded-xs cursor-pointer transition-transform ${
                            selectedTile.accent === col
                              ? 'ring-2 ring-white scale-110'
                              : 'opacity-70 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: col }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Core Scale Parameters */}
                <div className="space-y-2.5 rounded-xs border border-slate-800 bg-[#070b15] p-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-400">星球半径 R₀</span>
                      <NumericCadInput
                        value={selectedTile.config.radius}
                        minValid={0.05}
                        unit="m"
                        ariaLabel="星球半径"
                        testId="title-radius-input"
                        sliderScale="log"
                        sliderMin={1}
                        sliderMax={20000}
                        onChangeValue={(v) => updateSelectedConfig({ radius: v })}
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-400">初始水体倍率</span>
                      <NumericCadInput
                        value={selectedTile.config.waterFill}
                        minValid={0}
                        unit="x"
                        ariaLabel="初始水体倍率"
                        testId="title-water-input"
                        sliderMin={0}
                        sliderMax={3}
                        sliderStep={0.05}
                        onChangeValue={(v) => updateSelectedConfig({ waterFill: v })}
                      />
                    </label>
                  </div>

                  {/* Voxel Resolution Control */}
                  <div className="pt-2 border-t border-slate-800/80 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-sky-300 font-medium">
                        体素分辨率 (方块半径)
                      </span>
                      <span className="text-[10px] font-mono-tabular text-slate-400">
                        单块{' '}
                        {(
                          selectedTile.config.radius /
                          Math.max(4, selectedTile.config.voxelRadius)
                        ).toPrecision(3)}
                        m ·{' '}
                        {Math.round(
                          Math.max(4, selectedTile.config.voxelRadius) * 2 * 1.54,
                        ).toLocaleString()}
                        ³
                      </span>
                    </div>

                    <NumericCadInput
                      value={selectedTile.config.voxelRadius}
                      minValid={4}
                      integer
                      unit="块"
                      ariaLabel="体素方块半径"
                      testId="title-voxel-res-input"
                      sliderScale="log"
                      sliderMin={6}
                      sliderMax={50000}
                      onChangeValue={(v) => updateSelectedConfig({ voxelRadius: v })}
                    />

                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      {[18, 64, 512, 5000, 20000, 50000].map((res) => (
                        <button
                          key={res}
                          type="button"
                          onClick={() => updateSelectedConfig({ voxelRadius: res })}
                          className={`px-1.5 py-0.5 rounded-xs border text-[10px] font-mono-tabular cursor-pointer transition-colors ${
                            Math.round(selectedTile.config.voxelRadius) === res
                              ? 'border-sky-400 bg-sky-950/70 text-sky-200'
                              : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
                          }`}
                        >
                          {res >= 1000 ? `${res / 1000}k` : res}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Expandable Advanced Geology & TS3 Code */}
                <div className="rounded-xs border border-slate-800 bg-[#070b15]">
                  <button
                    type="button"
                    data-testid="toggle-advanced-seed-btn"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="w-full px-2.5 py-2 flex items-center justify-between text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer"
                  >
                    <span>高级地质、洞穴与复合编码 (TS3)</span>
                    {advancedOpen ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>

                  {advancedOpen && (
                    <div className="px-2.5 pb-2.5 pt-1 border-t border-slate-800/80 space-y-2.5">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] text-slate-400">大陆起伏</span>
                          <NumericCadInput
                            value={selectedTile.config.continentAmp}
                            sliderMin={0}
                            sliderMax={8}
                            sliderStep={0.1}
                            onChangeValue={(v) =>
                              updateSelectedConfig({ continentAmp: v })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] text-slate-400">山脊崎岖</span>
                          <NumericCadInput
                            value={selectedTile.config.ridgeAmp}
                            sliderMin={0}
                            sliderMax={8}
                            sliderStep={0.1}
                            onChangeValue={(v) =>
                              updateSelectedConfig({ ridgeAmp: v })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] text-slate-400">山脉频率</span>
                          <NumericCadInput
                            value={selectedTile.config.ridgeFreq}
                            sliderMin={0.4}
                            sliderMax={10}
                            sliderStep={0.1}
                            onChangeValue={(v) =>
                              updateSelectedConfig({ ridgeFreq: v })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] text-slate-400">陨石坑数</span>
                          <NumericCadInput
                            value={selectedTile.config.craterCount}
                            minValid={0}
                            integer
                            sliderMin={0}
                            sliderMax={48}
                            sliderStep={1}
                            onChangeValue={(v) =>
                              updateSelectedConfig({ craterCount: v })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] text-slate-400">陨石坑深</span>
                          <NumericCadInput
                            value={selectedTile.config.craterDepth}
                            sliderMin={0}
                            sliderMax={12}
                            sliderStep={0.1}
                            onChangeValue={(v) =>
                              updateSelectedConfig({ craterDepth: v })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] text-slate-400">地下洞穴</span>
                          <NumericCadInput
                            value={selectedTile.config.caveDensity}
                            minValid={0}
                            sliderMin={0}
                            sliderMax={3}
                            sliderStep={0.05}
                            onChangeValue={(v) =>
                              updateSelectedConfig({ caveDensity: v })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] text-slate-400">晶矿丰度</span>
                          <NumericCadInput
                            value={selectedTile.config.crystalRichness}
                            sliderMin={0}
                            sliderMax={3}
                            sliderStep={0.05}
                            onChangeValue={(v) =>
                              updateSelectedConfig({ crystalRichness: v })
                            }
                          />
                        </label>
                        <div className="flex flex-col justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              updateSelectedConfig({
                                hasArch: !selectedTile.config.hasArch,
                              })
                            }
                            className={`h-7 px-2 rounded-xs border text-[11px] cursor-pointer ${
                              selectedTile.config.hasArch
                                ? 'border-emerald-400 bg-emerald-950/50 text-emerald-200'
                                : 'border-slate-700 bg-[#050810] text-slate-400'
                            }`}
                          >
                            岩拱地标: {selectedTile.config.hasArch ? '开启' : '关闭'}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          复合种子编码 (可粘贴导入或分享)
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
                            onClick={handleApplyCode}
                            className="h-7 px-2 rounded-xs border border-slate-700 hover:border-emerald-400 text-[11px] text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            解析
                          </button>
                        </div>
                        {codeNotice && (
                          <p className="text-[10px] text-sky-300 mt-1">{codeNotice}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Primary Launch Action Footer */}
              <div className="p-3.5 border-t border-slate-800 bg-[#0d1322] space-y-2">
                <button
                  type="button"
                  data-start="true"
                  data-testid="enter-selected-world-btn"
                  disabled={isGenerating}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onGenerateAndEnter(selectedTile.config);
                  }}
                  className="w-full h-10 rounded-xs bg-sky-500 hover:bg-sky-400 active:bg-sky-600 disabled:opacity-50 text-slate-950 font-display font-bold text-sm tracking-wide transition-colors cursor-pointer whitespace-nowrap"
                >
                  生成并进入该星球 · #{selectedTile.config.seed}
                </button>

                {latestSave && (
                  <button
                    type="button"
                    data-testid="continue-saved-btn"
                    disabled={isGenerating}
                    onClick={() => onLoadSaveSlot(latestSave.id)}
                    className="w-full h-8 rounded-xs border border-emerald-500/50 bg-emerald-950/35 hover:bg-emerald-900/45 disabled:opacity-50 text-emerald-200 text-xs font-medium transition-colors cursor-pointer truncate px-2"
                  >
                    继续最近存档 · {latestSave.name} (#{latestSave.seed})
                  </button>
                )}
              </div>
            </>
          ) : null}
        </aside>
      </div>

      {/* Bottom Engineering Control Hint */}
      <footer className="relative z-10 px-4 md:px-6 py-2 border-t border-slate-800/80 bg-[#090d18]/90 text-[11px] text-slate-400 font-mono-tabular flex flex-wrap items-center justify-between gap-2">
        <span>
          磁贴编辑自动保存至本地 · 启动时不再预生成默认星球 · 异步分片构建不阻塞界面
        </span>
        <span>WASD 移动 · Space 跳跃 · Tab 视角 · V 方块模式 · N 地图 · C 大气 · F3 调试</span>
      </footer>
    </div>
  );
};
