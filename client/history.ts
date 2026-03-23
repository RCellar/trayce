export interface Command {
  type: "stroke" | "layer-add" | "layer-delete" | "layer-reorder" | "layer-merge";
  layerId: string;
  data: any;
  checkpoint?: Blob;
  checkpointSize?: number;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private usedMemory = 0;
  private strokesSinceCheckpoint = 0;
  private checkpointInterval = 10;

  constructor(private memoryBudgetBytes: number) {}

  push(command: Command): void {
    this.undoStack.push(command);
    this.redoStack = [];

    if (command.checkpointSize) {
      this.usedMemory += command.checkpointSize;
      this.evictIfNeeded();
    }

    this.strokesSinceCheckpoint++;
  }

  undo(): Command | null {
    const command = this.undoStack.pop();
    if (!command) return null;
    this.redoStack.push(command);
    return command;
  }

  redo(): Command | null {
    const command = this.redoStack.pop();
    if (!command) return null;
    this.undoStack.push(command);
    return command;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  shouldCheckpoint(): boolean {
    return this.strokesSinceCheckpoint >= this.checkpointInterval;
  }

  resetCheckpointCounter(): void {
    this.strokesSinceCheckpoint = 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.usedMemory = 0;
    this.strokesSinceCheckpoint = 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  private evictIfNeeded(): void {
    while (this.usedMemory > this.memoryBudgetBytes && this.undoStack.length > 1) {
      const oldest = this.undoStack.shift();
      if (oldest?.checkpointSize) {
        this.usedMemory -= oldest.checkpointSize;
      }
    }
  }
}
