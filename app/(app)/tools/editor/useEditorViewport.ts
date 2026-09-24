"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  clampPan,
  clampZoomPercent,
  EDITOR_VIEWPORT_ZOOM_FIT,
  EDITOR_VIEWPORT_ZOOM_MAX,
  EDITOR_VIEWPORT_ZOOM_MIN,
  isFitViewport,
  panForZoomAtPoint,
  stepZoomPercent,
  zoomPercentFromPinch,
  zoomPercentFromWheel,
  type ViewportPan,
  type ViewportSize,
} from "@/lib/editor-viewport";

/**
 * Local, isolated zoom/pan UI state for the editor preview stage. Never
 * touches EditorDocument, overlay coordinates, or the timeline — purely how
 * the canvas is viewed. `fitSize` is the existing contain-fit box (100% zoom);
 * `stageSize` is the available preview area.
 */
export function useEditorViewport(
  stageRef: RefObject<HTMLDivElement | null>,
  fitSize: ViewportSize,
  stageSize: { w: number; h: number },
  handMode = false
) {
  const [zoomPercent, setZoomPercentState] = useState(EDITOR_VIEWPORT_ZOOM_FIT);
  const [pan, setPanState] = useState<ViewportPan>({ x: 0, y: 0 });
  const [spacePanning, setSpacePanning] = useState(false);
  const [panning, setPanning] = useState(false);

  // Latest values in refs so the native listeners below never need re-attaching.
  const zoomRef = useRef(zoomPercent);
  const panRef = useRef(pan);
  const fitSizeRef = useRef(fitSize);
  const stageSizeRef = useRef(stageSize);
  const pointerOverStageRef = useRef(false);
  zoomRef.current = zoomPercent;
  panRef.current = pan;
  fitSizeRef.current = fitSize;
  stageSizeRef.current = stageSize;

  const displaySizeOf = (percent: number): ViewportSize => ({
    width: fitSizeRef.current.width * (percent / 100),
    height: fitSizeRef.current.height * (percent / 100),
  });

  const applyZoomAndPan = (nextPercent: number, nextPan: ViewportPan) => {
    const clampedPercent = clampZoomPercent(nextPercent);
    const clampedPan = clampPan(nextPan, displaySizeOf(clampedPercent), stageSizeRef.current);
    setZoomPercentState(clampedPercent);
    setPanState(clampedPan);
  };

  // Re-clamp pan whenever the fit size or stage size changes (resize, aspect switch)
  // without changing zoom — this is also what snaps pan back to 0 once the canvas
  // fits the stage again.
  useEffect(() => {
    setPanState((current) => clampPan(current, displaySizeOf(zoomPercent), stageSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSize.width, fitSize.height, stageSize.w, stageSize.h, zoomPercent]);

  const zoomIn = () => applyZoomAndPan(stepZoomPercent(zoomRef.current, 1), panRef.current);
  const zoomOut = () => applyZoomAndPan(stepZoomPercent(zoomRef.current, -1), panRef.current);
  const fit = () => applyZoomAndPan(EDITOR_VIEWPORT_ZOOM_FIT, { x: 0, y: 0 });
  const setZoom = (percent: number) => applyZoomAndPan(clampZoomPercent(percent), panRef.current);

  const zoomAtStagePoint = (point: ViewportPan, deltaY: number) => {
    const nextPercent = zoomPercentFromWheel(zoomRef.current, deltaY);
    const nextPan = panForZoomAtPoint(panRef.current, zoomRef.current, nextPercent, point);
    applyZoomAndPan(nextPercent, nextPan);
  };

  // Space held while the pointer is over the stage arms pan mode; released, it
  // falls back to the app-wide play/pause shortcut (see EditorWorkspace).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      if (!pointerOverStageRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      setSpacePanning(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      setSpacePanning(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Cmd/Ctrl+0 (fit/reset) and Cmd/Ctrl +/- (zoom), skipped inside text inputs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "0") {
        event.preventDefault();
        fit();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl/Cmd+wheel (desktop fallback) and trackpad pinch (browsers report pinch
  // as a synthetic ctrlKey wheel event) zoom toward the cursor. Plain wheel is
  // left alone. Native listener with { passive: false } so preventDefault works.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        const point = {
          x: event.clientX - rect.left - rect.width / 2,
          y: event.clientY - rect.top - rect.height / 2,
        };
        zoomAtStagePoint(point, event.deltaY);
        return;
      }
      // Plain two-finger trackpad scroll (no modifier) pans instead.
      event.preventDefault();
      applyZoomAndPan(zoomRef.current, {
        x: panRef.current.x - event.deltaX,
        y: panRef.current.y - event.deltaY,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRef]);

  // Middle-mouse drag, or left-drag while Space is held, pans. Two-finger
  // touch drags pan+pinch-zoom together. Left-drag alone is left for overlay
  // selection/move, so this only starts when the pointer isn't already
  // claimed by an overlay (those call stopPropagation on their own drags).
  const activeTouches = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; midpoint: ViewportPan; zoom: number; pan: ViewportPan } | null>(null);

  const onStagePointerEnter = () => {
    pointerOverStageRef.current = true;
  };
  const onStagePointerLeave = () => {
    pointerOverStageRef.current = false;
  };

  const onStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      activeTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activeTouches.current.size === 2) {
        const [a, b] = [...activeTouches.current.values()];
        pinchStart.current = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          zoom: zoomRef.current,
          pan: panRef.current,
        };
      }
      return;
    }
    const isMiddleClick = event.button === 1;
    // Space+drag or the Hand tool both pan a plain left-drag; overlay drags call
    // stopPropagation on their own pointerdown so they never reach here.
    const isPanDrag = event.button === 0 && (spacePanning || handMode);
    if (!isMiddleClick && !isPanDrag) return;
    event.preventDefault();
    event.stopPropagation();
    const startClient = { x: event.clientX, y: event.clientY };
    const startPan = panRef.current;
    setPanning(true);
    const move = (ev: PointerEvent) => {
      applyZoomAndPan(zoomRef.current, {
        x: startPan.x + (ev.clientX - startClient.x),
        y: startPan.y + (ev.clientY - startClient.y),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPanning(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || !activeTouches.current.has(event.pointerId)) return;
    activeTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeTouches.current.size !== 2 || !pinchStart.current) return;
    const [a, b] = [...activeTouches.current.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const start = pinchStart.current;
    const nextPercent = zoomPercentFromPinch(start.zoom, distance / (start.distance || 1));
    const rect = stageRef.current?.getBoundingClientRect();
    const anchor = rect
      ? { x: start.midpoint.x - rect.left - rect.width / 2, y: start.midpoint.y - rect.top - rect.height / 2 }
      : { x: 0, y: 0 };
    const zoomedPan = panForZoomAtPoint(start.pan, start.zoom, nextPercent, anchor);
    const panDelta = { x: midpoint.x - start.midpoint.x, y: midpoint.y - start.midpoint.y };
    applyZoomAndPan(nextPercent, { x: zoomedPan.x + panDelta.x, y: zoomedPan.y + panDelta.y });
  };

  const endTouch = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    activeTouches.current.delete(event.pointerId);
    if (activeTouches.current.size < 2) pinchStart.current = null;
  };

  const displaySize = displaySizeOf(zoomPercent);

  return {
    zoomPercent,
    pan,
    panning,
    spacePanning,
    isFit: isFitViewport(zoomPercent, pan),
    canZoomIn: zoomPercent < EDITOR_VIEWPORT_ZOOM_MAX,
    canZoomOut: zoomPercent > EDITOR_VIEWPORT_ZOOM_MIN,
    zoomIn,
    zoomOut,
    fit,
    setZoom,
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomPercent / 100})`,
    displaySize,
    pointerOverStageRef,
    stageHandlers: {
      onPointerEnter: onStagePointerEnter,
      onPointerLeave: onStagePointerLeave,
      onPointerDown: onStagePointerDown,
      onPointerMove: onStagePointerMove,
      onPointerUp: endTouch,
      onPointerCancel: endTouch,
    },
  };
}
