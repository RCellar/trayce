export interface Session {
  id: string;
  label: string;
  status: string;
}

export class SessionsUI {
  private select: HTMLSelectElement;
  private selectedId = "";

  constructor(select: HTMLSelectElement) {
    this.select = select;

    // Restore from localStorage
    this.selectedId = localStorage.getItem("trayce-session") || "";

    this.select.addEventListener("change", () => {
      this.selectedId = this.select.value;
      localStorage.setItem("trayce-session", this.selectedId);
    });
  }

  update(sessions: Session[]): void {
    this.select.replaceChildren();

    if (sessions.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No sessions";
      this.select.appendChild(opt);
      this.select.disabled = true;
      this.selectedId = "";
      return;
    }

    this.select.disabled = false;

    for (const s of sessions) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      opt.title = `${s.id}`;
      this.select.appendChild(opt);
    }

    // Restore previous selection if still available
    if (this.selectedId && sessions.some((s) => s.id === this.selectedId)) {
      this.select.value = this.selectedId;
    } else {
      this.selectedId = sessions[0].id;
      this.select.value = this.selectedId;
    }
  }

  getSelectedId(): string {
    return this.selectedId;
  }
}
