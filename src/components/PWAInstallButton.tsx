import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../pwa/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        tabIndex={-1}
        data-testid="pwa-install-btn"
        onClick={(e) => {
          e.currentTarget.blur();
          void install();
        }}
        title="安装 TerraSphere 为离线桌面/移动 PWA 应用"
        className={
          compact
            ? 'h-7 px-2 rounded-xs border border-emerald-500/60 bg-emerald-950/50 hover:bg-emerald-900/60 text-[11px] font-medium text-emerald-200 transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0'
            : 'px-3.5 py-2 rounded-sm border border-emerald-500/60 bg-emerald-950/50 hover:bg-emerald-900/60 text-xs font-medium text-emerald-200 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0'
        }
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>离线安装 PWA</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          tabIndex={-1}
          data-testid="pwa-ios-install-btn"
          onClick={(e) => {
            e.currentTarget.blur();
            setShowIOSGuide(true);
          }}
          title="在 iOS Safari 添加到主屏幕离线运行"
          className={
            compact
              ? 'h-7 px-2 rounded-xs border border-slate-700 hover:border-emerald-400/70 bg-slate-900/80 text-[11px] font-medium text-slate-200 transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0'
              : 'px-3.5 py-2 rounded-sm border border-slate-700 hover:border-emerald-400/70 bg-slate-900/80 text-xs font-medium text-slate-200 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0'
          }
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          <span>添加到主屏幕</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 pointer-events-auto">
            <div className="w-full max-w-xs rounded-sm border border-slate-700 bg-[#0b101d] p-4 text-slate-200">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                <h3 className="font-display text-sm font-semibold text-white">
                  在 iOS / iPadOS 安装离线版
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                1. 点击 Safari 工具栏中的 <strong>分享</strong> 按钮。<br />
                2. 向下滑动并选择 <strong>添加到主屏幕</strong>，即可全屏离线运行。
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full h-8 rounded-xs border border-slate-700 bg-slate-900 hover:border-sky-400 text-xs font-medium text-slate-100 cursor-pointer"
              >
                知道了
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
