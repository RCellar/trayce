// Must be imported BEFORE any other pixi.js imports — patches PixiJS to work
// without unsafe-eval (replaces new Function() with CSP-safe alternatives)
import "pixi.js/unsafe-eval";

import { BrushSettingsUI } from "./brush-settings-ui";
import { EraserBrush } from "./brushes/eraser";
import { HighlighterBrush } from "./brushes/highlighter";
import { MarkerBrush } from "./brushes/marker";
import { PenBrush } from "./brushes/pen";
import { PencilBrush } from "./brushes/pencil";
import type { Brush, BrushParams } from "./brushes/types";
import { WatercolorBrush } from "./brushes/watercolor";
import { CanvasManager } from "./canvas";
import { CanvasLock } from "./canvas-lock";
import { ColorPicker } from "./color-picker";
import { Compositor } from "./compositor";
import { buildWsUrl, Connection, type ServerMessage } from "./connection";
import { blobToBase64, flattenToPng, isCanvasBlank } from "./export";
import { FloatingPanel } from "./floating-panel";
import { History } from "./history";
import { InputHandler, type InputState } from "./input";
import { type BlendMode, type Layer, LayerManager } from "./layers";
import { LayersUI } from "./layers-ui";
import { PermissionPromptManager } from "./permission-prompts";
import {
  loadLayers,
  persistenceKey,
  pruneStaleEntries,
  type SavedLayer,
  SCRATCHPAD_KEY,
  saveLayers,
} from "./persistence";
import { PowerPopover } from "./power-popover";
import { ResponseTab } from "./response-tab";
import { SidePanel } from "./side-panel";
import { formatTabTitle } from "./tab-title";
import { ThemeManager } from "./theme";
import { showToast } from "./toast";
import { type ActionId, Toolbar, type ToolId } from "./toolbar";
import { ImageTool } from "./tools/image";
import { TranscriptTab } from "./transcript-tab";
import { TransformHandler } from "./transform";
import { UsageTab } from "./usage-tab";

// -- Type Declarations --

declare global {
  interface Window {
    __trayceReady?: boolean;
  }
}

// -- State --

let canvasManager: CanvasManager | null = null;
let layerManager: LayerManager | null = null;
let compositor: Compositor | null = null;
let inputHandler: InputHandler | null = null;
let connection: Connection | null = null;

const brushes: Record<string, Brush> = {
  pen: new PenBrush(),
  pencil: new PencilBrush(),
  marker: new MarkerBrush(),
  watercolor: new WatercolorBrush(),
  highlighter: new HighlighterBrush(),
  eraser: new EraserBrush(),
};

let activeBrush: Brush = brushes.pen!;
let brushParams: BrushParams = {
  size: 12,
  opacity: 100,
  flow: 80,
  smoothing: 50,
  color: "#000000",
};

let imageTool: ImageTool | null = null;
let transformHandler: TransformHandler | null = null;
let permissionPrompts: PermissionPromptManager | null = null;

let sessions: Array<{ id: string; label: string; status: string; sessionStartedAt?: number }> = [];
let selectedSessionId = "";
let sessionStartedAt: number | null = null;

let containerMode = false; // Set by the server-info message on connect

let sidePanel: SidePanel | null = null;
let responseTab: ResponseTab | null = null;
let transcriptTab: TranscriptTab | null = null;
let usageTab: UsageTab | null = null;
let history: History | null = null;

const canvasLock = new CanvasLock();
let currentCanvasKey: string = SCRATCHPAD_KEY;
let suppressCanvasPush = false;

function updateTabTitle(): void {
  document.title = formatTabTitle(sessions, selectedSessionId);
}

async function saveCurrentCanvas(): Promise<void> {
  if (!layerManager) return;
  // Scratchpad is ephemeral — don't persist it
  if (currentCanvasKey === SCRATCHPAD_KEY) return;
  try {
    const layers: SavedLayer[] = await Promise.all(
      layerManager.layers.map(async (layer) => {
        const blob = await layer.canvas.convertToBlob({ type: "image/png" });
        return {
          id: layer.id,
          name: layer.name,
          blob,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          visible: layer.visible,
          locked: layer.locked,
          deletable: layer.deletable,
          ...(layer.transform ? { transform: { ...layer.transform } } : {}),
        };
      }),
    );
    await saveLayers(currentCanvasKey, layers);
  } catch (err) {
    console.error("[trayce] Failed to save canvas:", err);
  }
}

async function restoreCanvas(key: string): Promise<void> {
  if (!layerManager || !compositor) return;

  // Suppress canvas-push messages during restore — the server replays buffered
  // pushes on watch-session, but those layers are already in the persisted state.
  suppressCanvasPush = true;

  try {
    // Scratchpad is always a fresh blank canvas — never restore persisted state
    const saved = key === SCRATCHPAD_KEY ? null : await loadLayers(key);
    if (!saved || saved.length === 0) {
      // No persisted state — create fresh canvas with background + sketch layer
      createFreshCanvas(layerManager);
    } else {
      // Restore persisted layers
      const restoredLayers: Layer[] = await Promise.all(
        saved.map(async (s) => {
          const img = await createImageBitmap(s.blob);
          const canvas = new OffscreenCanvas(img.width, img.height);
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          img.close();
          return {
            id: s.id,
            name: s.name,
            canvas,
            ctx,
            visible: s.visible,
            opacity: s.opacity,
            blendMode: s.blendMode as BlendMode,
            locked: s.locked,
            deletable: s.deletable,
            ...(s.transform ? { transform: { ...s.transform } } : {}),
            revision: 0,
          };
        }),
      );
      layerManager.replaceAll(restoredLayers);
    }
  } catch (err) {
    console.error("[trayce] Failed to restore canvas:", err);
    showToast("Failed to restore canvas — starting fresh");
    createFreshCanvas(layerManager);
  }

  compositor.rebuild();
  history?.clear();
  layersUI?.render();
  updateLayerInfo();
  transformHandler?.updateOverlay();
  currentCanvasKey = key;

  // Allow canvas-push messages again after a tick — buffer replay is synchronous
  // from the server's perspective but arrives via WebSocket message events which
  // are queued in the microtask/event loop. Use setTimeout to wait for them.
  setTimeout(() => {
    suppressCanvasPush = false;
  }, 500);
}

function createFreshCanvas(lm: LayerManager): void {
  const bg: Layer = {
    id: crypto.randomUUID(),
    name: "Background",
    canvas: new OffscreenCanvas(lm.docWidth, lm.docHeight),
    ctx: null as any,
    visible: true,
    opacity: 100,
    blendMode: "normal",
    locked: true,
    deletable: false,
    revision: 0,
  };
  bg.ctx = bg.canvas.getContext("2d")!;
  bg.ctx.fillStyle = "#f0f0f0";
  bg.ctx.fillRect(0, 0, lm.docWidth, lm.docHeight);

  const sketch: Layer = {
    id: crypto.randomUUID(),
    name: "Sketch",
    canvas: new OffscreenCanvas(lm.docWidth, lm.docHeight),
    ctx: null as any,
    visible: true,
    opacity: 100,
    blendMode: "normal",
    locked: false,
    deletable: true,
    revision: 0,
  };
  sketch.ctx = sketch.canvas.getContext("2d")!;

  lm.replaceAll([bg, sketch]);
}

let switchInFlight: Promise<void> | null = null;

async function switchSession(sessionId: string | null): Promise<void> {
  // Serialize: wait for any in-flight switch to finish before starting a new one
  if (switchInFlight) await switchInFlight;
  switchInFlight = doSwitchSession(sessionId);
  try {
    await switchInFlight;
  } finally {
    switchInFlight = null;
  }
}

async function doSwitchSession(sessionId: string | null): Promise<void> {
  const newKey = sessionId ? persistenceKey(sessionId) : SCRATCHPAD_KEY;
  if (newKey === currentCanvasKey) return;

  await saveCurrentCanvas();

  if (sessionId) {
    const acquired = await canvasLock.claim(sessionId);
    if (!acquired) {
      showToast("This session's canvas is active in another tab");
      // Roll back UI state — the dropdown may already show this session
      const fallbackId = currentCanvasKey === SCRATCHPAD_KEY ? "" : selectedSessionId;
      selectedSessionId = fallbackId;
      sessionSelect.value = fallbackId;
      submitBtn.disabled = !connection?.isConnected || !fallbackId;
      updateTabTitle();
      return;
    }
  } else {
    canvasLock.release();
  }

  await restoreCanvas(newKey);
}

// -- DOM Elements --

const canvasContainer = document.getElementById("canvas-container")!;
const canvasInfo = document.getElementById("canvas-info")!;
const sessionSelect = document.getElementById("session-select") as HTMLSelectElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const promptInput = document.getElementById("prompt-input") as HTMLInputElement;
const connectionStatus = document.getElementById("connection-status")!;
const toolInfo = document.getElementById("tool-info")!;
const layerInfo = document.getElementById("layer-info")!;
const powerBtn = document.getElementById("server-power-btn") as HTMLButtonElement;

canvasLock.onEvicted = async () => {
  await saveCurrentCanvas();
  await restoreCanvas(SCRATCHPAD_KEY);
  selectedSessionId = "";
  sessionSelect.value = "";
  showToast("Session canvas claimed by another tab — switched to scratchpad");
  updateTabTitle();
};

let toolbar: Toolbar | null = null;
let layersUI: LayersUI | null = null;
let floatingPanel: FloatingPanel | null = null;

// -- Initialize UI Components --

function initUIComponents(): void {
  // Toolbar
  const toolbarEl = document.getElementById("toolbar")!;
  toolbar = new Toolbar(toolbarEl, {
    onToolChange: (toolId: ToolId) => {
      if (toolId === "image") {
        imageTool?.openFilePicker();
        // Revert toolbar highlight to the current brush — image is an instant action
        const currentBrushId = Object.entries(brushes).find(([, b]) => b === activeBrush)?.[0];
        if (currentBrushId) toolbar?.setActive(currentBrushId as ToolId);
        return;
      }
      if (brushes[toolId]) {
        activeBrush = brushes[toolId];
        updateToolInfo();
      }
    },
    onAction: (actionId: ActionId) => {
      if (actionId === "clear") {
        clearCanvas();
      }
    },
    onPanelToggle: (panelId) => {
      if (panelId === "floating") {
        floatingPanel?.toggle();
        toolbar?.setPanelActive(floatingPanel?.visible ? "floating" : null);
        return;
      }
      sidePanel?.toggle(panelId);
      toolbar?.setPanelActive(sidePanel?.isOpen ? sidePanel.activeTab : null);

      if (sidePanel?.isOpen) {
        const responseContainer = sidePanel.getResponseContainer();
        const transcriptContainer = sidePanel.getTranscriptContainer();
        if (responseContainer && responseTab && !responseContainer.dataset.mounted) {
          responseTab.mount(responseContainer);
          responseContainer.dataset.mounted = "true";
        }
        if (transcriptContainer && transcriptTab && !transcriptContainer.dataset.mounted) {
          transcriptTab.mount(transcriptContainer);
          transcriptContainer.dataset.mounted = "true";
        }
        const usageContainer = sidePanel.getUsageContainer();
        if (usageContainer && usageTab && !usageContainer.dataset.mounted) {
          usageTab.mount(usageContainer);
          usageContainer.dataset.mounted = "true";
        }
      }
    },
  });

  // Image import tool — paste and drop are always-on, file picker via toolbar/shortcut
  imageTool = new ImageTool({
    onImport: (bitmap, name) => handleImageImport(bitmap, name),
  });
  imageTool.setupPasteHandler();
  imageTool.setupDropHandler(canvasContainer);

  // Floating panel (brush + layers)
  floatingPanel = new FloatingPanel({ defaultX: 20, defaultY: 20 });
  floatingPanel.mount(canvasContainer);

  const brushContainer = floatingPanel.getBrushContainer();
  if (brushContainer) {
    new BrushSettingsUI(brushContainer, brushParams, {
      onParamsChange: (params) => {
        brushParams = params;
        updateToolInfo();
      },
    });

    new ColorPicker(brushContainer, {
      onColorChange: (color) => {
        brushParams.color = color;
      },
    });
  }

  // Side panel
  const sidePanelEl = document.getElementById("side-panel")!;
  sidePanel = new SidePanel();
  sidePanel.mount(sidePanelEl, () => {
    canvasManager?.resize();
  });

  responseTab = new ResponseTab();
  transcriptTab = new TranscriptTab();
  usageTab = new UsageTab();

  // Mount tabs eagerly so buffered transcript entries aren't lost
  const responseContainer = sidePanel.getResponseContainer();
  const transcriptContainer = sidePanel.getTranscriptContainer();
  if (responseContainer) {
    responseTab.mount(responseContainer);
    responseContainer.dataset.mounted = "true";
  }
  if (transcriptContainer) {
    transcriptTab.mount(transcriptContainer);
    transcriptContainer.dataset.mounted = "true";
  }
  const usageContainer = sidePanel.getUsageContainer();
  if (usageContainer) {
    usageTab.mount(usageContainer);
    usageContainer.dataset.mounted = "true";
  }

  // Theme
  const themeManager = new ThemeManager();
  const gearContainer = document.getElementById("gear-container");
  if (gearContainer) themeManager.attachGearIcon(gearContainer);
}

// -- Resolution Selector --

const RESOLUTIONS = [
  { label: "1920 × 1080 (HD)", w: 1920, h: 1080 },
  { label: "2560 × 1440 (QHD)", w: 2560, h: 1440 },
  { label: "3840 × 2160 (4K)", w: 3840, h: 2160 },
  { label: "4096 × 4096 (Max)", w: 4096, h: 4096 },
];

function initResolutionSelector(): void {
  const select = document.createElement("select");
  select.id = "resolution-select";
  select.style.cssText =
    "background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:11px;margin-left:8px;";

  for (const res of RESOLUTIONS) {
    const opt = document.createElement("option");
    opt.value = `${res.w}x${res.h}`;
    opt.textContent = res.label;
    select.appendChild(opt);
  }

  select.value = "1920x1080";

  select.addEventListener("change", () => {
    const [w, h] = select.value.split("x").map(Number);
    if (w === undefined || h === undefined) return;
    initCanvas(w, h, "white");
  });

  // Insert after canvas-info in the top bar
  canvasInfo.parentElement!.appendChild(select);
}

// -- Canvas Initialization --

async function initCanvas(
  width: number,
  height: number,
  background: "white" | "transparent",
): Promise<void> {
  // Clean up previous
  if (canvasManager) canvasManager.destroy();
  if (compositor) compositor.destroy();
  if (inputHandler) inputHandler.destroy();

  canvasManager = await CanvasManager.create(canvasContainer, width, height);
  layerManager = new LayerManager(width, height, background);
  // Add a user draw layer above the background so strokes don't land on
  // the layer that isCanvasBlank deliberately excludes from content checks.
  layerManager.addLayer("Sketch");
  compositor = new Compositor(canvasManager.app, layerManager);
  history = new History(50 * 1024 * 1024); // 50MB budget
  transformHandler = new TransformHandler({
    layerManager: () => layerManager,
    compositor: () => compositor,
    canvasManager: () => canvasManager,
  });

  // Add compositor container to stage (inside zoom/pan)
  canvasManager.stage.addChild(compositor.getContainer());

  // Add overlay to app.stage directly (screen-space, above everything)
  canvasManager.app.stage.addChild(compositor.getOverlay());

  // Defer initial composite to next frame so WebGL context is ready
  requestAnimationFrame(() => {
    compositor?.markDirty();
    compositor?.update();
  });

  // Layers UI
  const layersContainer = floatingPanel?.getLayersContainer();
  if (!layersContainer) return;
  layersUI = new LayersUI(layersContainer, layerManager, {
    onActiveChange: (index) => {
      layerManager!.activeLayerIndex = index;
      layersUI?.render();
      updateLayerInfo();
      transformHandler?.updateOverlay();
    },
    onVisibilityToggle: (index) => {
      const layer = layerManager!.layers[index];
      if (!layer) return;
      layer.visible = !layer.visible;
      compositor?.markDirty();
      layersUI?.render();
    },
    onAddLayer: () => {
      layerManager!.addLayer(`Layer ${layerManager!.layers.length}`);
      compositor?.markDirty();
      layersUI?.render();
      updateLayerInfo();
    },
    onMoveLayer: (from, to) => {
      layerManager!.moveLayer(from, to);
      compositor?.markDirty();
      layersUI?.render();
      updateLayerInfo();
      transformHandler?.updateOverlay();
    },
    onDeleteLayer: (index) => {
      try {
        layerManager!.deleteLayer(index);
        compositor?.markDirty();
        layersUI?.render();
        updateLayerInfo();
        transformHandler?.updateOverlay();
      } catch (_e) {
        showToast("Cannot delete this layer");
      }
    },
    onRasterize: (index) => {
      layerManager!.rasterizeLayer(index);
      compositor?.markDirty();
      layersUI?.render();
      transformHandler?.updateOverlay();
      showToast("Layer rasterized");
    },
  });

  // Update info
  canvasInfo.textContent = canvasManager.getCanvasInfo();
  updateToolInfo();
  updateLayerInfo();

  // Input handler — bind to the actual PixiJS canvas element, not the container,
  // because the canvas element intercepts pointer events
  const pixiCanvas = canvasManager.app.canvas as HTMLCanvasElement;
  inputHandler = new InputHandler(pixiCanvas, handleInput);

  // Render loop
  canvasManager.app.ticker.add(() => {
    compositor?.update();
    transformHandler?.updateOverlay();
  });
}

// -- Drawing --

function handleInput(state: InputState, event: "start" | "move" | "end"): void {
  if (!layerManager || !canvasManager) return;
  const layer = layerManager.activeLayer;
  if (layer.locked) return;

  // Get current doc-space point
  const lastPt = state.points[state.points.length - 1];
  if (!lastPt) return;
  const doc = canvasManager.screenToDoc(lastPt.x, lastPt.y);

  // If active layer has a transform, handle move/resize instead of drawing
  if (layer.transform) {
    transformHandler?.handleInput(layer.transform, doc.x, doc.y, event);
    return;
  }

  // Transform screen coords to doc coords
  const docPoints = state.points.map((p) => {
    const d = canvasManager!.screenToDoc(p.x, p.y);
    return { x: d.x, y: d.y, pressure: p.pressure };
  });

  if (event === "start") {
    activeBrush.beginStroke(layer.ctx, brushParams);
  }

  if (event === "move" || event === "start") {
    activeBrush.drawStroke(layer.ctx, docPoints, brushParams);
    compositor?.markDirty();
    layerManager.bumpRevision(layer.id);
  }

  if (event === "end") {
    activeBrush.endStroke(layer.ctx, brushParams);
    compositor?.markDirty();

    if (history && layerManager) {
      layerManager.bumpRevision(layer.id);
      const shouldCP = history.shouldCheckpoint();
      if (shouldCP) {
        layer.canvas.convertToBlob().then((blob) => {
          history!.push({
            type: "stroke",
            layerId: layer.id,
            data: null,
            checkpoint: blob,
            checkpointSize: blob.size,
          });
          history!.resetCheckpointCounter();
        });
      } else {
        history.push({
          type: "stroke",
          layerId: layer.id,
          data: null,
        });
      }
    }
  }
}

// -- Connection --

function initConnection(): void {
  // Read token from URL query params
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  // Store token in localStorage for subsequent visits
  if (token) {
    localStorage.setItem("trayce-token", token);
  }
  const storedToken = token || localStorage.getItem("trayce-token") || "";

  const wsUrl = buildWsUrl(
    window.location.hostname,
    parseInt(window.location.port, 10) || 9740,
    storedToken,
  );

  connection = new Connection(wsUrl, handleConnectionStatus, handleServerMessage);
  permissionPrompts = new PermissionPromptManager({
    connection: () => connection,
    container: document.getElementById("toast-container")!,
  });
  connection.connect();
  new PowerPopover({
    powerBtn,
    connection: () => connection,
    containerMode: () => containerMode,
  });
}

function handleConnectionStatus(status: "connected" | "disconnected" | "reconnecting"): void {
  connectionStatus.className = `status ${status}`;
  const text = connectionStatus.querySelector(".text")!;

  if (status === "connected") {
    text.textContent = `Connected · ${sessions.length} session${sessions.length !== 1 ? "s" : ""}`;
  } else if (status === "reconnecting") {
    text.textContent = "Reconnecting...";
  } else {
    text.textContent = "Disconnected";
  }

  submitBtn.disabled = status !== "connected" || !selectedSessionId;
  powerBtn.disabled = status !== "connected";
}

function handleServerMessage(msg: ServerMessage): void {
  if (msg.type === "sessions") {
    sessions = msg.sessions as typeof sessions;
    updateSessionSelect();
    pruneStaleEntries(sessions.map((s) => s.id));
    // Set sessionStartedAt to "now" when we first see the selected session —
    // this means "Recent" = since you started watching, "Complete" = full history.
    // Only set once per session selection (not on every broadcast).
    if (selectedSessionId && sessionStartedAt === null) {
      sessionStartedAt = Date.now();
      transcriptTab?.setSessionStartedAt(sessionStartedAt);
      responseTab?.setSessionStartedAt(sessionStartedAt);
      usageTab?.setSessionStartedAt(sessionStartedAt);
    }
  } else if (msg.type === "server-info") {
    if (typeof msg.containerMode === "boolean") {
      containerMode = msg.containerMode;
    }
  } else if (msg.type === "server-exiting") {
    const restart = Boolean(msg.restart);
    const inContainer = Boolean(msg.containerMode);
    const action = restart ? "restarting" : "shutting down";
    const where = inContainer ? " (orchestrator will handle restart)" : "";
    showToast(`Server ${action}${where}…`);
    submitBtn.disabled = true;
    powerBtn.disabled = true;
  } else if (msg.type === "ack") {
    showToast("Submitted!");
  } else if (msg.type === "error") {
    showToast(`Error: ${msg.message}`);
  } else if (msg.type === "response") {
    responseTab?.addResponse(msg.content as string, msg.timestamp as number | undefined);
    // A response means Claude moved on — any pending prompts are stale
    permissionPrompts?.dismissAll("Resolved elsewhere");
  } else if (msg.type === "transcript-entry") {
    transcriptTab?.addEntry(msg.entry as any);
    // Tool execution or new assistant text means permission was already handled
    const entry = msg.entry as any;
    if (entry?.type === "tool-call" || entry?.type === "response") {
      permissionPrompts?.dismissAll("Resolved elsewhere");
    }
  } else if (msg.type === "canvas-push") {
    handleCanvasPush(msg);
  } else if (msg.type === "transcript-status") {
    if (!(msg as any).available) {
      responseTab?.showUnavailable();
      transcriptTab?.showUnavailable();
    }
  } else if (msg.type === "usage-snapshot") {
    usageTab?.setSnapshot(msg.usage as any);
    if ((msg as any).sessionStartedAt) {
      sessionStartedAt = (msg as any).sessionStartedAt;
      usageTab?.setSessionStartedAt(sessionStartedAt);
    }
  } else if (msg.type === "usage-update") {
    usageTab?.addUpdate(msg.usage as any);
  } else if (msg.type === "permission-request") {
    permissionPrompts?.show({
      requestId: msg.requestId as string,
      toolName: msg.toolName as string,
      description: msg.description as string,
      inputPreview: msg.inputPreview as string,
    });
  }
}

function handleCanvasPush(msg: ServerMessage): void {
  if (!layerManager || !compositor) return;
  if (suppressCanvasPush) return;

  const image = msg.image as string;
  const label = (msg.label as string) || `Claude: ${new Date().toLocaleTimeString()}`;

  try {
    const imgElement = new Image();
    imgElement.onload = () => {
      const sw = imgElement.width;
      const sh = imgElement.height;
      const cw = layerManager!.docWidth;
      const ch = layerManager!.docHeight;

      // Calculate display size — scale down to fit, no upscaling
      let dw = sw,
        dh = sh;
      if (dw > cw || dh > ch) {
        const scale = Math.min(cw / dw, ch / dh);
        dw = Math.round(dw * scale);
        dh = Math.round(dh * scale);
      }

      // Create transform layer with canvas sized to source image
      const layer = layerManager!.addLayer(label, { canvasWidth: sw, canvasHeight: sh });
      layer.visible = false;
      layer.ctx.drawImage(imgElement, 0, 0);
      layer.transform = {
        x: Math.round((cw - dw) / 2),
        y: Math.round((ch - dh) / 2),
        width: dw,
        height: dh,
        sourceWidth: sw,
        sourceHeight: sh,
      };

      compositor?.markDirty();
      layersUI?.render();
      updateLayerInfo();
      transformHandler?.updateOverlay();
    };
    imgElement.src = `data:image/png;base64,${image}`;

    responseTab?.addCanvasPushNotification(image, label);
    showToast(`Image received as hidden layer "${label}"`);
  } catch {
    showToast("Failed to add image layer");
  }
}

function handleImageImport(bitmap: ImageBitmap, name: string): void {
  if (!layerManager || !compositor) return;

  const cw = layerManager.docWidth;
  const ch = layerManager.docHeight;
  const sw = bitmap.width;
  const sh = bitmap.height;

  // Calculate display size — scale down to fit, no upscaling
  let dw = sw;
  let dh = sh;
  if (dw > cw || dh > ch) {
    const scale = Math.min(cw / dw, ch / dh);
    dw = Math.round(dw * scale);
    dh = Math.round(dh * scale);
  }

  // Create a transform layer with canvas sized to the source image
  const layer = layerManager.addLayer(name, { canvasWidth: sw, canvasHeight: sh });
  layer.ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  layer.transform = {
    x: Math.round((cw - dw) / 2),
    y: Math.round((ch - dh) / 2),
    width: dw,
    height: dh,
    sourceWidth: sw,
    sourceHeight: sh,
  };

  compositor.markDirty();
  layersUI?.render();
  updateLayerInfo();
  transformHandler?.updateOverlay();
  showToast(`Image added as "${name}"`);
}

// -- Session Selector --

function updateSessionSelect(): void {
  sessionSelect.innerHTML = "";

  if (sessions.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No sessions";
    sessionSelect.appendChild(opt);
    sessionSelect.disabled = true;
    selectedSessionId = "";
  } else {
    sessionSelect.disabled = false;
    for (const s of sessions) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      sessionSelect.appendChild(opt);
    }

    // Restore previous selection if still available
    const stored = localStorage.getItem("trayce-session");
    if (stored && sessions.some((s) => s.id === stored)) {
      sessionSelect.value = stored;
      selectedSessionId = stored;
    } else {
      // The stored session isn't in the current list yet. This happens during
      // a server restart: the browser reconnects before the bridge has
      // re-registered, so the first sessions broadcast can be empty or
      // partial. Show the first available session as a temporary default but
      // DO NOT overwrite localStorage — when the bridge catches up and the
      // next broadcast arrives, this branch will run again with the full
      // list and correctly restore the user's selection.
      const first = sessions[0];
      selectedSessionId = first?.id ?? "";
      sessionSelect.value = selectedSessionId;
      // Only persist the auto-picked first as the "remembered" selection when
      // there was nothing stored at all — that's the first-ever visit case.
      if (!stored && selectedSessionId) {
        localStorage.setItem("trayce-session", selectedSessionId);
      }
    }
  }

  if (selectedSessionId) {
    connection?.send({ type: "watch-session", sessionId: selectedSessionId });
    switchSession(selectedSessionId);
  }

  handleConnectionStatus(connection?.isConnected ? "connected" : "disconnected");
  updateTabTitle();
}

sessionSelect.addEventListener("change", async () => {
  const newSessionId = sessionSelect.value;
  await switchSession(newSessionId || null);
  // If the lock was denied, doSwitchSession already rolled back the dropdown.
  // Only update state if the switch actually succeeded.
  if (sessionSelect.value !== newSessionId) return;
  selectedSessionId = newSessionId;
  localStorage.setItem("trayce-session", selectedSessionId);
  submitBtn.disabled = !connection?.isConnected || !selectedSessionId;
  connection?.send({ type: "watch-session", sessionId: selectedSessionId });
  responseTab?.clear();
  transcriptTab?.clear();
  usageTab?.clear();
  sessionStartedAt = null;
  updateTabTitle();
});

// -- Submit --

submitBtn.addEventListener("click", async () => {
  if (!layerManager || !connection?.isConnected || !selectedSessionId) return;

  const prompt = promptInput.value.trim();
  const blank = isCanvasBlank(layerManager);

  if (blank && !prompt) {
    showToast("Nothing to submit — draw something or enter a prompt");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending...";

  try {
    const msg: Record<string, unknown> = {
      type: "submit",
      targetSessionId: selectedSessionId,
      prompt,
    };

    if (!blank) {
      const blob = await flattenToPng(layerManager);
      msg.image = await blobToBase64(blob);
    }

    connection.send(msg);
    promptInput.value = "";
  } catch (err) {
    showToast("Failed to submit");
    console.error("[trayce] Submit error:", err);
  } finally {
    submitBtn.textContent = "Send";
    submitBtn.disabled = !connection?.isConnected || !selectedSessionId;
  }
});

// Ctrl+Enter shortcut for submit
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter" && !submitBtn.disabled) {
    submitBtn.click();
  }
});

// Best-effort save on tab close. IndexedDB writes started here may not complete
// before the browser tears down the page — this is an accepted limitation.
// The periodic auto-save below limits worst-case data loss to ~30 seconds.
window.addEventListener("beforeunload", () => {
  saveCurrentCanvas();
  canvasLock.destroy();
});

// Periodic auto-save every 30 seconds so tab-close only risks losing recent work
setInterval(() => {
  saveCurrentCanvas();
}, 30_000);

// -- Info Updates --

function clearCanvas(): void {
  if (!layerManager || !compositor) return;
  if (!confirm("Clear the entire canvas? This cannot be undone.")) return;

  // Reset to a fresh Background + Sketch, removing all extra layers (image
  // layers, duplicates, etc.) rather than just blanking their pixels.
  createFreshCanvas(layerManager);

  // Clear history — the confirm prompt promises the action can't be undone,
  // and leaving stale checkpoints in the undo stack would let Ctrl+Z restore
  // incoherent pre-clear state mixed with the now-empty layers.
  history?.clear();

  compositor.rebuild();
  layersUI?.render();
  updateLayerInfo();
  transformHandler?.updateOverlay();
  showToast("Canvas cleared");
}

function updateToolInfo(): void {
  toolInfo.textContent = `${activeBrush.name} · ${brushParams.size}px`;
}

function updateLayerInfo(): void {
  if (!layerManager) return;
  layerInfo.textContent = `Layer: ${layerManager.activeLayer.name}`;
}

// -- Keyboard Shortcuts --

document.addEventListener("keydown", (e) => {
  // Don't handle shortcuts when typing in inputs
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  switch (e.key.toLowerCase()) {
    case "b":
      activeBrush = brushes.pen!;
      toolbar?.setActive("pen");
      updateToolInfo();
      break;
    case "n":
      activeBrush = brushes.pencil!;
      toolbar?.setActive("pencil");
      updateToolInfo();
      break;
    case "m":
      activeBrush = brushes.marker!;
      toolbar?.setActive("marker");
      updateToolInfo();
      break;
    case "w":
      activeBrush = brushes.watercolor!;
      toolbar?.setActive("watercolor");
      updateToolInfo();
      break;
    case "h":
      activeBrush = brushes.highlighter!;
      toolbar?.setActive("highlighter");
      updateToolInfo();
      break;
    case "e":
      activeBrush = brushes.eraser!;
      toolbar?.setActive("eraser");
      updateToolInfo();
      break;
    case "i":
      imageTool?.openFilePicker();
      break;
    case "[":
      brushParams.size = Math.max(1, brushParams.size - 2);
      updateToolInfo();
      break;
    case "]":
      brushParams.size = Math.min(200, brushParams.size + 2);
      updateToolInfo();
      break;
    case "z":
      if (e.ctrlKey || e.metaKey) {
        if (history?.canUndo()) {
          const cmd = history.undo();
          if (cmd?.checkpoint && layerManager) {
            const layer = layerManager.layers.find((l) => l.id === cmd.layerId);
            if (layer) {
              createImageBitmap(cmd.checkpoint).then((bitmap) => {
                layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
                layer.ctx.drawImage(bitmap, 0, 0);
                layerManager!.bumpRevision(layer.id);
                compositor?.markDirty();
                layersUI?.render();
              });
            }
          }
        }
      }
      break;
    case "y":
      if (e.ctrlKey || e.metaKey) {
        if (history?.canRedo()) {
          const cmd = history.redo();
          if (cmd?.checkpoint && layerManager) {
            const layer = layerManager.layers.find((l) => l.id === cmd.layerId);
            if (layer) {
              createImageBitmap(cmd.checkpoint).then((bitmap) => {
                layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
                layer.ctx.drawImage(bitmap, 0, 0);
                layerManager!.bumpRevision(layer.id);
                compositor?.markDirty();
                layersUI?.render();
              });
            }
          }
        }
      }
      break;
  }
});

// -- Zoom with mouse wheel --

canvasContainer.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (!canvasManager) return;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    canvasManager.zoomBy(delta);
    canvasInfo.textContent = canvasManager.getCanvasInfo();
  },
  { passive: false },
);

// -- Init --

initUIComponents();
initResolutionSelector();
initCanvas(1920, 1080, "white");
initConnection();

// Signal successful bootstrap completion to tests and tooling
window.__trayceReady = true;
