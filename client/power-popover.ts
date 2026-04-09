import type { Connection } from "./connection";

export class PowerPopover {
  private popover: HTMLElement | null = null;
  private dismissClick: ((e: MouseEvent) => void) | null = null;
  private dismissEsc: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private deps: {
      powerBtn: HTMLButtonElement;
      connection: () => Connection | null;
      containerMode: () => boolean;
    },
  ) {
    this.deps.powerBtn.addEventListener("click", (e) => this.handleClick(e));
  }

  private handleClick(e: MouseEvent): void {
    if (!this.deps.connection()?.isConnected) return;
    if (e.shiftKey) {
      this.sendShutdown(true);
      return;
    }
    if (this.popover) {
      this.close();
      return;
    }
    this.open();
  }

  private open(): void {
    const containerMode = this.deps.containerMode();
    const powerBtn = this.deps.powerBtn;

    this.popover = document.createElement("div");
    this.popover.className = "server-power-popover";

    const restartBtn = document.createElement("button");
    restartBtn.type = "button";
    restartBtn.className = "popover-btn restart";
    restartBtn.textContent = "Restart";
    restartBtn.title = containerMode
      ? "Exit this process; orchestrator will restart if configured"
      : "Restart the server; this browser will reconnect automatically";
    restartBtn.addEventListener("click", () => {
      this.close();
      this.sendShutdown(true);
    });

    const shutdownBtn = document.createElement("button");
    shutdownBtn.type = "button";
    shutdownBtn.className = "popover-btn shutdown";
    shutdownBtn.textContent = "Shutdown";
    shutdownBtn.title = containerMode
      ? "Exit this process; container will stop unless restart policy is set"
      : "Stop the server; you'll need to start it again from a terminal";
    shutdownBtn.addEventListener("click", () => {
      this.close();
      this.sendShutdown(false);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "popover-btn cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.close());

    this.popover.append(restartBtn, shutdownBtn, cancelBtn);

    const rect = powerBtn.getBoundingClientRect();
    this.popover.style.top = `${rect.bottom + 4}px`;
    this.popover.style.right = `${window.innerWidth - rect.right}px`;

    document.body.appendChild(this.popover);
    powerBtn.classList.add("active");

    requestAnimationFrame(() => {
      this.dismissClick = (ev: MouseEvent) => {
        if (this.popover && !this.popover.contains(ev.target as Node) && ev.target !== powerBtn) {
          this.close();
        }
      };
      this.dismissEsc = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") this.close();
      };
      document.addEventListener("click", this.dismissClick);
      document.addEventListener("keydown", this.dismissEsc);
    });
  }

  private close(): void {
    if (!this.popover) return;
    if (this.dismissClick) document.removeEventListener("click", this.dismissClick);
    if (this.dismissEsc) document.removeEventListener("keydown", this.dismissEsc);
    this.dismissClick = null;
    this.dismissEsc = null;
    this.popover.remove();
    this.popover = null;
    this.deps.powerBtn.classList.remove("active");
  }

  private sendShutdown(restart: boolean): void {
    const conn = this.deps.connection();
    if (!conn?.isConnected) return;
    conn.send({ type: "shutdown-request", restart });
    this.deps.powerBtn.disabled = true;
  }
}
