export interface Session {
  id: string;
  label: string;
  status: "active";
  sessionStartedAt?: number | undefined;
  transcriptPath?: string | undefined;
}

export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  /** Transcript paths stored before a session is registered (hook fires before bridge). */
  private readonly pendingPaths = new Map<string, string>();

  add(id: string, label: string, sessionStartedAt?: number): Session {
    const resolvedLabel = this.resolveLabel(label);
    const session: Session = { id, label: resolvedLabel, status: "active", sessionStartedAt };
    // Inherit any transcript path stored by a hook before the bridge registered.
    const pendingPath = this.pendingPaths.get(id);
    if (pendingPath) {
      session.transcriptPath = pendingPath;
    }
    this.sessions.set(id, session);
    return session;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  setTranscriptPath(id: string, path: string): void {
    // Always store in pendingPaths so the path survives registry.add() which
    // creates a fresh Session. The hook fires before the bridge registers, so
    // the session may not exist yet.
    this.pendingPaths.set(id, path);
    const session = this.sessions.get(id);
    if (session) {
      session.transcriptPath = path;
    }
  }

  getTranscriptPath(id: string): string | undefined {
    return this.sessions.get(id)?.transcriptPath ?? this.pendingPaths.get(id);
  }

  private resolveLabel(base: string): string {
    const taken = new Set<string>();
    for (const session of this.sessions.values()) {
      taken.add(session.label);
    }

    if (!taken.has(base)) return base;

    let n = 2;
    while (taken.has(`${base} (${n})`)) n++;
    return `${base} (${n})`;
  }
}
