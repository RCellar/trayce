export interface ImageToolConfig {
  onImport: (img: ImageBitmap, name: string) => void;
}

export class ImageTool {
  private fileInput: HTMLInputElement;

  constructor(private config: ImageToolConfig) {
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/*";
    this.fileInput.style.display = "none";
    document.body.appendChild(this.fileInput);

    this.fileInput.addEventListener("change", () => this.handleFileSelect());
  }

  openFilePicker(): void {
    this.fileInput.click();
  }

  private async handleFileSelect(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;

    try {
      const bitmap = await createImageBitmap(file);
      this.config.onImport(bitmap, `Image: ${file.name}`);
    } catch (err) {
      console.error("[trayce] Failed to load image:", err);
    }

    this.fileInput.value = "";
  }

  setupPasteHandler(): void {
    document.addEventListener("paste", async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          try {
            const bitmap = await createImageBitmap(blob);
            this.config.onImport(bitmap, "Pasted image");
          } catch (err) {
            console.error("[trayce] Failed to paste image:", err);
          }
          break;
        }
      }
    });
  }

  setupDropHandler(container: HTMLElement): void {
    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    });

    container.addEventListener("drop", async (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (!file || !file.type.startsWith("image/")) return;

      try {
        const bitmap = await createImageBitmap(file);
        this.config.onImport(bitmap, `Image: ${file.name}`);
      } catch (err) {
        console.error("[trayce] Failed to load dropped image:", err);
      }
    });
  }

  destroy(): void {
    this.fileInput.remove();
  }
}
