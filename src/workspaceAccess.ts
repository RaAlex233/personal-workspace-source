export interface WorkspaceAccess {
  writable: boolean;
  reason: string;
  release: () => void;
}

// Hold the lock for the lifetime of an editing page, including pending saves.
// IndexedDB and the separate timer key must always have the same owner.
export function acquireWorkspaceAccess(): Promise<WorkspaceAccess> {
  if (!navigator.locks) {
    return Promise.resolve({
      writable: false,
      reason: '此浏览器无法安全协调工作台页面，请使用支持 Web Locks 的浏览器并通过 localhost 或 HTTPS 打开。',
      release: () => undefined,
    });
  }
  return new Promise((resolve, reject) => {
    navigator.locks.request('personal-workspace-editor', { ifAvailable: true }, async lock => {
      if (!lock) {
        resolve({ writable: false, reason: '工作台已在另一页面打开，当前页面为只读。关闭另一页面后可重试。', release: () => undefined });
        return;
      }
      let release!: () => void;
      const held = new Promise<void>(done => { release = done; });
      resolve({ writable: true, reason: '', release });
      await held;
    }).catch(reject);
  });
}
