import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Aperture,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Crosshair,
  Download,
  Eye,
  Film,
  Flame,
  FolderOpen,
  Grid,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  Save,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  bakeShotActionIntoProject,
  computeProjectFrameRange,
  CubicBezier4,
  DIRECTOR_ACTIONS,
  DirectorActionType,
  DirectorAspectMask,
  DirectorCameraKeyframe,
  DirectorEnvKeyframe,
  DirectorExportFormat,
  DirectorLutPreset,
  DirectorParamId,
  DirectorParamKeyframe,
  DirectorPostFxKeyframe,
  DirectorRenderProgress,
  DirectorSceneAnchor,
  DirectorShotPlan,
  DirectorTimelineProject,
  DirectorVisualFilter,
  DirectorWorldEvent,
  DirectorWorldEventType,
  evaluateCameraTrackPose,
  evaluateEnvironmentTrack,
  evaluateFullTimelineAtTime,
  evaluatePostFxTrack,
  formatSmpteTimecode,
  FPS_PRESETS,
  LUT_PRESET_META,
  PARAM_TRACK_META,
  parseDirectorProjectJson,
  RESOLUTION_PRESETS,
  ScreenshotFormat,
  serializeDirectorProjectJson,
  upsertParamKeyframe,
  VISUAL_FILTER_META,
  WORLD_EVENT_META,
} from '../engine/director';
import {
  assembleDirectorJobBlob,
  deleteRenderJobAndAssetsFromDb,
  FrameFilmstripItem,
  getJobFilmstripItems,
  listDirectorProjectsFromDb,
  listRenderJobsFromDb,
  RenderCheckpointJob,
  saveDirectorProjectToDb,
} from '../engine/directorStorage';
import {
  createDefaultDirectorQuality,
  DirectorQualitySettings,
  OfflineAccumSamples,
  OfflineQualityOverride,
  ShadowQualityLevel,
} from '../engine/renderQuality';
import { MaterialId, MATERIAL_NAMES } from '../engine/voxelPlanet';
import { DirectorWorldSnapshot, PlanetarySandboxEngine } from '../engine/webgpuScene';
import { BezierCurveEditor } from './director/BezierCurveEditor';
import { FilmstripGallery, RenderMonitorPane } from './director/RenderMonitorPane';
import { SelectedTimelineItem, TimelineTrackPanel } from './director/TimelineTrackPanel';

export interface DirectorScreenshotResult {
  blob: Blob;
  actualWidth: number;
  actualHeight: number;
  previewDataUrl: string;
  format: ScreenshotFormat;
}

export interface DirectorVideoResult {
  blob: Blob;
  mimeType: string;
  filename: string;
  frameCount: number;
  actualWidth: number;
  actualHeight: number;
  fps: number;
  elapsedMs: number;
  encoderLabel: string;
}

export interface ProgramRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface DirectorCinemaStudioProps {
  engine: PlanetarySandboxEngine;
  project: DirectorTimelineProject;
  hardwareCaps: {
    maxGpuTextureDim: number;
    webCodecsAvailable: boolean;
    mediaRecorderAvailable: boolean;
  };
  onUpdateProject: (
    updater: (prev: DirectorTimelineProject) => DirectorTimelineProject,
  ) => void;
  onReplaceProject: (next: DirectorTimelineProject) => void;
  onProgramRectChange: (rect: ProgramRect | null) => void;
  onClose: () => void;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 12_000);
}

const JOB_STATUS_LABEL: Record<RenderCheckpointJob['status'], string> = {
  rendering: '渲染中',
  paused: '已暂停 · 可续渲染',
  aborted: '已中止 · 保留断点',
  completed: '已完成',
  error: '异常中断',
};

export const DirectorCinemaStudio: React.FC<DirectorCinemaStudioProps> = ({
  engine,
  project,
  hardwareCaps,
  onUpdateProject,
  onReplaceProject,
  onProgramRectChange,
  onClose,
}) => {
  const programSlotRef = useRef<HTMLDivElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const restoreSnapRef = useRef<DirectorWorldSnapshot | null>(null);
  const anchorRef = useRef<DirectorSceneAnchor | null>(null);

  const [programRect, setProgramRect] = useState<ProgramRect | null>(null);
  const [rightTab, setRightTab] = useState<'props' | 'curves' | 'queue'>('props');
  const [playheadSec, setPlayheadSec] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const [loopPlayback, setLoopPlayback] = useState<boolean>(true);
  const [timelineCameraLock, setTimelineCameraLock] = useState<boolean>(true);
  const [showGizmos, setShowGizmos] = useState<boolean>(true);
  const [showGuides, setShowGuides] = useState<boolean>(true);
  const [selectedItem, setSelectedItem] = useState<SelectedTimelineItem>(null);

  const [pickEventTargetId, setPickEventTargetId] = useState<string | null>(null);
  const [bakeAction, setBakeAction] = useState<DirectorActionType>('orbit_360');

  // Persisted projects & render jobs from IndexedDB
  const [savedProjects, setSavedProjects] = useState<DirectorTimelineProject[]>([]);
  const [renderJobs, setRenderJobs] = useState<RenderCheckpointJob[]>([]);

  // Active render state + filmstrip inspector
  const [rendering, setRendering] = useState<boolean>(false);
  const [renderProgress, setRenderProgress] = useState<DirectorRenderProgress | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [studioNotice, setStudioNotice] = useState<string | null>(null);
  const [filmstripFrames, setFilmstripFrames] = useState<FrameFilmstripItem[]>([]);
  const [inspectedFrame, setInspectedFrame] = useState<FrameFilmstripItem | null>(null);

  // Pause & abort coordination refs
  const pauseRequestedRef = useRef<boolean>(false);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const firedPlaybackEventsRef = useRef<Set<string>>(new Set());
  const prevPlayTimeRef = useRef<number>(0);

  // High-res Screenshot Modal state
  const [screenshotModalOpen, setScreenshotModalOpen] = useState<boolean>(false);
  const [shotWidth, setShotWidth] = useState<number>(3840);
  const [shotHeight, setShotHeight] = useState<number>(2160);
  const [shotFormat, setShotFormat] = useState<ScreenshotFormat>('png');
  const [shotHideHelpers, setShotHideHelpers] = useState<boolean>(true);
  const [shotBusy, setShotBusy] = useState<boolean>(false);
  const [lastShotPreview, setLastShotPreview] = useState<{
    dataUrl: string;
    label: string;
  } | null>(null);

  const flashNotice = useCallback((msg: string) => {
    setStudioNotice(msg);
    window.setTimeout(() => {
      setStudioNotice((cur) => (cur === msg ? null : cur));
    }, 2800);
  }, []);

  const refreshDbLists = useCallback(async () => {
    const [projs, jobs] = await Promise.all([
      listDirectorProjectsFromDb(),
      listRenderJobsFromDb(),
    ]);
    setSavedProjects(projs);
    setRenderJobs(jobs);
  }, []);

  // Capture initial pre-shot planetary restore snapshot + anchor on Cinema Studio entry
  useEffect(() => {
    restoreSnapRef.current = engine.exportDirectorWorldRestoreSnapshot();
    anchorRef.current = engine.buildDirectorAnchor();
    engine.setDirectorTimelineLocked(true);
    void refreshDbLists();

    return () => {
      engine.setDirectorTimelineLocked(false);
      engine.updateDirectorGizmoOverlay(null, null, false);
      engine.resetDirectorPostGradingUniforms();
      onProgramRectChange(null);
    };
  }, [engine, onProgramRectChange, refreshDbLists]);

  // Measure Program Monitor container rect so App.tsx docks mountRef seamlessly inside it
  useEffect(() => {
    const el = programSlotRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width >= 32 && r.height >= 32) {
        const next: ProgramRect = {
          top: Math.round(r.top),
          left: Math.round(r.left),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
        setProgramRect(next);
        onProgramRectChange(next);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [onProgramRectChange]);

  // Sync 3D spline trajectory & surface event pins into WebGPU viewport
  useEffect(() => {
    engine.updateDirectorGizmoOverlay(
      project,
      anchorRef.current ?? engine.buildDirectorAnchor(),
      showGizmos && !rendering,
    );
  }, [engine, project, rendering, showGizmos]);

  // Sync camera lock flag with engine
  useEffect(() => {
    engine.setDirectorTimelineLocked(timelineCameraLock || playing || rendering);
  }, [engine, playing, rendering, timelineCameraLock]);

  // Apply full NLE timeline state to live engine when scrubbing
  const applyTimelineAt = useCallback(
    (timeSec: number, triggerEvents: boolean) => {
      if (rendering) return;
      const anchor = anchorRef.current ?? engine.buildDirectorAnchor();
      engine.setDirectorTimelineLocked(timelineCameraLock || triggerEvents);
      engine.applyDirectorTimelineAtTime(project, anchor, timeSec, {
        advanceEventsFromSec: triggerEvents ? prevPlayTimeRef.current : undefined,
        firedEventIds: triggerEvents ? firedPlaybackEventsRef.current : undefined,
        updateEnvironment: true,
        updatePostFx: true,
      });
      prevPlayTimeRef.current = timeSec;
    },
    [engine, project, rendering, timelineCameraLock],
  );

  // Immediately reflect LUT / sun / cloud / camera keyframe edits in live Program Monitor
  useEffect(() => {
    if (playing || rendering || !timelineCameraLock) return;
    applyTimelineAt(playheadSec, false);
  }, [applyTimelineAt, playheadSec, playing, project, rendering, timelineCameraLock]);

  // Scrubber update handler
  const handleScrubTime = useCallback(
    (nextT: number) => {
      const clamped = Math.max(0, Math.min(project.durationSec, nextT));
      setPlayheadSec(clamped);
      if (timelineCameraLock) {
        applyTimelineAt(clamped, false);
      }
    },
    [applyTimelineAt, project.durationSec, timelineCameraLock],
  );

  // Realtime NLE timeline playback loop
  useEffect(() => {
    if (!playing || rendering) return;
    let rafId = 0;
    let lastTs = performance.now();
    prevPlayTimeRef.current = playheadSec;

    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      setPlayheadSec((prev) => {
        let next = prev + dt;
        const outBound = Math.max(project.inTimeSec + 0.05, project.outTimeSec);
        if (next >= outBound) {
          if (loopPlayback) {
            next = project.inTimeSec;
            firedPlaybackEventsRef.current.clear();
            prevPlayTimeRef.current = next;
          } else {
            next = outBound;
            setPlaying(false);
          }
        }
        applyTimelineAt(next, true);
        return Number(next.toFixed(3));
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [applyTimelineAt, loopPlayback, playing, project.inTimeSec, project.outTimeSec, rendering]);

  // Evaluated values at current playhead
  const evaluatedAtPlayhead = useMemo(() => {
    const anchor = anchorRef.current ?? {
      baseRadius: engine.planet.baseRadius,
      nativeVoxelSize: engine.planet.nativeVoxelSize,
      targetPoint: [engine.planet.baseRadius, 0, 0] as [number, number, number],
      targetNormal: [1, 0, 0] as [number, number, number],
      currentPos: [engine.planet.baseRadius * 2, 0, 0] as [number, number, number],
      currentLookAt: [0, 0, 0] as [number, number, number],
      currentUp: [0, 1, 0] as [number, number, number],
      currentFovDeg: 52,
    };
    return evaluateFullTimelineAtTime(project, anchor, playheadSec);
  }, [engine.planet.baseRadius, engine.planet.nativeVoxelSize, playheadSec, project]);

  const frameRange = useMemo(() => computeProjectFrameRange(project), [project]);

  // Keyframe & Event Track Creators
  const handleAddCameraKeyframeAtPlayhead = useCallback(() => {
    const kf = engine.captureCameraKeyframe(`机位 #${project.cameraTrack.length + 1}`);
    const newItem: DirectorCameraKeyframe = {
      ...kf,
      id: `cam_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      timeSec: Number(playheadSec.toFixed(3)),
      focusDist: Number(
        Math.max(
          0.2,
          Math.hypot(
            kf.position[0] - kf.lookAt[0],
            kf.position[1] - kf.lookAt[1],
            kf.position[2] - kf.lookAt[2],
          ),
        ).toFixed(2),
      ),
      aperture: 2.8,
      rollDeg: 0,
      shakeAmp: 0,
      shakeFreq: 4,
      interpMode: 'catmull_rom',
      easing: [0.42, 0, 0.58, 1],
    };
    onUpdateProject((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      cameraTrack: [...prev.cameraTrack, newItem].sort((a, b) => a.timeSec - b.timeSec),
    }));
    setSelectedItem({ track: 'camera', id: newItem.id });
    setRightTab('props');
    flashNotice(`已捕获摄像机关键帧 @ ${playheadSec.toFixed(2)}s`);
  }, [engine, flashNotice, onUpdateProject, playheadSec, project.cameraTrack.length]);

  const handleAddEnvKeyframeAtPlayhead = useCallback(() => {
    const cur = evaluateEnvironmentTrack(project.envTrack, playheadSec);
    const newEnv: DirectorEnvKeyframe = {
      id: `env_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      timeSec: Number(playheadSec.toFixed(3)),
      ...cur,
      waterVolume: cur.waterVolume ?? undefined,
      easing: [0.42, 0, 0.58, 1],
    };
    onUpdateProject((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      envTrack: [...prev.envTrack, newEnv].sort((a, b) => a.timeSec - b.timeSec),
    }));
    setSelectedItem({ track: 'env', id: newEnv.id });
    setRightTab('curves');
    flashNotice(`已添加日照与大气关键帧 @ ${playheadSec.toFixed(2)}s`);
  }, [flashNotice, onUpdateProject, playheadSec, project.envTrack]);

  const handleAddEventAtPlayhead = useCallback(
    (type: DirectorWorldEventType = 'volcano') => {
      const meta = WORLD_EVENT_META.find((m) => m.type === type) ?? WORLD_EVENT_META[0];
      const newEv: DirectorWorldEvent = {
        id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        label: `${meta.label} #${project.eventTrack.length + 1}`,
        type,
        latDeg: 14,
        lonDeg: 28,
        triggerTimeSec: Number(playheadSec.toFixed(3)),
        durationSec: meta.defaultDurationSec,
        radiusMult: 1.4,
        strength: 1.5,
        materialId: MaterialId.Basalt,
        enabled: true,
      };
      onUpdateProject((prev) => ({
        ...prev,
        updatedAt: Date.now(),
        eventTrack: [...prev.eventTrack, newEv].sort(
          (a, b) => a.triggerTimeSec - b.triggerTimeSec,
        ),
      }));
      setSelectedItem({ track: 'event', id: newEv.id });
      setRightTab('props');
      flashNotice(`已插入「${meta.label}」事件 @ ${playheadSec.toFixed(2)}s`);
    },
    [flashNotice, onUpdateProject, playheadSec, project.eventTrack.length],
  );

  const handleAddPostFxKeyframeAtPlayhead = useCallback(() => {
    const cur = evaluatePostFxTrack(project.postFxTrack, playheadSec);
    const newPfx: DirectorPostFxKeyframe = {
      id: `pfx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      timeSec: Number(playheadSec.toFixed(3)),
      ...cur,
      easing: [0.42, 0, 0.58, 1],
    };
    onUpdateProject((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      postFxTrack: [...prev.postFxTrack, newPfx].sort((a, b) => a.timeSec - b.timeSec),
    }));
    setSelectedItem({ track: 'postfx', id: newPfx.id });
    setRightTab('curves');
    flashNotice(`已添加调色 LUT 关键帧 @ ${playheadSec.toFixed(2)}s`);
  }, [flashNotice, onUpdateProject, playheadSec, project.postFxTrack]);

  const handleDeleteSelectedItem = useCallback(() => {
    if (!selectedItem || rendering) return;
    onUpdateProject((prev) => {
      if (selectedItem.track === 'camera') {
        if (prev.cameraTrack.length <= 1) return prev;
        return {
          ...prev,
          cameraTrack: prev.cameraTrack.filter((k) => k.id !== selectedItem.id),
        };
      }
      if (selectedItem.track === 'env') {
        if (prev.envTrack.length <= 1) return prev;
        return {
          ...prev,
          envTrack: prev.envTrack.filter((k) => k.id !== selectedItem.id),
        };
      }
      if (selectedItem.track === 'event') {
        return {
          ...prev,
          eventTrack: prev.eventTrack.filter((k) => k.id !== selectedItem.id),
        };
      }
      if (selectedItem.track === 'param') {
        const curList = prev.paramTracks?.[selectedItem.paramId] ?? [];
        const nextList = curList.filter((k) => k.id !== selectedItem.id);
        const nextParamTracks = { ...(prev.paramTracks ?? {}) };
        if (nextList.length === 0) {
          delete nextParamTracks[selectedItem.paramId];
        } else {
          nextParamTracks[selectedItem.paramId] = nextList;
        }
        return {
          ...prev,
          paramTracks: nextParamTracks,
        };
      }
      if (prev.postFxTrack.length <= 1) return prev;
      return {
        ...prev,
        postFxTrack: prev.postFxTrack.filter((k) => k.id !== selectedItem.id),
      };
    });
    setSelectedItem(null);
  }, [onUpdateProject, rendering, selectedItem]);

  const handleMoveItemTime = useCallback(
    (track: 'camera' | 'env' | 'event' | 'postfx', id: string, nextT: number) => {
      const clamped = Number(Math.max(0, Math.min(project.durationSec, nextT)).toFixed(3));
      onUpdateProject((prev) => {
        if (track === 'camera') {
          return {
            ...prev,
            cameraTrack: prev.cameraTrack
              .map((k) => (k.id === id ? { ...k, timeSec: clamped } : k))
              .sort((a, b) => a.timeSec - b.timeSec),
          };
        }
        if (track === 'env') {
          return {
            ...prev,
            envTrack: prev.envTrack
              .map((k) => (k.id === id ? { ...k, timeSec: clamped } : k))
              .sort((a, b) => a.timeSec - b.timeSec),
          };
        }
        if (track === 'event') {
          return {
            ...prev,
            eventTrack: prev.eventTrack
              .map((k) => (k.id === id ? { ...k, triggerTimeSec: clamped } : k))
              .sort((a, b) => a.triggerTimeSec - b.triggerTimeSec),
          };
        }
        return {
          ...prev,
          postFxTrack: prev.postFxTrack
            .map((k) => (k.id === id ? { ...k, timeSec: clamped } : k))
            .sort((a, b) => a.timeSec - b.timeSec),
        };
      });
    },
    [onUpdateProject, project.durationSec],
  );

  const handleMoveParamKeyframeTime = useCallback(
    (paramId: DirectorParamId, id: string, nextT: number) => {
      const clamped = Number(Math.max(0, Math.min(project.durationSec, nextT)).toFixed(3));
      onUpdateProject((prev) => {
        const list = prev.paramTracks?.[paramId] ?? [];
        return {
          ...prev,
          paramTracks: {
            ...(prev.paramTracks ?? {}),
            [paramId]: list
              .map((k) => (k.id === id ? { ...k, timeSec: clamped } : k))
              .sort((a, b) => a.timeSec - b.timeSec),
          },
        };
      });
    },
    [onUpdateProject, project.durationSec],
  );

  const getEvaluatedParamValue = useCallback(
    (paramId: DirectorParamId): number => {
      const { pose, env, pfx } = evaluatedAtPlayhead;
      switch (paramId) {
        case 'cloudCoverage':
          return env.cloudCoverage;
        case 'cloudAltitudeRatio':
          return env.cloudAltitudeRatio;
        case 'solarIntensity':
          return env.solarIntensity ?? 1.0;
        case 'sunElevationDeg':
          return env.sunElevationDeg;
        case 'sunAzimuthDeg':
          return env.sunAzimuthDeg;
        case 'waterVolume':
          return env.waterVolume ?? 1.0;
        case 'atmoDensity':
          return env.atmoDensity;
        case 'scatterStrength':
          return env.scatterStrength;
        case 'windSpeed':
          return env.windSpeed;
        case 'tempOffsetC':
          return env.tempOffsetC;
        case 'cameraFovDeg':
          return pose.fovDeg;
        case 'cameraRollDeg':
          return pose.rollDeg ?? 0;
        case 'cameraShakeAmp':
          return 0;
        case 'exposure':
          return pfx.exposure;
        case 'contrast':
          return pfx.contrast;
        case 'saturation':
          return pfx.saturation;
        case 'bloomStrength':
          return pfx.bloomStrength;
        case 'vignette':
          return pfx.vignette;
        case 'filmGrain':
          return pfx.filmGrain;
        case 'filterIntensity':
          return pfx.filterIntensity ?? 0.85;
        case 'filterScale':
          return pfx.filterScale ?? 1.0;
      }
    },
    [evaluatedAtPlayhead],
  );

  const handleAddParamKeyframeAtPlayhead = useCallback(
    (paramId: DirectorParamId, explicitValue?: number) => {
      if (rendering) return;
      const meta = PARAM_TRACK_META.find((m) => m.id === paramId);
      const val = explicitValue ?? getEvaluatedParamValue(paramId);
      const clampedT = Number(Math.max(0, Math.min(project.durationSec, playheadSec)).toFixed(3));
      let createdId = '';
      onUpdateProject((prev) => {
        const nextList = upsertParamKeyframe(
          prev.paramTracks?.[paramId],
          clampedT,
          val,
          [0.42, 0.0, 0.58, 1.0],
        );
        const hit = nextList.find((k) => Math.abs(k.timeSec - clampedT) < 0.045) ?? nextList[0];
        createdId = hit?.id ?? '';
        return {
          ...prev,
          updatedAt: Date.now(),
          paramTracks: {
            ...(prev.paramTracks ?? {}),
            [paramId]: nextList,
          },
        };
      });
      if (createdId) {
        setSelectedItem({ track: 'param', paramId, id: createdId });
      }
      flashNotice(`已为「${meta?.label ?? paramId}」添加关键帧 (${val.toFixed(2)}${meta?.unit ?? ''}) @ ${clampedT.toFixed(2)}s`);
    },
    [flashNotice, getEvaluatedParamValue, onUpdateProject, playheadSec, project.durationSec, rendering],
  );

  const handleSeedGradientParamsPreset = useCallback(() => {
    if (rendering) return;
    const dur = Math.max(1.0, project.durationSec);
    const mid = Number((dur * 0.5).toFixed(2));
    onUpdateProject((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      paramTracks: {
        ...(prev.paramTracks ?? {}),
        cloudCoverage: [
          { id: 'pk_demo_cloud_0', timeSec: 0, value: 0.15, easing: [0.42, 0, 0.58, 1] },
          { id: 'pk_demo_cloud_1', timeSec: mid, value: 0.95, easing: [0.42, 0, 0.58, 1] },
          { id: 'pk_demo_cloud_2', timeSec: dur, value: 1.85, easing: [0.42, 0, 0.58, 1] },
        ],
        solarIntensity: [
          { id: 'pk_demo_sun_0', timeSec: 0, value: 0.45, easing: [0.42, 0, 0.58, 1] },
          { id: 'pk_demo_sun_1', timeSec: dur, value: 3.1, easing: [0.42, 0, 0.58, 1] },
        ],
        waterVolume: [
          { id: 'pk_demo_water_0', timeSec: 0, value: 0.35, easing: [0.42, 0, 0.58, 1] },
          { id: 'pk_demo_water_1', timeSec: dur, value: 2.15, easing: [0.42, 0, 0.58, 1] },
        ],
      },
    }));
    setTimelineCameraLock(true);
    flashNotice('已注入动态渐变演示轨：云量(0.15→1.85)、太阳(0.45×→3.1×)、水量(0.35×→2.15×)');
  }, [flashNotice, onUpdateProject, project.durationSec, rendering]);

  // Studio local keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!rendering) setPlaying((p) => !p);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setPlaying(false);
        handleScrubTime(playheadSec - 1 / Math.max(1, project.fps));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        setPlaying(false);
        handleScrubTime(playheadSec + 1 / Math.max(1, project.fps));
      } else if (e.code === 'KeyI') {
        e.preventDefault();
        onUpdateProject((prev) => ({
          ...prev,
          inTimeSec: Math.min(playheadSec, prev.outTimeSec - 1 / Math.max(1, prev.fps)),
        }));
        flashNotice(`设置入点 In = ${playheadSec.toFixed(2)}s`);
      } else if (e.code === 'KeyO') {
        e.preventDefault();
        onUpdateProject((prev) => ({
          ...prev,
          outTimeSec: Math.max(playheadSec, prev.inTimeSec + 1 / Math.max(1, prev.fps)),
        }));
        flashNotice(`设置出点 Out = ${playheadSec.toFixed(2)}s`);
      } else if (e.code === 'KeyK') {
        e.preventDefault();
        handleAddCameraKeyframeAtPlayhead();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedItem) {
          e.preventDefault();
          handleDeleteSelectedItem();
        }
      } else if (e.code === 'Escape') {
        if (pickEventTargetId) {
          e.preventDefault();
          e.stopPropagation();
          setPickEventTargetId(null);
        } else if (screenshotModalOpen) {
          e.preventDefault();
          e.stopPropagation();
          setScreenshotModalOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    flashNotice,
    handleAddCameraKeyframeAtPlayhead,
    handleDeleteSelectedItem,
    handleScrubTime,
    onUpdateProject,
    pickEventTargetId,
    playheadSec,
    project.fps,
    rendering,
    screenshotModalOpen,
    selectedItem,
  ]);

  // Procedural Shot Baker (converts micro-to-planet, orbit-360, etc. into editable NLE keyframes)
  const handleBakeProceduralAction = () => {
    if (rendering) return;
    const anchor = anchorRef.current ?? engine.buildDirectorAnchor();
    const curEnv = evaluateEnvironmentTrack(project.envTrack, 0);
    const plan: DirectorShotPlan = {
      action: bakeAction,
      width: project.width,
      height: project.height,
      fps: project.fps,
      durationSec: project.durationSec,
      format: project.format,
      microStartVoxelMult: 2.0,
      planetEndDistMult: bakeAction === 'surface_flyover' ? 1.24 : 2.65,
      orbitSweepDeg: 360,
      orbitElevationDeg: 22,
      orbitWaveDeg: 14,
      baseFovDeg: 52,
      simTimeScale: project.simTimeScale,
      sunSweepDeg: 45,
      cleanFrame: project.cleanFrame,
      forceMaxVoxelDetail: project.forceMaxVoxelDetail,
      offlineQuality: project.offlineQuality,
      keyframes: [],
    };
    const baked = bakeShotActionIntoProject(project, bakeAction, plan, anchor, curEnv, 9);
    onReplaceProject(baked);
    setSelectedItem({ track: 'camera', id: baked.cameraTrack[0].id });
    setPlayheadSec(0);
    setTimelineCameraLock(true);
    applyTimelineAt(0, false);
    flashNotice(
      `已烘焙「${DIRECTOR_ACTIONS.find((a) => a.id === bakeAction)?.label}」至时间轴 (${baked.cameraTrack.length} 机位)`,
    );
  };

  // IndexedDB Checkpointed & Resumable Offline Render Control
  const runOfflineJob = async (resumeJob?: RenderCheckpointJob) => {
    if (rendering) return;
    setPlaying(false);
    setRenderError(null);
    setRendering(true);
    pauseRequestedRef.current = false;

    if (!resumeJob) {
      setFilmstripFrames([]);
      setInspectedFrame(null);
    } else {
      const existingFrames = await getJobFilmstripItems(resumeJob.id);
      setFilmstripFrames(existingFrames);
    }

    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    const activeProject = resumeJob?.projectSnapshot ?? project;
    const range = computeProjectFrameRange(activeProject);

    setRenderProgress({
      jobId: resumeJob?.id,
      frame: resumeJob?.lastCheckpointFrame ?? range.startFrame,
      totalFrames: range.totalFrames,
      completedInRange: resumeJob?.completedFrames ?? 0,
      rangeTotal: range.endFrame - range.startFrame + 1,
      percent: 0,
      elapsedSec: 0,
      etaSec: 0,
      actualWidth: activeProject.width,
      actualHeight: activeProject.height,
      encoderLabel: resumeJob ? '从 IndexedDB 恢复物理断点...' : '初始化编码器与光追累积管线...',
      statusText: resumeJob ? `正在从第 ${resumeJob.lastCheckpointFrame + 1} 帧继续渲染` : '准备首帧与初始体素快照',
    });

    try {
      const outcome = await engine.renderDirectorProjectOffline({
        project: activeProject,
        anchor: resumeJob?.anchorSnapshot ?? anchorRef.current ?? engine.buildDirectorAnchor(),
        resumeJob,
        abortSignal: ctrl.signal,
        shouldPause: () => pauseRequestedRef.current,
        onProgress: (p) => {
          setRenderProgress(p);
          if (p.previewDataUrl && p.histogram) {
            const newThumb: FrameFilmstripItem = {
              frameIdx: p.frame,
              thumbDataUrl: p.previewDataUrl,
              renderMs: p.frameRenderMs ?? 0,
              meanLuma: p.meanLuma ?? p.histogram.meanLuma,
              alphaMin: p.alphaMin ?? p.histogram.alphaMin,
              histogram: p.histogram,
              isKeyFrame: Boolean(p.checkpointSaved),
            };
            setFilmstripFrames((prev) => {
              const filtered = prev.filter((item) => item.frameIdx !== newThumb.frameIdx);
              return [...filtered, newThumb].sort((a, b) => a.frameIdx - b.frameIdx);
            });
            setInspectedFrame(newThumb);
          }
        },
      });

      await refreshDbLists();
      if (outcome.status === 'completed' && outcome.result) {
        triggerBlobDownload(outcome.result.blob, outcome.result.filename);
        flashNotice(
          `离线渲染完成并已导出 (${outcome.result.frameCount} 帧 · ${outcome.result.encoderLabel})`,
        );
      } else if (outcome.status === 'paused') {
        flashNotice(
          `已于第 ${outcome.job.lastCheckpointFrame + 1} 帧暂停并保存断点至 IndexedDB，可随时继续渲染或安全导出`,
        );
      } else {
        flashNotice(
          `已安全中止渲染，已保留 ${outcome.job.completedFrames} 帧数据至 IndexedDB`,
        );
      }
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : '离线渲染失败');
      await refreshDbLists();
    } finally {
      abortCtrlRef.current = null;
      pauseRequestedRef.current = false;
      setRendering(false);
    }
  };

  const handlePauseAndSaveCheckpoint = () => {
    if (!rendering) return;
    pauseRequestedRef.current = true;
    flashNotice('正在完成当前帧并写入断点快照...');
  };

  const handleAbortKeepFrames = () => {
    if (!rendering) return;
    abortCtrlRef.current?.abort();
  };

  const handleSafeExportJob = async (job: RenderCheckpointJob) => {
    try {
      const assembled = await assembleDirectorJobBlob(job, engine.planet.seedConfig.seed);
      triggerBlobDownload(assembled.blob, assembled.filename);
      flashNotice(`已安全导出 ${assembled.frameCount} 帧 (${assembled.filename})`);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : '安全导出失败');
    }
  };

  const handleInspectJobFilmstrip = async (job: RenderCheckpointJob) => {
    const items = await getJobFilmstripItems(job.id);
    setFilmstripFrames(items);
    if (items.length > 0) {
      setInspectedFrame(items[items.length - 1]);
    }
    flashNotice(`已载入任务胶片条 (${items.length} 帧)`);
  };

  const handleRunHighResScreenshot = async () => {
    if (shotBusy || rendering) return;
    setShotBusy(true);
    try {
      const res = await engine.captureDirectorScreenshot({
        width: shotWidth,
        height: shotHeight,
        format: shotFormat,
        hideHelpers: shotHideHelpers,
        qualityOverride: project.offlineQuality.overrideMode,
        accumSamples: project.offlineQuality.accumSamples,
        rayTracing: project.offlineQuality.rayTracing,
        volumetrics: project.offlineQuality.volumetrics,
        shadowQuality: project.offlineQuality.shadowQuality,
        pbrEnhanced: project.offlineQuality.pbrEnhanced,
      });
      const ext = shotFormat === 'jpeg' ? 'jpg' : shotFormat;
      triggerBlobDownload(
        res.blob,
        `terrasphere-shot-${res.actualWidth}x${res.actualHeight}.${ext}`,
      );
      setLastShotPreview({
        dataUrl: res.previewDataUrl,
        label: `${res.actualWidth}×${res.actualHeight} ${shotFormat.toUpperCase()} (${(res.blob.size / (1024 * 1024)).toFixed(2)} MB)`,
      });
    } finally {
      setShotBusy(false);
    }
  };

  // Active item getters for Inspector
  const selectedCamKf = useMemo(
    () =>
      selectedItem?.track === 'camera'
        ? project.cameraTrack.find((k) => k.id === selectedItem.id) ?? null
        : null,
    [project.cameraTrack, selectedItem],
  );
  const selectedEvent = useMemo(
    () =>
      selectedItem?.track === 'event'
        ? project.eventTrack.find((ev) => ev.id === selectedItem.id) ?? null
        : null,
    [project.eventTrack, selectedItem],
  );
  const selectedParamKf = useMemo(
    () =>
      selectedItem?.track === 'param'
        ? (project.paramTracks?.[selectedItem.paramId] ?? []).find(
            (k) => k.id === selectedItem.id,
          ) ?? null
        : null,
    [project.paramTracks, selectedItem],
  );
  const selectedParamMeta = useMemo(
    () =>
      selectedItem?.track === 'param'
        ? PARAM_TRACK_META.find((m) => m.id === selectedItem.paramId) ?? null
        : null,
    [selectedItem],
  );

  // Closest/active env and postfx keyframes for Curve & Grading tab
  const activeEnvKf = useMemo(() => {
    if (selectedItem?.track === 'env') {
      const hit = project.envTrack.find((k) => k.id === selectedItem.id);
      if (hit) return hit;
    }
    const sorted = [...project.envTrack].sort((a, b) => a.timeSec - b.timeSec);
    return sorted.reduce(
      (best, cur) =>
        Math.abs(cur.timeSec - playheadSec) < Math.abs(best.timeSec - playheadSec) ? cur : best,
      sorted[0],
    );
  }, [playheadSec, project.envTrack, selectedItem]);

  const activePostFxKf = useMemo(() => {
    if (selectedItem?.track === 'postfx') {
      const hit = project.postFxTrack.find((k) => k.id === selectedItem.id);
      if (hit) return hit;
    }
    const sorted = [...project.postFxTrack].sort((a, b) => a.timeSec - b.timeSec);
    return sorted.reduce(
      (best, cur) =>
        Math.abs(cur.timeSec - playheadSec) < Math.abs(best.timeSec - playheadSec) ? cur : best,
      sorted[0],
    );
  }, [playheadSec, project.postFxTrack, selectedItem]);

  const activeCurveBezier: CubicBezier4 = useMemo(() => {
    if (selectedCamKf) return selectedCamKf.easing;
    if (selectedParamKf) return selectedParamKf.easing;
    if (selectedItem?.track === 'env' && activeEnvKf) return activeEnvKf.easing;
    if (selectedItem?.track === 'postfx' && activePostFxKf) return activePostFxKf.easing;
    return project.cameraTrack[0]?.easing ?? [0.42, 0, 0.58, 1];
  }, [activeEnvKf, activePostFxKf, project.cameraTrack, selectedCamKf, selectedItem, selectedParamKf]);

  const handleUpdateActiveCurve = (next: CubicBezier4) => {
    if (selectedCamKf) {
      onUpdateProject((prev) => ({
        ...prev,
        cameraTrack: prev.cameraTrack.map((k) =>
          k.id === selectedCamKf.id ? { ...k, easing: next } : k,
        ),
      }));
    } else if (selectedItem?.track === 'param' && selectedParamKf) {
      const pid = selectedItem.paramId;
      onUpdateProject((prev) => ({
        ...prev,
        paramTracks: {
          ...(prev.paramTracks ?? {}),
          [pid]: (prev.paramTracks?.[pid] ?? []).map((k) =>
            k.id === selectedParamKf.id ? { ...k, easing: next } : k,
          ),
        },
      }));
    } else if (selectedItem?.track === 'env' && activeEnvKf) {
      onUpdateProject((prev) => ({
        ...prev,
        envTrack: prev.envTrack.map((k) =>
          k.id === activeEnvKf.id ? { ...k, easing: next } : k,
        ),
      }));
    } else if (selectedItem?.track === 'postfx' && activePostFxKf) {
      onUpdateProject((prev) => ({
        ...prev,
        postFxTrack: prev.postFxTrack.map((k) =>
          k.id === activePostFxKf.id ? { ...k, easing: next } : k,
        ),
      }));
    } else if (project.cameraTrack[0]) {
      const targetId = project.cameraTrack[0].id;
      onUpdateProject((prev) => ({
        ...prev,
        cameraTrack: prev.cameraTrack.map((k) =>
          k.id === targetId ? { ...k, easing: next } : k,
        ),
      }));
    }
  };

  const updateOfflineQuality = (partial: Partial<DirectorQualitySettings>) => {
    onUpdateProject((prev) => ({
      ...prev,
      offlineQuality: { ...(prev.offlineQuality ?? createDefaultDirectorQuality()), ...partial },
    }));
  };

  const activeJobForResume = useMemo(
    () =>
      renderJobs.find((j) => j.status === 'paused' || j.status === 'aborted') ?? null,
    [renderJobs],
  );

  const curAspectMask = evaluatedAtPlayhead.pfx.aspectMask;

  return (
    <>
      {/* Main Full-Screen NLE Cinema Studio Shell */}
      <div
        data-testid="director-cinema-studio"
        className="fixed inset-0 z-30 bg-[#05070d] text-slate-200 flex flex-col overflow-hidden select-none"
      >
        {/* Top Transport & Project Header */}
        <header className="h-11 px-3 border-b border-slate-800 bg-[#080c16] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Clapperboard className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-display text-xs font-semibold text-white whitespace-nowrap">
              非线性导演创作工作室
            </span>
            <input
              type="text"
              value={project.name}
              disabled={rendering}
              onChange={(e) =>
                onUpdateProject((prev) => ({ ...prev, name: e.target.value }))
              }
              className="h-7 w-44 px-2 rounded-xs border border-slate-700/80 bg-[#0d1322] text-[11px] text-white focus:border-cyan-400 focus:outline-none"
            />
            {savedProjects.length > 0 && (
              <select
                value=""
                disabled={rendering}
                onChange={(e) => {
                  const found = savedProjects.find((p) => p.id === e.target.value);
                  if (found) {
                    onReplaceProject(found);
                    setPlayheadSec(0);
                    flashNotice(`已载入工程「${found.name}」`);
                  }
                }}
                className="h-7 max-w-[140px] px-1.5 rounded-xs border border-slate-800 bg-[#0d1322] text-[10px] text-slate-300"
              >
                <option value="">切换工程 ({savedProjects.length})</option>
                {savedProjects.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Center-Right Quick Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              tabIndex={-1}
              disabled={rendering}
              data-testid="director-save-project-btn"
              onClick={() => {
                void saveDirectorProjectToDb(project).then(() => {
                  void refreshDbLists();
                  flashNotice('工程已持久化保存至 IndexedDB');
                });
              }}
              className="h-7 px-2.5 rounded-xs border border-slate-700 bg-[#0d1322] hover:border-cyan-400 text-[11px] text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5 text-cyan-400" />
              <span>保存工程</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              disabled={rendering}
              onClick={() => {
                const json = serializeDirectorProjectJson(project);
                triggerBlobDownload(
                  new Blob([json], { type: 'application/json' }),
                  `${project.name.replace(/\s+/g, '_')}.terrasphere-director.json`,
                );
              }}
              className="h-7 px-2 rounded-xs border border-slate-800 bg-[#0d1322] hover:border-slate-600 text-[10px] text-slate-300 flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40"
              title="导出工程 JSON"
            >
              <Download className="w-3 h-3" />
              <span>导出脚本</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              disabled={rendering}
              onClick={() => importFileRef.current?.click()}
              className="h-7 px-2 rounded-xs border border-slate-800 bg-[#0d1322] hover:border-slate-600 text-[10px] text-slate-300 flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40"
              title="导入工程 JSON"
            >
              <Upload className="w-3 h-3" />
              <span>导入</span>
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void file.text().then((txt) => {
                  const parsed = parseDirectorProjectJson(txt);
                  if (parsed) {
                    onReplaceProject(parsed);
                    setPlayheadSec(0);
                    flashNotice(`已导入导演工程「${parsed.name}」`);
                  } else {
                    setRenderError('无法解析导演工程 JSON 文件');
                  }
                });
                e.target.value = '';
              }}
            />

            <button
              type="button"
              tabIndex={-1}
              disabled={rendering}
              data-testid="director-restore-world-btn"
              onClick={() => {
                if (restoreSnapRef.current) {
                  engine.restoreDirectorWorldSnapshot(restoreSnapRef.current);
                  firedPlaybackEventsRef.current.clear();
                  flashNotice('已将星球地形/流体/温度完整恢复至进入导演工作室前的快照状态');
                }
              }}
              className="h-7 px-2.5 rounded-xs border border-amber-500/40 bg-amber-950/35 hover:bg-amber-900/50 text-amber-200 text-[10px] flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40"
              title="若事件或灾害破坏了地表，可一键还原至进入工作室时的星球快照"
            >
              <RotateCcw className="w-3 h-3" />
              <span>还原星球</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              disabled={rendering}
              data-testid="director-open-screenshot-btn"
              onClick={() => setScreenshotModalOpen(true)}
              className="h-7 px-2.5 rounded-xs border border-sky-500/50 bg-sky-950/50 hover:bg-sky-900/60 text-sky-100 text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40"
            >
              <Aperture className="w-3.5 h-3.5 text-sky-400" />
              <span>高分截屏</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              disabled={rendering}
              data-testid="close-director-btn"
              onClick={onClose}
              className="h-7 px-2.5 rounded-xs border border-rose-500/40 bg-rose-950/40 hover:bg-rose-900/60 text-rose-100 text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40"
            >
              <X className="w-3.5 h-3.5" />
              <span>退出 [F9]</span>
            </button>
          </div>
        </header>

        {/* Notice / Error Toast Strip */}
        {(studioNotice || renderError) && (
          <div
            className={`px-3 py-1 text-[11px] border-b flex items-center justify-between shrink-0 ${
              renderError
                ? 'bg-rose-950/70 border-rose-500/50 text-rose-200'
                : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
            }`}
          >
            <span>{renderError ?? studioNotice}</span>
            <button
              type="button"
              onClick={() => {
                setRenderError(null);
                setStudioNotice(null);
              }}
              className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Upper Workspace: Left Dual Monitors + Filmstrip | Right Context Inspector */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left-Center Dual Monitors & Filmstrip Column */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
            {/* Dual Monitors Row */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {/* Program Monitor Column (Hosts docked WebGPU canvas) */}
              <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#04060b] overflow-hidden">
                {/* Program Monitor Top Header */}
                <div className="h-7 px-2.5 border-b border-slate-800/80 bg-[#090d18] flex items-center justify-between gap-2 text-[10px] shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-cyan-300 whitespace-nowrap">
                      节目监视器 (Program)
                    </span>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setTimelineCameraLock((v) => !v)}
                      className={`h-5 px-1.5 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap ${
                        timelineCameraLock
                          ? 'border-cyan-500/60 bg-cyan-950/50 text-cyan-200'
                          : 'border-emerald-500/60 bg-emerald-950/50 text-emerald-200'
                      }`}
                      title="切换时间轴机位锁定或鼠标自由飞翔取景"
                    >
                      {timelineCameraLock ? '时间轴机位锁' : '自由取景模式'}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowGizmos((v) => !v)}
                      className={`h-5 px-1.5 rounded-xs border text-[10px] flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        showGizmos
                          ? 'border-sky-400/60 bg-sky-950/50 text-sky-200'
                          : 'border-slate-800 bg-[#0d1322] text-slate-400'
                      }`}
                    >
                      <Eye className="w-3 h-3" />
                      <span>3D轨迹</span>
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowGuides((v) => !v)}
                      className={`h-5 px-1.5 rounded-xs border text-[10px] flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        showGuides
                          ? 'border-amber-400/60 bg-amber-950/40 text-amber-200'
                          : 'border-slate-800 bg-[#0d1322] text-slate-400'
                      }`}
                    >
                      <Grid className="w-3 h-3" />
                      <span>安全框</span>
                    </button>
                  </div>

                  {/* Quick Procedural Action Baker */}
                  <div className="flex items-center gap-1 shrink-0">
                    <select
                      value={bakeAction}
                      disabled={rendering}
                      onChange={(e) => setBakeAction(e.target.value as DirectorActionType)}
                      className="h-5 px-1 rounded-xs border border-slate-700 bg-[#0d1322] text-[10px] text-slate-200 max-w-[104px]"
                    >
                      {DIRECTOR_ACTIONS.filter((a) => a.id !== 'keyframe_path').map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      data-testid="director-bake-action-btn"
                      onClick={handleBakeProceduralAction}
                      className="h-5 px-2 rounded-xs bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40"
                      title="将选定的自动化运镜一键烘焙成可编辑的时间轴关键帧曲线"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>烘焙轨道</span>
                    </button>
                  </div>
                </div>

                {/* Transparent Docking Viewport Hole */}
                <div
                  ref={programSlotRef}
                  data-testid="director-program-slot"
                  className="flex-1 min-h-0 relative bg-transparent"
                />

                {/* Program Monitor Transport Bar */}
                <div className="h-9 px-2.5 border-t border-slate-800/80 bg-[#090d18] flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      onClick={() => {
                        setPlaying(false);
                        firedPlaybackEventsRef.current.clear();
                        handleScrubTime(project.inTimeSec);
                      }}
                      className="w-7 h-7 rounded-xs border border-slate-800 bg-[#0d1322] hover:border-slate-600 text-slate-300 flex items-center justify-center cursor-pointer"
                      title="跳至入点"
                    >
                      <SkipBack className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      onClick={() => {
                        setPlaying(false);
                        handleScrubTime(playheadSec - 1 / Math.max(1, project.fps));
                      }}
                      className="w-7 h-7 rounded-xs border border-slate-800 bg-[#0d1322] hover:border-slate-600 text-slate-300 flex items-center justify-center cursor-pointer"
                      title="上一帧 [←]"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      data-testid="director-play-toggle-btn"
                      onClick={() => setPlaying((p) => !p)}
                      className={`h-7 px-3 rounded-xs border text-[11px] font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        playing
                          ? 'border-amber-400 bg-amber-950/60 text-amber-200'
                          : 'border-cyan-500/70 bg-cyan-950/50 hover:bg-cyan-900/60 text-white'
                      }`}
                      title="实时多轨道回放 [Space]"
                    >
                      {playing ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          <span>暂停</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 text-cyan-300" />
                          <span>播放预览</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      onClick={() => {
                        setPlaying(false);
                        handleScrubTime(playheadSec + 1 / Math.max(1, project.fps));
                      }}
                      className="w-7 h-7 rounded-xs border border-slate-800 bg-[#0d1322] hover:border-slate-600 text-slate-300 flex items-center justify-center cursor-pointer"
                      title="下一帧 [→]"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      onClick={() => {
                        setPlaying(false);
                        handleScrubTime(project.outTimeSec);
                      }}
                      className="w-7 h-7 rounded-xs border border-slate-800 bg-[#0d1322] hover:border-slate-600 text-slate-300 flex items-center justify-center cursor-pointer"
                      title="跳至出点"
                    >
                      <SkipForward className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setLoopPlayback((l) => !l)}
                      className={`w-7 h-7 rounded-xs border flex items-center justify-center cursor-pointer ${
                        loopPlayback
                          ? 'border-sky-400/60 bg-sky-950/50 text-sky-300'
                          : 'border-slate-800 bg-[#0d1322] text-slate-500'
                      }`}
                      title="循环回放工作区间"
                    >
                      <Repeat className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={rendering}
                      data-testid="director-capture-cam-btn"
                      onClick={handleAddCameraKeyframeAtPlayhead}
                      className="h-7 px-2.5 rounded-xs border border-cyan-500/60 bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-100 text-[10px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Camera className="w-3 h-3 text-cyan-300" />
                      <span>捕获机位 [K]</span>
                    </button>
                    <span className="font-mono-tabular text-[11px] text-slate-200 px-1">
                      {formatSmpteTimecode(playheadSec, project.fps)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Monitor: Render Output Inspector + RGB Histogram */}
              <RenderMonitorPane
                rendering={rendering}
                progress={renderProgress}
                inspectedFrame={inspectedFrame}
                targetWidth={project.width}
                targetHeight={project.height}
                fps={project.fps}
              />
            </div>

            {/* Interactive Frame Filmstrip Gallery */}
            <FilmstripGallery
              frames={filmstripFrames}
              selectedFrameIdx={inspectedFrame?.frameIdx ?? null}
              onSelectFrame={(item) => setInspectedFrame(item)}
            />
          </div>

          {/* Right Context Inspector Panel */}
          <aside
            data-testid="director-inspector-panel"
            className="w-[368px] shrink-0 border-l border-slate-800 bg-[#080c16] flex flex-col overflow-hidden"
          >
            {/* Inspector Tabs */}
            <div className="h-9 px-2 border-b border-slate-800 bg-[#0a0f1c] flex items-center gap-1 shrink-0">
              <button
                type="button"
                tabIndex={-1}
                data-testid="inspector-tab-props"
                onClick={() => setRightTab('props')}
                className={`flex-1 h-7 rounded-xs border text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap ${
                  rightTab === 'props'
                    ? 'border-cyan-400 bg-cyan-950/60 text-white'
                    : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>机位与事件</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-testid="inspector-tab-curves"
                onClick={() => setRightTab('curves')}
                className={`flex-1 h-7 rounded-xs border text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap ${
                  rightTab === 'curves'
                    ? 'border-amber-400 bg-amber-950/50 text-white'
                    : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>曲线与调色</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-testid="inspector-tab-queue"
                onClick={() => setRightTab('queue')}
                className={`flex-1 h-7 rounded-xs border text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap ${
                  rightTab === 'queue'
                    ? 'border-rose-400 bg-rose-950/50 text-white'
                    : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>断点队列导出</span>
              </button>
            </div>

            {/* Scrollable Inspector Body */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-[11px]">
              {rightTab === 'props' && (
                <>
                  {/* Camera Keyframe Inspector */}
                  {selectedCamKf ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                        <span className="font-semibold text-cyan-300">
                          机位关键帧 · {selectedCamKf.label}
                        </span>
                        <button
                          type="button"
                          tabIndex={-1}
                          disabled={rendering}
                          onClick={() => {
                            const live = engine.captureCameraKeyframe(selectedCamKf.label);
                            onUpdateProject((prev) => ({
                              ...prev,
                              cameraTrack: prev.cameraTrack.map((k) =>
                                k.id === selectedCamKf.id
                                  ? {
                                      ...k,
                                      position: live.position,
                                      lookAt: live.lookAt,
                                      up: live.up,
                                      fovDeg: live.fovDeg,
                                    }
                                  : k,
                              ),
                            }));
                            flashNotice('已将当前视口机位写入该关键帧');
                          }}
                          className="h-6 px-2 rounded-xs border border-cyan-500/50 bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-100 text-[10px] cursor-pointer"
                        >
                          覆盖为当前视口
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">标签</span>
                          <input
                            type="text"
                            value={selectedCamKf.label}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                cameraTrack: prev.cameraTrack.map((k) =>
                                  k.id === selectedCamKf.id
                                    ? { ...k, label: e.target.value }
                                    : k,
                                ),
                              }))
                            }
                            className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">时间 (s)</span>
                          <input
                            type="number"
                            min={0}
                            max={project.durationSec}
                            step={0.05}
                            value={selectedCamKf.timeSec}
                            onChange={(e) =>
                              handleMoveItemTime('camera', selectedCamKf.id, Number(e.target.value))
                            }
                            className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">插值算法</span>
                          <select
                            value={selectedCamKf.interpMode}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                cameraTrack: prev.cameraTrack.map((k) =>
                                  k.id === selectedCamKf.id
                                    ? {
                                        ...k,
                                        interpMode: e.target.value as DirectorCameraKeyframe['interpMode'],
                                      }
                                    : k,
                                ),
                              }))
                            }
                            className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[10px]"
                          >
                            <option value="catmull_rom">Catmull-Rom 电影样条</option>
                            <option value="linear">线性匀速</option>
                            <option value="hold">定格跳切 Hold</option>
                          </select>
                        </label>

                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-400">视角 FOV</span>
                            <span className="font-mono-tabular text-cyan-300">
                              {selectedCamKf.fovDeg.toFixed(1)}°
                            </span>
                          </div>
                          <input
                            type="range"
                            min={10}
                            max={105}
                            step={0.5}
                            value={selectedCamKf.fovDeg}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                cameraTrack: prev.cameraTrack.map((k) =>
                                  k.id === selectedCamKf.id
                                    ? { ...k, fovDeg: Number(e.target.value) }
                                    : k,
                                ),
                              }))
                            }
                            className="studio-slider mt-2"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-400">荷兰倾角 Roll</span>
                            <span className="font-mono-tabular text-slate-200">
                              {selectedCamKf.rollDeg.toFixed(1)}°
                            </span>
                          </div>
                          <input
                            type="range"
                            min={-45}
                            max={45}
                            step={0.5}
                            value={selectedCamKf.rollDeg}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                cameraTrack: prev.cameraTrack.map((k) =>
                                  k.id === selectedCamKf.id
                                    ? { ...k, rollDeg: Number(e.target.value) }
                                    : k,
                                ),
                              }))
                            }
                            className="studio-slider"
                          />
                        </label>

                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-400">手持震动强度</span>
                            <span className="font-mono-tabular text-amber-300">
                              {selectedCamKf.shakeAmp.toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={3}
                            step={0.05}
                            value={selectedCamKf.shakeAmp}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                cameraTrack: prev.cameraTrack.map((k) =>
                                  k.id === selectedCamKf.id
                                    ? { ...k, shakeAmp: Number(e.target.value) }
                                    : k,
                                ),
                              }))
                            }
                            className="studio-slider"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">对焦距离 (m)</span>
                          <input
                            type="number"
                            min={0.1}
                            max={500}
                            step={0.5}
                            value={selectedCamKf.focusDist}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                cameraTrack: prev.cameraTrack.map((k) =>
                                  k.id === selectedCamKf.id
                                    ? { ...k, focusDist: Number(e.target.value) || 1 }
                                    : k,
                                ),
                              }))
                            }
                            className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">光圈 f-stop</span>
                          <input
                            type="number"
                            min={1.2}
                            max={22}
                            step={0.2}
                            value={selectedCamKf.aperture}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                cameraTrack: prev.cameraTrack.map((k) =>
                                  k.id === selectedCamKf.id
                                    ? { ...k, aperture: Number(e.target.value) || 2.8 }
                                    : k,
                                ),
                              }))
                            }
                            className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                          />
                        </label>
                      </div>
                    </div>
                  ) : selectedEvent ? (
                    /* Planetary Disaster & Engineering Event Inspector */
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                        <span className="font-semibold text-rose-300">
                          星球触发事件 · {selectedEvent.label}
                        </span>
                        <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedEvent.enabled}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                eventTrack: prev.eventTrack.map((ev) =>
                                  ev.id === selectedEvent.id
                                    ? { ...ev, enabled: e.target.checked }
                                    : ev,
                                ),
                              }))
                            }
                            className="accent-rose-400"
                          />
                          <span>启用</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">事件名称</span>
                          <input
                            type="text"
                            value={selectedEvent.label}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                eventTrack: prev.eventTrack.map((ev) =>
                                  ev.id === selectedEvent.id
                                    ? { ...ev, label: e.target.value }
                                    : ev,
                                ),
                              }))
                            }
                            className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">灾害 / 工程类型</span>
                          <select
                            value={selectedEvent.type}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                eventTrack: prev.eventTrack.map((ev) =>
                                  ev.id === selectedEvent.id
                                    ? {
                                        ...ev,
                                        type: e.target.value as DirectorWorldEventType,
                                      }
                                    : ev,
                                ),
                              }))
                            }
                            className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[10px]"
                          >
                            {WORLD_EVENT_META.map((m) => (
                              <option key={m.type} value={m.type}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">触发时刻 (s)</span>
                          <input
                            type="number"
                            min={0}
                            max={project.durationSec}
                            step={0.05}
                            value={selectedEvent.triggerTimeSec}
                            onChange={(e) =>
                              handleMoveItemTime(
                                'event',
                                selectedEvent.id,
                                Number(e.target.value),
                              )
                            }
                            className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">持续指示时长 (s)</span>
                          <input
                            type="number"
                            min={0.2}
                            max={12}
                            step={0.1}
                            value={selectedEvent.durationSec}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                eventTrack: prev.eventTrack.map((ev) =>
                                  ev.id === selectedEvent.id
                                    ? {
                                        ...ev,
                                        durationSec: Math.max(0.2, Number(e.target.value) || 1),
                                      }
                                    : ev,
                                ),
                              }))
                            }
                            className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                          />
                        </label>
                      </div>

                      {/* Lat / Lon + Interactive Planet Picker */}
                      <div className="p-2 rounded-xs border border-slate-800 bg-[#0b101d] space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-300">地表经纬度靶点</span>
                          <button
                            type="button"
                            tabIndex={-1}
                            data-testid="director-pick-planet-btn"
                            onClick={() =>
                              setPickEventTargetId((cur) =>
                                cur === selectedEvent.id ? null : selectedEvent.id,
                              )
                            }
                            className={`h-6 px-2 rounded-xs border text-[10px] flex items-center gap-1 cursor-pointer ${
                              pickEventTargetId === selectedEvent.id
                                ? 'border-rose-400 bg-rose-950/80 text-white animate-pulse'
                                : 'border-sky-500/60 bg-sky-950/50 text-sky-200 hover:bg-sky-900/60'
                            }`}
                          >
                            <Crosshair className="w-3 h-3" />
                            <span>
                              {pickEventTargetId === selectedEvent.id
                                ? '请点击左侧星球表面...'
                                : '在星球上拾取坐标'}
                            </span>
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-0.5 block">
                            <span className="text-[10px] text-slate-400">纬度 Lat (°)</span>
                            <input
                              type="number"
                              min={-89}
                              max={89}
                              step={1}
                              value={selectedEvent.latDeg}
                              onChange={(e) =>
                                onUpdateProject((prev) => ({
                                  ...prev,
                                  eventTrack: prev.eventTrack.map((ev) =>
                                    ev.id === selectedEvent.id
                                      ? { ...ev, latDeg: Number(e.target.value) || 0 }
                                      : ev,
                                  ),
                                }))
                              }
                              className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                            />
                          </label>
                          <label className="space-y-0.5 block">
                            <span className="text-[10px] text-slate-400">经度 Lon (°)</span>
                            <input
                              type="number"
                              min={-180}
                              max={180}
                              step={1}
                              value={selectedEvent.lonDeg}
                              onChange={(e) =>
                                onUpdateProject((prev) => ({
                                  ...prev,
                                  eventTrack: prev.eventTrack.map((ev) =>
                                    ev.id === selectedEvent.id
                                      ? { ...ev, lonDeg: Number(e.target.value) || 0 }
                                      : ev,
                                  ),
                                }))
                              }
                              className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                            />
                          </label>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-400">影响半径倍率</span>
                            <span className="font-mono-tabular text-cyan-300">
                              {selectedEvent.radiusMult.toFixed(1)}×
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.4}
                            max={4.5}
                            step={0.1}
                            value={selectedEvent.radiusMult}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                eventTrack: prev.eventTrack.map((ev) =>
                                  ev.id === selectedEvent.id
                                    ? { ...ev, radiusMult: Number(e.target.value) }
                                    : ev,
                                ),
                              }))
                            }
                            className="studio-slider"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-400">能量强度</span>
                            <span className="font-mono-tabular text-rose-300">
                              {selectedEvent.strength.toFixed(1)}×
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.3}
                            max={4.0}
                            step={0.1}
                            value={selectedEvent.strength}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                eventTrack: prev.eventTrack.map((ev) =>
                                  ev.id === selectedEvent.id
                                    ? { ...ev, strength: Number(e.target.value) }
                                    : ev,
                                ),
                              }))
                            }
                            className="studio-slider"
                          />
                        </label>
                      </div>

                      <label className="space-y-0.5 block">
                        <span className="text-[10px] text-slate-400">关联地质体素材质</span>
                        <select
                          value={selectedEvent.materialId}
                          onChange={(e) =>
                            onUpdateProject((prev) => ({
                              ...prev,
                              eventTrack: prev.eventTrack.map((ev) =>
                                ev.id === selectedEvent.id
                                  ? {
                                      ...ev,
                                      materialId: Number(e.target.value) as MaterialId,
                                    }
                                  : ev,
                              ),
                            }))
                          }
                          className="w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[10px]"
                        >
                          {Object.entries(MATERIAL_NAMES)
                            .filter(([id]) => Number(id) !== MaterialId.Air)
                            .map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                        </select>
                      </label>

                      <button
                        type="button"
                        tabIndex={-1}
                        disabled={rendering}
                        data-testid="director-fire-event-now-btn"
                        onClick={() => {
                          engine.dispatchDirectorWorldEvent(selectedEvent, 1.0);
                          flashNotice(`已立即试放「${selectedEvent.label}」`);
                        }}
                        className="w-full h-7 rounded-xs border border-rose-500/60 bg-rose-950/60 hover:bg-rose-900/70 text-white text-[11px] font-medium cursor-pointer flex items-center justify-center gap-1"
                      >
                        <Flame className="w-3.5 h-3.5 text-orange-400" />
                        <span>立即在节目视口试放此事件</span>
                      </button>
                    </div>
                  ) : selectedItem?.track === 'param' && selectedParamKf && selectedParamMeta ? (
                    /* Per-Parameter Keyframe Inspector */
                    <div data-testid="param-keyframe-inspector" className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                        <span className="font-semibold text-purple-300 flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-xs inline-block"
                            style={{ backgroundColor: selectedParamMeta.colorHex }}
                          />
                          <span>单参数关键帧 · {selectedParamMeta.label}</span>
                        </span>
                        <button
                          type="button"
                          onClick={handleDeleteSelectedItem}
                          className="h-6 px-2 rounded-xs border border-rose-500/40 bg-rose-950/40 text-rose-200 text-[10px] cursor-pointer"
                        >
                          删除节点
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">关键帧时刻 (s)</span>
                          <input
                            type="number"
                            min={0}
                            max={project.durationSec}
                            step={0.05}
                            value={selectedParamKf.timeSec}
                            onChange={(e) =>
                              handleMoveParamKeyframeTime(
                                selectedParamMeta.id,
                                selectedParamKf.id,
                                Number(e.target.value),
                              )
                            }
                            className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                          />
                        </label>
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">
                            目标数值 {selectedParamMeta.unit ? `(${selectedParamMeta.unit})` : ''}
                          </span>
                          <input
                            type="number"
                            min={selectedParamMeta.min}
                            max={selectedParamMeta.max}
                            step={selectedParamMeta.step}
                            value={selectedParamKf.value}
                            onChange={(e) => {
                              const nextVal = Math.max(
                                selectedParamMeta.min,
                                Math.min(selectedParamMeta.max, Number(e.target.value) || 0),
                              );
                              onUpdateProject((prev) => ({
                                ...prev,
                                paramTracks: {
                                  ...(prev.paramTracks ?? {}),
                                  [selectedParamMeta.id]: (prev.paramTracks?.[selectedParamMeta.id] ?? []).map((k) =>
                                    k.id === selectedParamKf.id ? { ...k, value: nextVal } : k,
                                  ),
                                },
                              }));
                            }}
                            className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                          />
                        </label>
                      </div>

                      <label className="space-y-1 block">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-slate-400">{selectedParamMeta.label} 数值滑杆</span>
                          <span className="font-mono-tabular text-purple-200">
                            {selectedParamKf.value.toFixed(2)}
                            {selectedParamMeta.unit}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={selectedParamMeta.min}
                          max={selectedParamMeta.max}
                          step={selectedParamMeta.step}
                          value={selectedParamKf.value}
                          onChange={(e) => {
                            const nextVal = Number(e.target.value);
                            onUpdateProject((prev) => ({
                              ...prev,
                              paramTracks: {
                                ...(prev.paramTracks ?? {}),
                                [selectedParamMeta.id]: (prev.paramTracks?.[selectedParamMeta.id] ?? []).map((k) =>
                                  k.id === selectedParamKf.id ? { ...k, value: nextVal } : k,
                                ),
                              },
                            }));
                          }}
                          className="studio-slider"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => handleAddParamKeyframeAtPlayhead(selectedParamMeta.id)}
                        className="w-full h-7 rounded-xs border border-purple-500/50 bg-purple-950/50 hover:bg-purple-900/60 text-purple-100 text-[10px] cursor-pointer"
                      >
                        + 在当前播放头 ({playheadSec.toFixed(2)}s) 追加关键帧
                      </button>
                    </div>
                  ) : (
                    /* Overview & Quick Add Palette when nothing selected */
                    <div className="space-y-3">
                      <div className="text-slate-300 text-[11px] leading-relaxed">
                        在下方时间轴点击任意关键帧或事件条即可编辑其详细参数，或点击下方快捷按钮在当前播放头 ({playheadSec.toFixed(2)}s) 插入新节点。
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={handleAddCameraKeyframeAtPlayhead}
                          className="h-8 px-2 rounded-xs border border-cyan-500/40 bg-cyan-950/35 hover:bg-cyan-900/50 text-cyan-200 text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>插入机位关键帧</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleAddEnvKeyframeAtPlayhead}
                          className="h-8 px-2 rounded-xs border border-amber-500/40 bg-amber-950/35 hover:bg-amber-900/50 text-amber-200 text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>插入日照/气象帧</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleAddPostFxKeyframeAtPlayhead}
                          className="h-8 px-2 rounded-xs border border-emerald-500/40 bg-emerald-950/35 hover:bg-emerald-900/50 text-emerald-200 text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>插入调色/滤镜帧</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddEventAtPlayhead('volcano')}
                          className="h-8 px-2 rounded-xs border border-rose-500/40 bg-rose-950/35 hover:bg-rose-900/50 text-rose-200 text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Flame className="w-3 h-3" />
                          <span>插入火山爆发</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        data-testid="director-seed-gradient-params-btn"
                        disabled={rendering}
                        onClick={handleSeedGradientParamsPreset}
                        className="w-full h-8 px-2 rounded-xs border border-purple-500/50 bg-purple-950/40 hover:bg-purple-900/55 text-purple-100 text-[10px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                        <span>一键注入渐变演示轨 (云渐密↑ · 日渐亮↑ · 水涨潮↑)</span>
                      </button>

                      <div className="pt-2 border-t border-slate-800 space-y-1.5">
                        <div className="text-[10px] font-semibold text-slate-300">
                          快捷添加灾害与工程事件预设
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {WORLD_EVENT_META.map((m) => (
                            <button
                              key={m.type}
                              type="button"
                              disabled={rendering}
                              data-testid={`quick-add-event-${m.type}`}
                              onClick={() => handleAddEventAtPlayhead(m.type)}
                              className="h-7 px-1.5 rounded-xs border border-slate-800 bg-[#0d1322] hover:border-rose-400 text-[10px] text-slate-200 truncate cursor-pointer"
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {rightTab === 'curves' && (
                <div className="space-y-3">
                  <BezierCurveEditor
                    value={activeCurveBezier}
                    disabled={rendering}
                    onChange={handleUpdateActiveCurve}
                  />

                  {/* Per-Parameter Keyframe Quick Strip */}
                  <div className="p-2 rounded-xs border border-purple-500/35 bg-[#0b101d] space-y-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-purple-300">
                        单参数独立关键帧 (点击 ◆ 立即打帧)
                      </span>
                      <button
                        type="button"
                        disabled={rendering}
                        onClick={handleSeedGradientParamsPreset}
                        className="h-5 px-1.5 rounded-xs border border-purple-500/50 bg-purple-950/60 hover:bg-purple-900/70 text-purple-200 text-[9px] cursor-pointer"
                      >
                        云↑ 日↑ 水↑ 预设
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['cloudCoverage', 'solarIntensity', 'waterVolume'] as DirectorParamId[]).map((pid) => {
                        const meta = PARAM_TRACK_META.find((m) => m.id === pid)!;
                        const cnt = project.paramTracks?.[pid]?.length ?? 0;
                        return (
                          <button
                            key={pid}
                            type="button"
                            disabled={rendering}
                            data-testid={`quick-param-kf-${pid}`}
                            onClick={() => handleAddParamKeyframeAtPlayhead(pid)}
                            className={`h-6 px-1.5 rounded-xs border text-[10px] flex items-center justify-between cursor-pointer ${
                              cnt > 0
                                ? 'border-purple-400/70 bg-purple-950/50 text-white'
                                : 'border-slate-800 bg-[#090d18] text-slate-300 hover:border-purple-400'
                            }`}
                          >
                            <span className="truncate">{meta.label.slice(0, 4)}</span>
                            <span className="font-mono-tabular text-[9px] text-purple-300">
                              ◆{cnt > 0 ? cnt : '+'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sun, Atmosphere & Hydrologic Keyframe Section */}
                  {activeEnvKf && (
                    <div className="pt-2.5 border-t border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-amber-300">
                          日照、气象与水文轨 ({activeEnvKf.timeSec.toFixed(2)}s)
                        </span>
                        <button
                          type="button"
                          onClick={handleAddEnvKeyframeAtPlayhead}
                          className="h-5 px-1.5 rounded-xs border border-amber-500/50 bg-amber-950/40 text-amber-200 text-[10px] cursor-pointer"
                        >
                          + 在当前处新增
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            ['太阳仰角', 'sunElevationDeg', -15, 85, 1, '°', activeEnvKf.sunElevationDeg, 'text-amber-200'],
                            ['太阳方位角', 'sunAzimuthDeg', -360, 360, 2, '°', activeEnvKf.sunAzimuthDeg, 'text-amber-200'],
                            ['太阳光强', 'solarIntensity', 0.05, 4.5, 0.05, '×', evaluatedAtPlayhead.env.solarIntensity ?? 1.0, 'text-yellow-300'],
                            ['大气散射密度', 'atmoDensity', 0, 2.5, 0.05, '', activeEnvKf.atmoDensity, 'text-sky-200'],
                            ['云层覆盖密度', 'cloudCoverage', 0, 2.0, 0.02, '', evaluatedAtPlayhead.env.cloudCoverage, 'text-slate-200'],
                            ['全局水量', 'waterVolume', 0, 2.5, 0.05, '×', evaluatedAtPlayhead.env.waterVolume ?? 1.0, 'text-cyan-300'],
                          ] as const
                        ).map(([lbl, key, min, max, step, unit, curVal, valColor]) => {
                          const hasParamTrack = (project.paramTracks?.[key as DirectorParamId]?.length ?? 0) > 0;
                          return (
                            <label key={key} className="space-y-0.5 block">
                              <div className="flex items-center justify-between text-[10px] gap-1">
                                <span className="text-slate-400 truncate">{lbl}</span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <span className={`font-mono-tabular ${valColor}`}>
                                    {Number(curVal).toFixed(step >= 1 ? 0 : 2)}{unit}
                                  </span>
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    data-testid={`param-kf-btn-${key}`}
                                    title={`在 ${playheadSec.toFixed(2)}s 为「${lbl}」打独立关键帧`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      handleAddParamKeyframeAtPlayhead(key as DirectorParamId, Number(curVal));
                                    }}
                                    className={`px-1 rounded-xs text-[9px] leading-tight cursor-pointer border ${
                                      hasParamTrack
                                        ? 'border-purple-400 bg-purple-950/70 text-purple-200'
                                        : 'border-slate-700 bg-[#0d1322] text-slate-400 hover:text-white hover:border-purple-400'
                                    }`}
                                  >
                                    ◆
                                  </button>
                                </div>
                              </div>
                              <input
                                type="range"
                                min={min}
                                max={max}
                                step={step}
                                value={curVal}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  if (key === 'waterVolume' || hasParamTrack) {
                                    handleAddParamKeyframeAtPlayhead(key as DirectorParamId, val);
                                  } else {
                                    onUpdateProject((prev) => ({
                                      ...prev,
                                      envTrack: prev.envTrack.map((k) =>
                                        k.id === activeEnvKf.id ? { ...k, [key]: val } : k,
                                      ),
                                    }));
                                  }
                                }}
                                className="studio-slider"
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Post-FX, LUT & Artistic/Optical Visual Filters Section */}
                  {activePostFxKf && (
                    <div className="pt-2.5 border-t border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-emerald-300">
                          后期调色与视觉滤镜轨 ({activePostFxKf.timeSec.toFixed(2)}s)
                        </span>
                        <button
                          type="button"
                          onClick={handleAddPostFxKeyframeAtPlayhead}
                          className="h-5 px-1.5 rounded-xs border border-emerald-500/50 bg-emerald-950/40 text-emerald-200 text-[10px] cursor-pointer"
                        >
                          + 在当前处新增
                        </button>
                      </div>

                      {/* Artistic & Scientific Visual Filter Grid */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-400 block">
                          艺术与科学视觉滤镜 (GPU TSL 后处理)
                        </span>
                        <div className="grid grid-cols-3 gap-1">
                          {VISUAL_FILTER_META.map((fm) => {
                            const active = (activePostFxKf.visualFilter ?? 'none') === fm.id;
                            return (
                              <button
                                key={fm.id}
                                type="button"
                                data-testid={`director-filter-${fm.id}`}
                                title={fm.desc}
                                onClick={() => {
                                  const val = fm.id as DirectorVisualFilter;
                                  onUpdateProject((prev) => ({
                                    ...prev,
                                    postFxTrack: prev.postFxTrack.map((k) =>
                                      k.id === activePostFxKf.id ? { ...k, visualFilter: val } : k,
                                    ),
                                  }));
                                }}
                                className={`h-6 px-1 rounded-xs border text-[10px] truncate cursor-pointer ${
                                  active
                                    ? 'border-purple-400 bg-purple-950/75 text-white font-medium'
                                    : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:text-white'
                                }`}
                              >
                                {fm.shortLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">电影级 LUT 滤镜</span>
                          <select
                            data-testid="director-lut-select"
                            value={activePostFxKf.lutPreset}
                            onChange={(e) => {
                              const val = e.target.value as DirectorLutPreset;
                              onUpdateProject((prev) => ({
                                ...prev,
                                postFxTrack: prev.postFxTrack.map((k) =>
                                  k.id === activePostFxKf.id ? { ...k, lutPreset: val } : k,
                                ),
                              }));
                            }}
                            className="w-full h-7 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[10px]"
                          >
                            {LUT_PRESET_META.map((lut) => (
                              <option key={lut.id} value={lut.id}>
                                {lut.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-0.5 block">
                          <span className="text-[10px] text-slate-400">画幅遮罩比例</span>
                          <select
                            value={activePostFxKf.aspectMask}
                            onChange={(e) => {
                              const val = e.target.value as DirectorAspectMask;
                              onUpdateProject((prev) => ({
                                ...prev,
                                postFxTrack: prev.postFxTrack.map((k) =>
                                  k.id === activePostFxKf.id ? { ...k, aspectMask: val } : k,
                                ),
                              }));
                            }}
                            className="w-full h-7 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[10px]"
                          >
                            <option value="none">无遮罩 (Full)</option>
                            <option value="2.39:1">变形宽银幕 2.39:1</option>
                            <option value="16:9">标准高清 16:9</option>
                            <option value="9:16">竖屏短片 9:16</option>
                          </select>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            ['滤镜混合强度', 'filterIntensity', 0.0, 1.0, 0.02, evaluatedAtPlayhead.pfx.filterIntensity ?? 0.85],
                            ['滤镜结构尺度', 'filterScale', 0.25, 3.0, 0.05, evaluatedAtPlayhead.pfx.filterScale ?? 1.0],
                            ['曝光增益', 'exposure', 0.4, 2.2, 0.02, evaluatedAtPlayhead.pfx.exposure],
                            ['对比度', 'contrast', 0.6, 1.8, 0.02, evaluatedAtPlayhead.pfx.contrast],
                            ['饱和度', 'saturation', 0.0, 2.0, 0.02, evaluatedAtPlayhead.pfx.saturation],
                            ['泛光 Bloom', 'bloomStrength', 0.0, 1.5, 0.02, evaluatedAtPlayhead.pfx.bloomStrength],
                            ['暗角 Vignette', 'vignette', 0.0, 0.85, 0.02, evaluatedAtPlayhead.pfx.vignette],
                            ['胶片颗粒 Grain', 'filmGrain', 0.0, 0.25, 0.005, evaluatedAtPlayhead.pfx.filmGrain],
                          ] as const
                        ).map(([lbl, key, min, max, step, curVal]) => {
                          const hasParamTrack = (project.paramTracks?.[key as DirectorParamId]?.length ?? 0) > 0;
                          return (
                            <label key={key} className="space-y-0.5 block">
                              <div className="flex items-center justify-between text-[10px] gap-1">
                                <span className="text-slate-400 truncate">{lbl}</span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <span className="font-mono-tabular text-emerald-200">
                                    {Number(curVal).toFixed(2)}
                                  </span>
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    data-testid={`param-kf-btn-${key}`}
                                    title={`在 ${playheadSec.toFixed(2)}s 为「${lbl}」打独立关键帧`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      handleAddParamKeyframeAtPlayhead(key as DirectorParamId, Number(curVal));
                                    }}
                                    className={`px-1 rounded-xs text-[9px] leading-tight cursor-pointer border ${
                                      hasParamTrack
                                        ? 'border-purple-400 bg-purple-950/70 text-purple-200'
                                        : 'border-slate-700 bg-[#0d1322] text-slate-400 hover:text-white hover:border-purple-400'
                                    }`}
                                  >
                                    ◆
                                  </button>
                                </div>
                              </div>
                              <input
                                type="range"
                                min={min}
                                max={max}
                                step={step}
                                value={curVal}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  if (hasParamTrack) {
                                    handleAddParamKeyframeAtPlayhead(key as DirectorParamId, v);
                                  } else {
                                    onUpdateProject((prev) => ({
                                      ...prev,
                                      postFxTrack: prev.postFxTrack.map((k) =>
                                        k.id === activePostFxKf.id ? { ...k, [key]: v } : k,
                                      ),
                                    }));
                                  }
                                }}
                                className="studio-slider"
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {rightTab === 'queue' && (
                <div className="space-y-3">
                  {/* Output Specs */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">输出规格与编码器</span>
                      <span className="font-mono-tabular text-[10px] text-cyan-300">
                        区间 {frameRange.endFrame - frameRange.startFrame + 1} 帧
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {RESOLUTION_PRESETS.map((r) => {
                        const active = project.width === r.width && project.height === r.height;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            data-testid={`director-res-${r.id}`}
                            disabled={rendering}
                            onClick={() =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                width: r.width,
                                height: r.height,
                              }))
                            }
                            className={`h-6 px-2 rounded-xs border text-[10px] cursor-pointer whitespace-nowrap ${
                              active
                                ? 'border-rose-400 bg-rose-950/60 text-white'
                                : 'border-slate-800 bg-[#0d1322] text-slate-300'
                            }`}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <label className="space-y-0.5 block">
                        <span className="text-[10px] text-slate-400">宽 (px)</span>
                        <input
                          type="number"
                          min={64}
                          max={8192}
                          step={2}
                          disabled={rendering}
                          value={project.width}
                          onChange={(e) =>
                            onUpdateProject((prev) => ({
                              ...prev,
                              width: Math.max(64, Math.min(8192, Number(e.target.value) || 1920)),
                            }))
                          }
                          className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                        />
                      </label>
                      <label className="space-y-0.5 block">
                        <span className="text-[10px] text-slate-400">高 (px)</span>
                        <input
                          type="number"
                          min={64}
                          max={8192}
                          step={2}
                          disabled={rendering}
                          value={project.height}
                          onChange={(e) =>
                            onUpdateProject((prev) => ({
                              ...prev,
                              height: Math.max(64, Math.min(8192, Number(e.target.value) || 1080)),
                            }))
                          }
                          className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                        />
                      </label>
                      <label className="space-y-0.5 block">
                        <span className="text-[10px] text-slate-400">总时长 (s)</span>
                        <input
                          type="number"
                          min={0.5}
                          max={120}
                          step={0.5}
                          disabled={rendering}
                          value={project.durationSec}
                          onChange={(e) => {
                            const nextD = Math.max(0.5, Math.min(120, Number(e.target.value) || 8));
                            onUpdateProject((prev) => ({
                              ...prev,
                              durationSec: nextD,
                              outTimeSec: Math.min(prev.outTimeSec, nextD),
                            }));
                          }}
                          className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-1 items-center">
                      {[12, 24, 30, 60, 120, 165].map((f) => (
                        <button
                          key={f}
                          type="button"
                          disabled={rendering}
                          onClick={() => onUpdateProject((prev) => ({ ...prev, fps: f }))}
                          className={`h-6 px-1.5 rounded-xs border text-[10px] font-mono-tabular cursor-pointer ${
                            project.fps === f
                              ? 'border-emerald-400 bg-emerald-950/60 text-white'
                              : 'border-slate-800 bg-[#0d1322] text-slate-300'
                          }`}
                        >
                          {f}fps
                        </button>
                      ))}
                      <input
                        type="number"
                        min={1}
                        max={300}
                        disabled={rendering}
                        data-testid="director-fps-input"
                        value={project.fps}
                        onChange={(e) =>
                          onUpdateProject((prev) => ({
                            ...prev,
                            fps: Math.max(1, Math.min(300, Math.round(Number(e.target.value) || 60))),
                          }))
                        }
                        className="cad-num w-14 h-6 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[10px]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        disabled={rendering}
                        value={project.format}
                        onChange={(e) =>
                          onUpdateProject((prev) => ({
                            ...prev,
                            format: e.target.value as DirectorExportFormat,
                          }))
                        }
                        className="h-7 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] text-white text-[10px]"
                      >
                        <option value="webm-vp9">WebM VP9 (WebCodecs)</option>
                        <option value="webm-vp8">WebM VP8 (高兼容)</option>
                        <option value="png-tar">PNG 逐帧无损 (.tar)</option>
                      </select>

                      <label className="flex items-center gap-1 text-[10px] text-slate-300 px-1.5 border border-slate-800 rounded-xs bg-[#0d1322]">
                        <span className="text-slate-400 whitespace-nowrap">断点间隔</span>
                        <input
                          type="number"
                          min={4}
                          max={240}
                          disabled={rendering}
                          value={project.checkpointIntervalFrames}
                          onChange={(e) =>
                            onUpdateProject((prev) => ({
                              ...prev,
                              checkpointIntervalFrames: Math.max(4, Math.min(240, Number(e.target.value) || 24)),
                            }))
                          }
                          className="cad-num w-full bg-transparent text-white text-right focus:outline-none"
                        />
                        <span className="text-slate-500">帧</span>
                      </label>
                    </div>
                  </div>

                  {/* Offline Quality Controls */}
                  <div className="p-2 rounded-xs border border-cyan-500/35 bg-[#0b101d] space-y-2">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-white">离线画质策略</span>
                      <span className="font-mono-tabular text-cyan-300">
                        {project.offlineQuality.accumSamples}×SSAA · 光追 {project.offlineQuality.rayTracing ? '开' : '关'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          ['inherit', '沿用实时'],
                          ['cinematic', '影院光追'],
                          ['offline_raytraced', '极限路径'],
                        ] as const
                      ).map(([mode, lbl]) => (
                        <button
                          key={mode}
                          type="button"
                          data-testid={`director-offline-mode-${mode}`}
                          disabled={rendering}
                          onClick={() =>
                            updateOfflineQuality({
                              overrideMode: mode,
                              accumSamples:
                                mode === 'offline_raytraced'
                                  ? 4
                                  : mode === 'cinematic'
                                    ? 2
                                    : 1,
                              rayTracing: mode !== 'inherit',
                              volumetrics: mode !== 'inherit',
                            })
                          }
                          className={`h-6 rounded-xs border text-[10px] cursor-pointer ${
                            project.offlineQuality.overrideMode === mode
                              ? 'border-cyan-400 bg-cyan-950/60 text-white'
                              : 'border-slate-800 bg-[#090d18] text-slate-400'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-[10px] gap-2">
                      <span className="text-slate-400">超采样 SSAA</span>
                      <div className="flex gap-1">
                        {([1, 2, 4, 8] as OfflineAccumSamples[]).map((s) => (
                          <button
                            key={s}
                            type="button"
                            disabled={rendering}
                            onClick={() => updateOfflineQuality({ accumSamples: s })}
                            className={`h-5 px-1.5 rounded-xs border font-mono-tabular cursor-pointer ${
                              project.offlineQuality.accumSamples === s
                                ? 'border-emerald-400 bg-emerald-950/60 text-white'
                                : 'border-slate-800 bg-[#090d18] text-slate-400'
                            }`}
                          >
                            {s}×
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Render Transport Actions */}
                  <div className="space-y-1.5">
                    {!rendering ? (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="director-start-render-btn"
                          onClick={() => void runOfflineJob()}
                          className="flex-1 h-9 px-3 rounded-xs bg-rose-600 hover:bg-rose-500 text-white font-semibold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Film className="w-4 h-4" />
                          <span>开始断点渲染 ({frameRange.endFrame - frameRange.startFrame + 1}帧)</span>
                        </button>
                        {activeJobForResume && (
                          <button
                            type="button"
                            tabIndex={-1}
                            data-testid="director-resume-latest-btn"
                            onClick={() => void runOfflineJob(activeJobForResume)}
                            className="h-9 px-2.5 rounded-xs border border-emerald-500/60 bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-100 text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>续渲染</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="director-pause-checkpoint-btn"
                          onClick={handlePauseAndSaveCheckpoint}
                          className="h-9 px-2 rounded-xs border border-amber-400 bg-amber-950/70 hover:bg-amber-900/70 text-amber-100 font-medium flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>暂停并保存断点</span>
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="director-abort-keep-btn"
                          onClick={handleAbortKeepFrames}
                          className="h-9 px-2 rounded-xs border border-rose-500/70 bg-rose-950/70 hover:bg-rose-900/70 text-rose-100 font-medium flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          <Square className="w-3.5 h-3.5" />
                          <span>中止并保留帧</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Persisted IndexedDB Checkpointed Render Jobs Queue */}
                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200 flex items-center gap-1">
                        <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                        IndexedDB 断点渲染队列 ({renderJobs.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => void refreshDbLists()}
                        className="text-[10px] text-slate-400 hover:text-white cursor-pointer"
                      >
                        刷新
                      </button>
                    </div>

                    {renderJobs.length === 0 ? (
                      <div className="p-2.5 rounded-xs border border-slate-800/80 bg-[#0b101d] text-[10px] text-slate-500">
                        暂无历史断点任务。开始离线渲染后，每帧切片与物理状态均实时写入本地数据库。
                      </div>
                    ) : (
                      <div className="space-y-1.5" data-testid="director-jobs-queue">
                        {renderJobs.map((job) => {
                          const totalRange = Math.max(1, job.endFrame - job.startFrame + 1);
                          const pct = Math.min(100, Math.round((job.completedFrames / totalRange) * 100));
                          const canResume = job.status === 'paused' || job.status === 'aborted';
                          return (
                            <div
                              key={job.id}
                              className="p-2 rounded-xs border border-slate-800 bg-[#0b101d] space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-white truncate">
                                  {job.projectName}
                                </span>
                                <span
                                  className={`text-[10px] whitespace-nowrap ${
                                    job.status === 'completed'
                                      ? 'text-emerald-300'
                                      : canResume
                                        ? 'text-amber-300'
                                        : 'text-rose-300'
                                  }`}
                                >
                                  {JOB_STATUS_LABEL[job.status]}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[10px] font-mono-tabular text-slate-400">
                                <span>
                                  {job.width}×{job.height} · {job.fps}fps
                                </span>
                                <span>
                                  {job.completedFrames}/{totalRange} 帧 ({pct}%)
                                </span>
                              </div>
                              <div className="h-1 w-full bg-slate-800 rounded-xs overflow-hidden">
                                <div
                                  className={`h-full ${
                                    job.status === 'completed' ? 'bg-emerald-500' : 'bg-cyan-400'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="flex items-center gap-1 pt-0.5">
                                {canResume && (
                                  <button
                                    type="button"
                                    disabled={rendering}
                                    onClick={() => void runOfflineJob(job)}
                                    className="h-6 px-2 rounded-xs border border-emerald-500/50 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-200 text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                    <span>断点续渲染</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={rendering || job.completedFrames <= 0}
                                  onClick={() => void handleSafeExportJob(job)}
                                  className="h-6 px-2 rounded-xs border border-sky-500/50 bg-sky-950/50 hover:bg-sky-900/60 text-sky-200 text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>{job.status === 'completed' ? '导出成片' : '安全导出已渲染帧'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleInspectJobFilmstrip(job)}
                                  className="h-6 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] hover:border-slate-500 text-slate-300 text-[10px] cursor-pointer"
                                  title="加载逐帧胶片条预览"
                                >
                                  胶片
                                </button>
                                <button
                                  type="button"
                                  disabled={rendering}
                                  onClick={() =>
                                    void deleteRenderJobAndAssetsFromDb(job.id).then(() =>
                                      refreshDbLists(),
                                    )
                                  }
                                  className="ml-auto h-6 w-6 rounded-xs border border-slate-800 hover:border-rose-500/60 text-slate-400 hover:text-rose-300 flex items-center justify-center cursor-pointer disabled:opacity-40"
                                  title="彻底删除此任务及已存帧切片"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* Bottom Multi-Track & Per-Parameter NLE Timeline Dock */}
        <TimelineTrackPanel
          project={project}
          playheadSec={playheadSec}
          selectedItem={selectedItem}
          disabled={rendering}
          onScrubTime={(t) => {
            setPlaying(false);
            handleScrubTime(t);
          }}
          onSetInOut={(inT, outT) =>
            onUpdateProject((prev) => ({
              ...prev,
              inTimeSec: Number(inT.toFixed(3)),
              outTimeSec: Number(outT.toFixed(3)),
            }))
          }
          onSelectItem={(item) => setSelectedItem(item)}
          onMoveItemTime={handleMoveItemTime}
          onMoveParamKeyframeTime={handleMoveParamKeyframeTime}
          onAddCameraKeyframeAtPlayhead={handleAddCameraKeyframeAtPlayhead}
          onAddEnvKeyframeAtPlayhead={handleAddEnvKeyframeAtPlayhead}
          onAddEventAtPlayhead={() => handleAddEventAtPlayhead('volcano')}
          onAddPostFxKeyframeAtPlayhead={handleAddPostFxKeyframeAtPlayhead}
          onAddParamKeyframeAtPlayhead={(pid) => handleAddParamKeyframeAtPlayhead(pid)}
          onDeleteSelectedItem={handleDeleteSelectedItem}
        />
      </div>

      {/* Sibling Floating Program Monitor Overlay (Stacks cleanly above docked z-[32] WebGPU canvas) */}
      {programRect && (showGuides || curAspectMask !== 'none' || pickEventTargetId || rendering) && (
        <div
          style={{
            top: `${programRect.top}px`,
            left: `${programRect.left}px`,
            width: `${programRect.width}px`,
            height: `${programRect.height}px`,
          }}
          onClick={(e) => {
            if (!pickEventTargetId) return;
            const picked = engine.pickLatLonAtClientXY(e.clientX, e.clientY);
            if (picked) {
              const targetId = pickEventTargetId;
              onUpdateProject((prev) => ({
                ...prev,
                eventTrack: prev.eventTrack.map((ev) =>
                  ev.id === targetId
                    ? { ...ev, latDeg: picked.latDeg, lonDeg: picked.lonDeg }
                    : ev,
                ),
              }));
              setPickEventTargetId(null);
              flashNotice(`已精确拾取星球靶点 (${picked.latDeg}°, ${picked.lonDeg}°)`);
            } else {
              flashNotice('未命中星球实体表面，请直接点击星球球体区域');
            }
          }}
          className={`fixed z-[34] overflow-hidden ${
            pickEventTargetId
              ? 'pointer-events-auto cursor-crosshair ring-2 ring-rose-500/80'
              : 'pointer-events-none'
          }`}
        >
          {/* Rule of Thirds & Safe-Area Frame Guides */}
          {showGuides && (
            <>
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                <div className="border-r border-b border-white/10" />
                <div className="border-r border-b border-white/10" />
                <div className="border-b border-white/10" />
                <div className="border-r border-b border-white/10" />
                <div className="border-r border-b border-white/10" />
                <div className="border-b border-white/10" />
                <div className="border-r border-white/10" />
                <div className="border-r border-white/10" />
                <div />
              </div>
              <div className="absolute inset-[6%] border border-dashed border-amber-400/25 pointer-events-none" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-400/50" />
                <div className="absolute top-1/2 left-0 right-0 h-px bg-cyan-400/50" />
              </div>
            </>
          )}

          {/* Visual Cinema Aspect Matte Mask */}
          {curAspectMask === '2.39:1' && (
            <>
              <div className="absolute top-0 left-0 right-0 h-[12%] bg-black/95 pointer-events-none" />
              <div className="absolute bottom-0 left-0 right-0 h-[12%] bg-black/95 pointer-events-none" />
            </>
          )}
          {curAspectMask === '9:16' && (
            <>
              <div className="absolute top-0 bottom-0 left-0 w-[33%] bg-black/95 pointer-events-none" />
              <div className="absolute top-0 bottom-0 right-0 w-[33%] bg-black/95 pointer-events-none" />
            </>
          )}

          {/* Pick Target Prompt Banner */}
          {pickEventTargetId && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-xs bg-rose-950/90 border border-rose-400 text-xs text-white font-medium shadow-lg">
              靶点拾取模式：请点击星球任意位置锁定经纬度 [Esc 取消]
            </div>
          )}

          {/* Rendering Lock Watermark */}
          {rendering && (
            <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-xs bg-[#05070d]/90 border border-rose-500/60 text-[11px] font-mono-tabular text-rose-200 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              <span>离线断点渲染管线运行中 · {renderProgress?.percent.toFixed(1) ?? 0}%</span>
            </div>
          )}
        </div>
      )}

      {/* High-Resolution Screenshot Modal Overlay */}
      {screenshotModalOpen && (
        <div
          data-testid="director-screenshot-modal"
          className="fixed inset-0 z-[40] bg-black/75 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-sm border border-slate-700 bg-[#090d18] p-4 space-y-3 text-xs text-slate-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-display font-semibold text-white flex items-center gap-1.5">
                <Aperture className="w-4 h-4 text-sky-400" />
                超清离线静帧截屏 (高达 8K / 8×SSAA)
              </span>
              <button
                type="button"
                onClick={() => setScreenshotModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap gap-1">
              {RESOLUTION_PRESETS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setShotWidth(r.width);
                    setShotHeight(r.height);
                  }}
                  className={`h-6 px-2 rounded-xs border text-[10px] cursor-pointer ${
                    shotWidth === r.width && shotHeight === r.height
                      ? 'border-sky-400 bg-sky-950/60 text-white'
                      : 'border-slate-800 bg-[#0d1322] text-slate-300'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-0.5 block">
                <span className="text-[10px] text-slate-400">宽 (px)</span>
                <input
                  type="number"
                  min={64}
                  max={8192}
                  value={shotWidth}
                  onChange={(e) => setShotWidth(Number(e.target.value) || 3840)}
                  className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                />
              </label>
              <label className="space-y-0.5 block">
                <span className="text-[10px] text-slate-400">高 (px)</span>
                <input
                  type="number"
                  min={64}
                  max={8192}
                  value={shotHeight}
                  onChange={(e) => setShotHeight(Number(e.target.value) || 2160)}
                  className="cad-num w-full h-7 px-2 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                />
              </label>
              <label className="space-y-0.5 block">
                <span className="text-[10px] text-slate-400">格式</span>
                <select
                  value={shotFormat}
                  onChange={(e) => setShotFormat(e.target.value as ScreenshotFormat)}
                  className="w-full h-7 px-1.5 rounded-xs border border-slate-700 bg-[#0d1322] text-white"
                >
                  <option value="png">PNG 无损</option>
                  <option value="webp">WebP</option>
                  <option value="jpeg">JPEG</option>
                </select>
              </label>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={shotHideHelpers}
                  onChange={(e) => setShotHideHelpers(e.target.checked)}
                  className="accent-sky-400"
                />
                <span>隐藏轨迹线与辅助轮廓</span>
              </label>
              <span className="font-mono-tabular text-[10px] text-slate-400">
                GPU上限 {hardwareCaps.maxGpuTextureDim}px
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setScreenshotModalOpen(false)}
                className="h-8 px-3 rounded-xs border border-slate-700 bg-[#0d1322] text-slate-300 cursor-pointer"
              >
                关闭
              </button>
              <button
                type="button"
                disabled={shotBusy}
                data-testid="director-capture-screenshot-btn"
                onClick={() => void handleRunHighResScreenshot()}
                className="h-8 px-4 rounded-xs bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <Aperture className="w-3.5 h-3.5" />
                <span>{shotBusy ? '采样渲染中...' : '立即捕获并下载'}</span>
              </button>
            </div>

            {lastShotPreview && (
              <div className="pt-2 border-t border-slate-800 space-y-1">
                <img
                  src={lastShotPreview.dataUrl}
                  alt="超清截屏预览"
                  className="w-full h-28 object-cover rounded-xs border border-slate-700"
                />
                <div className="flex items-center gap-1 text-[10px] text-emerald-300 font-mono-tabular">
                  <Check className="w-3 h-3" />
                  <span>已保存：{lastShotPreview.label}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
