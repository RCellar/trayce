import type { Connection } from "./connection";

export interface PermissionMessage {
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
}

export class PermissionPromptManager {
  private pending = new Map<string, { el: HTMLElement; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private deps: {
      connection: () => Connection | null;
      container: HTMLElement;
    },
  ) {}

  /** Build and display a permission prompt. */
  show(msg: PermissionMessage): void {
    const { requestId, toolName, description, inputPreview } = msg;
    const container = this.deps.container;

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
      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
      }
      this.deps.connection()?.send({ type: "permission-verdict", requestId, behavior });
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

    const timer = setTimeout(() => {
      this.dismiss(requestId, "Timed out");
    }, 60_000);
    this.pending.set(requestId, { el: prompt, timer });
  }

  /** Dismiss all pending prompts with a reason message. */
  dismissAll(reason: string): void {
    for (const id of [...this.pending.keys()]) {
      this.dismiss(id, reason);
    }
  }

  /** Dismiss a single prompt by request ID. */
  dismiss(requestId: string, reason: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);

    const el = pending.el;
    const actions = el.querySelector(".perm-actions");
    if (actions) {
      actions.textContent = "";
      const msg = document.createElement("span");
      msg.className = "perm-stale";
      msg.textContent = reason;
      actions.appendChild(msg);
    }
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, 1500);
  }
}
