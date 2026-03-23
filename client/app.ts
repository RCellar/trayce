import { CanvasManager } from "./canvas";
import { LayerManager } from "./layers";
import { Compositor } from "./compositor";
import { InputHandler, type InputState } from "./input";
import { PenBrush } from "./brushes/pen";
import { EraserBrush } from "./brushes/eraser";
import type { Brush, BrushParams } from "./brushes/types";
import { Connection, buildWsUrl, type ServerMessage } from "./connection";
import { flattenToPng, blobToBase64 } from "./export";
import { showToast } from "./toast";

// -- State --

let canvasManager: CanvasManager | null = null;
let layerManager: LayerManager | null = null;
let compositor: Compositor | null = null;
let inputHandler: InputHandler | null = null;
let connection: Connection | null = null;

const brushes: Record<string, Brush> = {
  pen: new PenBrush(),
  eraser: new EraserBrush(),
};

let activeBrush: Brush = brushes.pen;
let brushParams: BrushParams = {
  size: 12,
  opacity: 100,
  flow: 80,
  smoothing: 50,
  color: "#000000",
};

let sessions: Array<{ id: string; label: string; status: string }> = [];
let selectedSessionId = "";

// -- DOM Elements --

const dialog = document.getElementById("new-doc-dialog") as HTMLDialogElement;
const canvasContainer = document.getElementById("canvas-container")!;
const canvasInfo = document.getElementById("canvas-info")!;
const sessionSelect = document.getElementById("session-select") as HTMLSelectElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const promptInput = document.getElementById("prompt-input") as HTMLInputElement;
const connectionStatus = document.getElementById("connection-status")!;
const toolInfo = document.getElementById("tool-info")!;
const layerInfo = document.getElementById("layer-info")!;

// -- New Document Dialog --

function showNewDocDialog(): void {
  dialog.showModal();

  // Preset buttons
  dialog.querySelectorAll(".presets button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const w = parseInt((btn as HTMLElement).dataset.w!);
      const h = parseInt((btn as HTMLElement).dataset.h!);
      const bg = getSelectedBackground();
      dialog.close();
      initCanvas(w, h, bg);
    });
  });

  // Custom create
  document.getElementById("custom-create")!.addEventListener("click", () => {
    const w = Math.min(4096, Math.max(1, parseInt((document.getElementById("custom-w") as HTMLInputElement).value)));
    const h = Math.min(4096, Math.max(1, parseInt((document.getElementById("custom-h") as HTMLInputElement).value)));
    const bg = getSelectedBackground();
    dialog.close();
    initCanvas(w, h, bg);
  });
}

function getSelectedBackground(): "white" | "transparent" {
  const checked = dialog.querySelector('input[name="bg"]:checked') as HTMLInputElement;
  return (checked?.value === "transparent") ? "transparent" : "white";
}

// -- Canvas Initialization --

async function initCanvas(width: number, height: number, background: "white" | "transparent"): Promise<void> {
  // Clean up previous
  if (canvasManager) canvasManager.destroy();
  if (compositor) compositor.destroy();
  if (inputHandler) inputHandler.destroy();

  canvasManager = await CanvasManager.create(canvasContainer, width, height);
  layerManager = new LayerManager(width, height, background);
  compositor = new Compositor(canvasManager.app, layerManager);

  // Add compositor container to stage
  canvasManager.stage.addChild(compositor.getContainer());

  // Initial composite
  compositor.markDirty();
  compositor.update();

  // Update info
  canvasInfo.textContent = canvasManager.getCanvasInfo();
  updateToolInfo();
  updateLayerInfo();

  // Input handler
  inputHandler = new InputHandler(canvasContainer, handleInput);

  // Render loop
  canvasManager.app.ticker.add(() => {
    compositor?.update();
  });
}

// -- Drawing --

function handleInput(state: InputState, event: "start" | "move" | "end"): void {
  if (!layerManager || !canvasManager) return;
  const layer = layerManager.activeLayer;
  if (layer.locked) return;

  // Transform screen coords to doc coords
  const docPoints = state.points.map((p) => {
    const doc = canvasManager!.screenToDoc(p.x, p.y);
    return { x: doc.x, y: doc.y, pressure: p.pressure };
  });

  if (event === "start") {
    activeBrush.beginStroke(layer.ctx, brushParams);
  }

  if (event === "move" || event === "start") {
    activeBrush.drawStroke(layer.ctx, docPoints, brushParams);
    compositor?.markDirty();
  }

  if (event === "end") {
    activeBrush.endStroke(layer.ctx, brushParams);
    compositor?.markDirty();
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

  const wsUrl = buildWsUrl(window.location.hostname, parseInt(window.location.port) || 9740, storedToken);

  connection = new Connection(wsUrl, handleConnectionStatus, handleServerMessage);
  connection.connect();
}

function handleConnectionStatus(status: "connected" | "disconnected" | "reconnecting"): void {
  connectionStatus.className = `status ${status}`;
  const dot = connectionStatus.querySelector(".dot")!;
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

function handleServerMessage(msg: ServerMessage): void {
  if (msg.type === "sessions") {
    sessions = msg.sessions as typeof sessions;
    updateSessionSelect();
  } else if (msg.type === "ack") {
    showToast("Submitted!");
  } else if (msg.type === "error") {
    showToast(`Error: ${msg.message}`);
  }
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
      selectedSessionId = sessions[0].id;
      sessionSelect.value = selectedSessionId;
    }
  }

  handleConnectionStatus(connection?.isConnected ? "connected" : "disconnected");
}

sessionSelect.addEventListener("change", () => {
  selectedSessionId = sessionSelect.value;
  localStorage.setItem("trayce-session", selectedSessionId);
  submitBtn.disabled = !connection?.isConnected || !selectedSessionId;
});

// -- Submit --

submitBtn.addEventListener("click", async () => {
  if (!layerManager || !connection?.isConnected || !selectedSessionId) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending...";

  try {
    const blob = await flattenToPng(layerManager);
    const base64 = await blobToBase64(blob);
    const prompt = promptInput.value.trim();

    connection.send({
      type: "submit",
      targetSessionId: selectedSessionId,
      image: base64,
      prompt,
    });

    promptInput.value = "";
  } catch (err) {
    showToast("Failed to submit");
    console.error("[trayce] Submit error:", err);
  } finally {
    submitBtn.textContent = "Submit";
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
      activeBrush = brushes.pen;
      updateToolInfo();
      break;
    case "e":
      activeBrush = brushes.eraser;
      updateToolInfo();
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
        // Undo — will be wired when history module is ready
      }
      break;
    case "y":
      if (e.ctrlKey || e.metaKey) {
        // Redo — will be wired when history module is ready
      }
      break;
  }
});

// -- Zoom with mouse wheel --

canvasContainer.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (!canvasManager) return;
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  canvasManager.zoomBy(delta);
  canvasInfo.textContent = canvasManager.getCanvasInfo();
}, { passive: false });

// -- Init --

showNewDocDialog();
initConnection();
