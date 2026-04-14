export type AnnotationToolKind = "pin" | "text" | "callout";

type ModeState = { active: boolean; tool: AnnotationToolKind };
type Listener = (state: ModeState) => void;

export class AnnotationMode {
  private active = false;
  private tool: AnnotationToolKind = "pin";
  private listeners = new Set<Listener>();

  isActive(): boolean {
    return this.active;
  }

  currentTool(): AnnotationToolKind {
    return this.tool;
  }

  toggle(): void {
    this.active = !this.active;
    this.emit();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.emit();
  }

  setTool(tool: AnnotationToolKind): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snapshot: ModeState = { active: this.active, tool: this.tool };
    for (const fn of this.listeners) fn(snapshot);
  }
}
