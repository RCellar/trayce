import { estimateCost, formatCost, formatTokens, type UsageSnapshot } from "./pricing";

type UsageEntry = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  timestamp: number;
};

export class UsageTab {
  private container: HTMLElement | null = null;
  private updates: UsageEntry[] = [];
  private mode: "recent" | "complete" = "recent";
  private sessionStartedAt: number | null = null;
  private toggleEl: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  setSnapshot(snapshot: UsageSnapshot): void {
    // The server sends usage-snapshot AFTER buffer replay. If we already have
    // individual usage-update entries from the replay, keep those (they have
    // real timestamps for filtering). Only use the snapshot if we have no
    // individual entries yet.
    if (this.updates.length === 0 && snapshot.requestCount > 0) {
      this.updates = [
        {
          inputTokens: snapshot.inputTokens,
          outputTokens: snapshot.outputTokens,
          cacheReadTokens: snapshot.cacheReadTokens,
          cacheWriteTokens: snapshot.cacheWriteTokens,
          model: Object.keys(snapshot.models)[0] ?? "unknown",
          timestamp: snapshot.firstTimestamp,
        },
      ];
    }
    this.render();
  }

  addUpdate(usage: UsageEntry): void {
    this.updates.push(usage);
    this.render();
  }

  setSessionStartedAt(ts: number | null): void {
    this.sessionStartedAt = ts;
    // Toggle is hidden for usage — usage-update messages are not buffered by the
    // server, so the only data source is the cumulative usage-snapshot which can't
    // be split into recent vs historical. Individual usage-updates that arrive
    // after connection DO have timestamps and will be filtered if the toggle is
    // re-enabled in the future.
    this.render();
  }

  private setMode(mode: "recent" | "complete"): void {
    this.mode = mode;
    this.updateToggleUI();
    this.render();
  }

  private createToggle(): HTMLElement {
    const toggle = document.createElement("div");
    toggle.className = "tab-toggle";

    const recentBtn = document.createElement("button");
    recentBtn.textContent = "Recent";
    recentBtn.classList.toggle("active", this.mode === "recent");
    recentBtn.addEventListener("click", () => this.setMode("recent"));

    const completeBtn = document.createElement("button");
    completeBtn.textContent = "Complete";
    completeBtn.classList.toggle("active", this.mode === "complete");
    completeBtn.addEventListener("click", () => this.setMode("complete"));

    toggle.appendChild(recentBtn);
    toggle.appendChild(completeBtn);
    return toggle;
  }

  private updateToggleUI(): void {
    if (!this.toggleEl) return;
    const buttons = this.toggleEl.querySelectorAll("button");
    buttons[0]?.classList.toggle("active", this.mode === "recent");
    buttons[1]?.classList.toggle("active", this.mode === "complete");
  }

  private computeSnapshot(): UsageSnapshot {
    const snapshot: UsageSnapshot = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      requestCount: 0,
      models: {},
      firstTimestamp: 0,
      lastTimestamp: 0,
    };

    for (const entry of this.updates) {
      if (this.mode === "recent" && this.sessionStartedAt !== null) {
        if (entry.timestamp < this.sessionStartedAt) continue;
      }

      snapshot.inputTokens += entry.inputTokens;
      snapshot.outputTokens += entry.outputTokens;
      snapshot.cacheReadTokens += entry.cacheReadTokens;
      snapshot.cacheWriteTokens += entry.cacheWriteTokens;
      snapshot.requestCount++;

      let modelEntry = snapshot.models[entry.model];
      if (!modelEntry) {
        modelEntry = { inputTokens: 0, outputTokens: 0, requests: 0 };
        snapshot.models[entry.model] = modelEntry;
      }
      modelEntry.inputTokens += entry.inputTokens;
      modelEntry.outputTokens += entry.outputTokens;
      modelEntry.requests++;

      if (snapshot.firstTimestamp === 0 || entry.timestamp < snapshot.firstTimestamp) {
        snapshot.firstTimestamp = entry.timestamp;
      }
      if (entry.timestamp > snapshot.lastTimestamp) {
        snapshot.lastTimestamp = entry.timestamp;
      }
    }

    return snapshot;
  }

  clear(): void {
    this.updates = [];
    this.mode = "recent";
    this.toggleEl = null;
    this.render();
  }

  private render(): void {
    if (!this.container) return;
    const s = this.computeSnapshot();
    const cost = estimateCost(s);
    const totalInput = s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens;
    const cacheHitRate = totalInput > 0 ? Math.round((s.cacheReadTokens / totalInput) * 100) : 0;

    const duration =
      s.lastTimestamp && s.firstTimestamp
        ? Math.max(1, Math.round((s.lastTimestamp - s.firstTimestamp) / 1000))
        : 0;
    const tokPerSec =
      duration > 0
        ? (
            (s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens) /
            duration
          ).toFixed(1)
        : "--";

    this.container.textContent = "";

    this.addSection("Cost Estimate", (section) => {
      const costEl = document.createElement("div");
      costEl.className = "usage-cost";
      costEl.textContent = formatCost(cost);
      section.appendChild(costEl);

      const detail = document.createElement("div");
      detail.className = "usage-detail";
      detail.textContent = `${s.requestCount} requests`;
      section.appendChild(detail);
    });

    this.addSection("Tokens", (section) => {
      const grid = document.createElement("div");
      grid.className = "usage-grid";
      const pairs: [string, number][] = [
        ["Input", s.inputTokens],
        ["Output", s.outputTokens],
        ["Cache read", s.cacheReadTokens],
        ["Cache write", s.cacheWriteTokens],
      ];
      for (const [label, value] of pairs) {
        const labelEl = document.createElement("span");
        labelEl.className = "usage-label";
        labelEl.textContent = label;
        const valueEl = document.createElement("span");
        valueEl.className = "usage-value";
        valueEl.textContent = formatTokens(value);
        grid.appendChild(labelEl);
        grid.appendChild(valueEl);
      }
      section.appendChild(grid);
    });

    this.addSection("Cache Efficiency", (section) => {
      const barContainer = document.createElement("div");
      barContainer.className = "usage-bar-container";
      const bar = document.createElement("div");
      bar.className = "usage-bar";
      bar.style.width = `${cacheHitRate}%`;
      barContainer.appendChild(bar);
      section.appendChild(barContainer);

      const detail = document.createElement("div");
      detail.className = "usage-detail";
      detail.textContent = `${cacheHitRate}% cache hit rate`;
      section.appendChild(detail);
    });

    this.addSection("Rate", (section) => {
      const detail = document.createElement("div");
      detail.className = "usage-detail";
      detail.textContent = `${tokPerSec} tokens/sec${duration > 0 ? ` over ${duration}s` : ""}`;
      section.appendChild(detail);
    });

    const modelEntries = Object.entries(s.models).sort((a, b) => b[1].requests - a[1].requests);
    if (modelEntries.length > 0) {
      this.addSection("Models", (section) => {
        for (const [model, data] of modelEntries) {
          const row = document.createElement("div");
          row.className = "usage-model-row";
          const nameEl = document.createElement("span");
          nameEl.className = "usage-model-name";
          nameEl.textContent = model.replace("claude-", "").replace(/-/g, " ");
          const statEl = document.createElement("span");
          statEl.className = "usage-model-stat";
          statEl.textContent = `${formatTokens(data.inputTokens + data.outputTokens)} tok / ${data.requests} req`;
          row.appendChild(nameEl);
          row.appendChild(statEl);
          section.appendChild(row);
        }
      });
    }
  }

  private addSection(title: string, populate: (section: HTMLElement) => void): void {
    if (!this.container) return;
    const section = document.createElement("div");
    section.className = "usage-section";
    const heading = document.createElement("div");
    heading.className = "usage-heading";
    heading.textContent = title;
    section.appendChild(heading);
    populate(section);
    this.container.appendChild(section);
  }
}
