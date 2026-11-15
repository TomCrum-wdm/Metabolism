import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../pwa/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      data-testid="offline-indicator"
      className="h-7 px-2 rounded-xs border border-amber-500/70 bg-amber-950/70 text-amber-200 text-[11px] font-mono-tabular flex items-center gap-1.5 whitespace-nowrap shrink-0"
      title="当前处于离线状态 — 本地 IndexedDB 与 PWA 缓存正常工作"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0 text-amber-300" />
      <span>离线运行</span>
    </div>
  );
};
