// Must be imported BEFORE any other pixi.js imports — patches PixiJS to work
// without unsafe-eval (replaces new Function() with CSP-safe alternatives)
import "pixi.js/unsafe-eval";

import { CanvasManager } from "./canvas";
import { LayerManager } from "./layers";
import { Compositor } from "./compositor";
import { InputHandler, type InputState } from "./input";
import { PenBrush } from "./brushes/pen";
import { PencilBrush } from "./brushes/pencil";
import { MarkerBrush } from "./brushes/marker";
import { WatercolorBrush } from "./brushes/watercolor";
import { HighlighterBrush } from "./brushes/highlighter";
import { EraserBrush } from "./brushes/eraser";
import type { Brush, BrushParams } from "./brushes/types";
import { Connection, buildWsUrl, type ServerMessage } from "./connection";
import { flattenToPng, blobToBase64, isCanvasBlank } from "./export";
import { showToast } from "./toast";
import { Toolbar, type ToolId, type ActionId } from "./toolbar";
import { BrushSettingsUI } from "./brush-settings-ui";
import { LayersUI } from "./layers-ui";
import { ColorPicker } from "./color-picker";
import { SidePanel } from "./side-panel";
import { ResponseTab } from "./response-tab";
import { TranscriptTab } from "./transcript-tab";
import { UsageTab } from "./usage-tab";
import { ThemeManager } from "./theme";
import { FloatingPanel } from "./floating-panel";
import { ImageTool } from "./tools/image";
import { History } from "./history";

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

let sessions: Array<{ id: string; label: string; status: string }> = [];
let selectedSessionId = "";

let sidePanel: SidePanel | null = null;
let responseTab: ResponseTab | null = null;
let transcriptTab: TranscriptTab | null = null;
let usageTab: UsageTab | null = null;
let history: History | null = null;

import { formatTabTitle } from "./tab-title";

function updateTabTitle(): void {
  document.title = formatTabTitle(sessions, selectedSessionId);
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
  compositor = new Compositor(canvasManager.app, layerManager);
  history = new History(50 * 1024 * 1024); // 50MB budget

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
      updateTransformOverlay();
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
      updateTransformOverlay();
    },
    onDeleteLayer: (index) => {
      try {
        layerManager!.deleteLayer(index);
        compositor?.markDirty();
        layersUI?.render();
        updateLayerInfo();
        updateTransformOverlay();
      } catch (_e) {
        showToast("Cannot delete this layer");
      }
    },
    onRasterize: (index) => {
      layerManager!.rasterizeLayer(index);
      compositor?.markDirty();
      layersUI?.render();
      updateTransformOverlay();
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
    updateTransformOverlay();
  });
}

// -- Transform interaction state --

type HandleId = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
type DragMode =
  | { type: "move"; offsetX: number; offsetY: number }
  | {
      type: "resize";
      handle: HandleId;
      anchorX: number;
      anchorY: number;
      startW: number;
      startH: number;
    };

let transformDrag: DragMode | null = null;

const HANDLE_RADIUS_SCREEN = 6; // pixels in screen space

function getHandleAtPoint(
  t: { x: number; y: number; width: number; height: number },
  docX: number,
  docY: number,
  zoom: number,
): HandleId | null {
  const r = HANDLE_RADIUS_SCREEN / zoom; // convert screen hit radius to doc space
  const handles: Array<{ id: HandleId; hx: number; hy: number }> = [
    { id: "nw", hx: t.x, hy: t.y },
    { id: "n", hx: t.x + t.width / 2, hy: t.y },
    { id: "ne", hx: t.x + t.width, hy: t.y },
    { id: "w", hx: t.x, hy: t.y + t.height / 2 },
    { id: "e", hx: t.x + t.width, hy: t.y + t.height / 2 },
    { id: "sw", hx: t.x, hy: t.y + t.height },
    { id: "s", hx: t.x + t.width / 2, hy: t.y + t.height },
    { id: "se", hx: t.x + t.width, hy: t.y + t.height },
  ];
  for (const h of handles) {
    if (Math.abs(docX - h.hx) <= r && Math.abs(docY - h.hy) <= r) return h.id;
  }
  return null;
}

function hitTestTransformBounds(
  t: { x: number; y: number; width: number; height: number },
  docX: number,
  docY: number,
): boolean {
  return docX >= t.x && docX <= t.x + t.width && docY >= t.y && docY <= t.y + t.height;
}

function updateTransformOverlay(): void {
  if (!compositor || !canvasManager || !layerManager) {
    compositor?.clearOverlay();
    return;
  }
  const layer = layerManager.activeLayer;
  if (!layer.transform) {
    compositor.clearOverlay();
    return;
  }
  const stagePos = canvasManager.stage.position;
  compositor.drawTransformOverlay(
    stagePos.x,
    stagePos.y,
    canvasManager.viewport.zoom,
    layer.transform,
  );
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
    handleTransformInput(layer.transform, doc.x, doc.y, event);
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

function handleTransformInput(
  t: import("./layers").LayerTransform,
  docX: number,
  docY: number,
  event: "start" | "move" | "end",
): void {
  if (event === "start") {
    const zoom = canvasManager!.viewport.zoom;

    // Check handles first (higher priority than move)
    const handle = getHandleAtPoint(t, docX, docY, zoom);
    if (handle) {
      // Anchor is the corner opposite to the dragged handle
      const ax = handle.includes("e") ? t.x : handle.includes("w") ? t.x + t.width : t.x;
      const ay = handle.includes("s") ? t.y : handle.includes("n") ? t.y + t.height : t.y;
      transformDrag = {
        type: "resize",
        handle,
        anchorX: ax,
        anchorY: ay,
        startW: t.width,
        startH: t.height,
      };
      return;
    }

    // Check body hit for move
    if (hitTestTransformBounds(t, docX, docY)) {
      transformDrag = { type: "move", offsetX: docX - t.x, offsetY: docY - t.y };
      return;
    }

    // Clicked outside — no interaction
    transformDrag = null;
  }

  if (event === "move" && transformDrag) {
    if (transformDrag.type === "move") {
      t.x = docX - transformDrag.offsetX;
      t.y = docY - transformDrag.offsetY;
    } else {
      applyResize(t, transformDrag, docX, docY);
    }
    compositor?.markDirty();
    if (layerManager) layerManager.bumpRevision(layerManager.activeLayer.id);
    updateTransformOverlay();
  }

  if (event === "end" && transformDrag) {
    transformDrag = null;
  }
}

function applyResize(
  t: import("./layers").LayerTransform,
  drag: Extract<DragMode, { type: "resize" }>,
  docX: number,
  docY: number,
): void {
  const MIN_SIZE = 10;
  const { handle, anchorX, anchorY, startW, startH } = drag;
  const aspect = startW / startH;

  let newX = t.x,
    newY = t.y,
    newW = t.width,
    newH = t.height;

  // Horizontal component
  if (handle.includes("e")) {
    newW = Math.max(MIN_SIZE, docX - anchorX);
    newX = anchorX;
  } else if (handle.includes("w")) {
    newW = Math.max(MIN_SIZE, anchorX - docX);
    newX = anchorX - newW;
  }

  // Vertical component
  if (handle.includes("s")) {
    newH = Math.max(MIN_SIZE, docY - anchorY);
    newY = anchorY;
  } else if (handle.includes("n")) {
    newH = Math.max(MIN_SIZE, anchorY - docY);
    newY = anchorY - newH;
  }

  // Corner handles: preserve aspect ratio (default behavior)
  if (handle.length === 2) {
    // Fit to the smaller dimension
    if (newW / newH > aspect) {
      newW = newH * aspect;
    } else {
      newH = newW / aspect;
    }
    // Re-anchor after ratio adjustment
    if (handle.includes("w")) newX = anchorX - newW;
    if (handle.includes("n")) newY = anchorY - newH;
  }

  t.x = Math.round(newX);
  t.y = Math.round(newY);
  t.width = Math.round(newW);
  t.height = Math.round(newH);
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
  connection.connect();
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
}

// Track pending permission prompts for stale detection
const pendingPermissions = new Map<
  string,
  { el: HTMLElement; timer: ReturnType<typeof setTimeout> }
>();

function dismissPermissionPrompt(requestId: string, reason: string): void {
  const pending = pendingPermissions.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingPermissions.delete(requestId);

  const el = pending.el;
  // Replace actions with stale message
  const actions = el.querySelector(".perm-actions");
  if (actions) {
    actions.textContent = "";
    const msg = document.createElement("span");
    msg.className = "perm-stale";
    msg.textContent = reason;
    actions.appendChild(msg);
  }
  // Fade out after a moment
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 1500);
}

function dismissAllPermissions(reason: string): void {
  for (const id of [...pendingPermissions.keys()]) {
    dismissPermissionPrompt(id, reason);
  }
}

function handleServerMessage(msg: ServerMessage): void {
  if (msg.type === "sessions") {
    sessions = msg.sessions as typeof sessions;
    updateSessionSelect();
  } else if (msg.type === "ack") {
    showToast("Submitted!");
  } else if (msg.type === "error") {
    showToast(`Error: ${msg.message}`);
  } else if (msg.type === "response") {
    responseTab?.addResponse(msg.content as string, msg.timestamp as number | undefined);
    // A response means Claude moved on — any pending prompts are stale
    dismissAllPermissions("Resolved elsewhere");
  } else if (msg.type === "transcript-entry") {
    transcriptTab?.addEntry(msg.entry as any);
    // Tool execution or new assistant text means permission was already handled
    const entry = msg.entry as any;
    if (entry?.type === "tool-call" || entry?.type === "response") {
      dismissAllPermissions("Resolved elsewhere");
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
  } else if (msg.type === "usage-update") {
    usageTab?.addUpdate(msg.usage as any);
  } else if (msg.type === "permission-request") {
    showPermissionPrompt(msg);
  }
}

function showPermissionPrompt(msg: ServerMessage): void {
  const requestId = msg.requestId as string;
  const toolName = msg.toolName as string;
  const description = msg.description as string;
  const inputPreview = msg.inputPreview as string;

  const container = document.getElementById("toast-container")!;

  const prompt = document.createElement("div");
  prompt.className = "permission-prompt";

  const header = document.createElement("div");
  header.className = "perm-header";
  header.textContent = "Permission Request";

  const tool = document.createElement("div");
  tool.className = "perm-tool";
  tool.textContent = toolName;

  const desc = document.createElement("div");
  desc.className = "perm-desc";
  desc.textContent = description;

  const preview = document.createElement("div");
  preview.className = "perm-preview";
  preview.textContent = inputPreview;

  const actions = document.createElement("div");
  actions.className = "perm-actions";

  const resolve = (behavior: "allow" | "deny") => {
    const pending = pendingPermissions.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPermissions.delete(requestId);
    }
    connection?.send({ type: "permission-verdict", requestId, behavior });
    prompt.classList.remove("show");
    setTimeout(() => prompt.remove(), 300);
  };

  const allowBtn = document.createElement("button");
  allowBtn.className = "perm-allow";
  allowBtn.textContent = "Allow";
  allowBtn.addEventListener("click", () => resolve("allow"));

  const denyBtn = document.createElement("button");
  denyBtn.className = "perm-deny";
  denyBtn.textContent = "Deny";
  denyBtn.addEventListener("click", () => resolve("deny"));

  actions.appendChild(allowBtn);
  actions.appendChild(denyBtn);

  prompt.appendChild(header);
  prompt.appendChild(tool);
  prompt.appendChild(desc);
  prompt.appendChild(preview);
  prompt.appendChild(actions);

  container.appendChild(prompt);
  prompt.offsetHeight; // force reflow
  prompt.classList.add("show");

  // Track with 60-second timeout fallback
  const timer = setTimeout(() => {
    dismissPermissionPrompt(requestId, "Timed out");
  }, 60_000);
  pendingPermissions.set(requestId, { el: prompt, timer });
}

function handleCanvasPush(msg: ServerMessage): void {
  if (!layerManager || !compositor) return;

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
      updateTransformOverlay();
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
  updateTransformOverlay();
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
      const first = sessions[0];
      selectedSessionId = first?.id ?? "";
      sessionSelect.value = selectedSessionId;
    }
  }

  if (selectedSessionId) {
    connection?.send({ type: "watch-session", sessionId: selectedSessionId });
  }

  handleConnectionStatus(connection?.isConnected ? "connected" : "disconnected");
  updateTabTitle();
}

sessionSelect.addEventListener("change", () => {
  selectedSessionId = sessionSelect.value;
  localStorage.setItem("trayce-session", selectedSessionId);
  submitBtn.disabled = !connection?.isConnected || !selectedSessionId;
  // Tell server which session to watch for transcript/response data
  connection?.send({ type: "watch-session", sessionId: selectedSessionId });
  responseTab?.clear();
  transcriptTab?.clear();
  usageTab?.clear();
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

// -- Info Updates --

function clearCanvas(): void {
  if (!layerManager || !compositor) return;
  if (!confirm("Clear the entire canvas? This cannot be undone.")) return;

  for (const layer of layerManager.layers) {
    layer.ctx.clearRect(0, 0, layerManager.docWidth, layerManager.docHeight);
    // Also reset transform so image layers don't leave ghost-positioned
    // sprites behind (the compositor reads layer.transform for positioning).
    delete layer.transform;
    layer.revision++;
  }

  // Refill background if it was white
  const bg = layerManager.layers[0];
  if (bg) {
    bg.ctx.fillStyle = "#f0f0f0";
    bg.ctx.fillRect(0, 0, layerManager.docWidth, layerManager.docHeight);
  }

  // Clear history — the confirm prompt promises the action can't be undone,
  // and leaving stale checkpoints in the undo stack would let Ctrl+Z restore
  // incoherent pre-clear state mixed with the now-empty layers.
  history?.clear();

  compositor.markDirty();
  layersUI?.render();
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
