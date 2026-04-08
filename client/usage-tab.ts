import { estimateCost, formatCost, formatTokens, type UsageSnapshot } from "./pricing";

const EMPTY_SNAPSHOT: UsageSnapshot = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  requestCount: 0,
  models: {},
  firstTimestamp: 0,
  lastTimestamp: 0,
};

export class UsageTab {
  private container: HTMLElement | null = null;
  private snapshot: UsageSnapshot = { ...EMPTY_SNAPSHOT, models: {} };

  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  setSnapshot(snapshot: UsageSnapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  addUpdate(usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    model: string;
    timestamp: number;
  }): void {
    this.snapshot.inputTokens += usage.inputTokens;
    this.snapshot.outputTokens += usage.outputTokens;
    this.snapshot.cacheReadTokens += usage.cacheReadTokens;
    this.snapshot.cacheWriteTokens += usage.cacheWriteTokens;
    this.snapshot.requestCount++;

    let entry = this.snapshot.models[usage.model];
    if (!entry) {
      entry = { inputTokens: 0, outputTokens: 0, requests: 0 };
      this.snapshot.models[usage.model] = entry;
    }
    entry.inputTokens += usage.inputTokens;
    entry.outputTokens += usage.outputTokens;
    entry.requests++;

    if (this.snapshot.firstTimestamp === 0 || usage.timestamp < this.snapshot.firstTimestamp) {
      this.snapshot.firstTimestamp = usage.timestamp;
    }
    if (usage.timestamp > this.snapshot.lastTimestamp) {
      this.snapshot.lastTimestamp = usage.timestamp;
    }

    this.render();
  }

  clear(): void {
    this.snapshot = { ...EMPTY_SNAPSHOT, models: {} };
    this.render();
  }

  private render(): void {
    if (!this.container) return;
    const s = this.snapshot;
    const cost = estimateCost(s);
    const totalInput = s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens;
    const cacheHitRate = totalInput > 0
      ? Math.round((s.cacheReadTokens / totalInput) * 100)
      : 0;

    const duration = s.lastTimestamp && s.firstTimestamp
      ? Math.max(1, Math.round((s.lastTimestamp - s.firstTimestamp) / 1000))
      : 0;
    const tokPerSec = duration > 0
      ? ((s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens) / duration).toFixed(1)
      : "--";

    this.container.textContent = "";

    this.addSection("Cost Estimate", (section) => {
      const costEl = document.createElement("div");
      costEl.className = "usage-cost";
      costEl.textContent = formatCost(cost);
      section.appendChild(costEl);

      const detail = document.createElement("div");
      detail.className = "usage-detail";
      detail.textContent = s.requestCount + " requests";
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
      bar.style.width = cacheHitRate + "%";
      barContainer.appendChild(bar);
      section.appendChild(barContainer);

      const detail = document.createElement("div");
      detail.className = "usage-detail";
      detail.textContent = cacheHitRate + "% cache hit rate";
      section.appendChild(detail);
    });

    this.addSection("Rate", (section) => {
      const detail = document.createElement("div");
      detail.className = "usage-detail";
      detail.textContent = tokPerSec + " tokens/sec" + (duration > 0 ? " over " + duration + "s" : "");
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
          statEl.textContent = formatTokens(data.inputTokens + data.outputTokens) + " tok / " + data.requests + " req";
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
