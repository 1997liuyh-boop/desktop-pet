// Controller - 窗口控制器（对标 VPet IController / MWController）
// 管理窗口移动、边缘检测、位置修正
// v2: 增加 dt 驱动移动 + 亚像素累积 + 屏幕边界弹回

class Controller {
  constructor() {
    this._screenInfo = null;
    // 亚像素累积器 — 窗口移动以整像素为单位，累积器避免截断丢失
    this._moveAccumX = 0;
    this._moveAccumY = 0;
    // 缓存窗口边界（避免每帧同步IPC查询）
    this._cachedBounds = null;
    this._boundsCacheTime = 0;
    this._BOUNDS_CACHE_TTL = 200; // 200ms刷新一次
  }

  get screenInfo() {
    if (!this._screenInfo && isElectron()) {
      this._screenInfo = window.electronAPI.getScreenInfo();
    }
    return this._screenInfo || { workAreaWidth: 1920, workAreaHeight: 1080 };
  }

  // 刷新屏幕信息（显示器可能切换）
  refreshScreenInfo() {
    if (isElectron()) {
      this._screenInfo = window.electronAPI.getScreenInfo();
    }
  }

  // 基于 dt 的方向移动（行走专用）
  // speedPxPerSec: 像素/秒, dt: 毫秒, direction: 1=右 -1=左
  // 返回: 当前方向（碰到边缘时返回反转方向）
  moveBySpeed(direction, speedPxPerSec, dt) {
    if (!isElectron()) return direction;

    const subPixel = speedPxPerSec * (dt / 1000) * direction;
    this._moveAccumX += subPixel;

    const dx = Math.trunc(this._moveAccumX);
    if (dx !== 0) {
      this._moveAccumX -= dx;

      // 屏幕边界检测 — 碰到边缘则反弹
      const bounds = this._getCachedBounds();
      const si = this.screenInfo;
      const nextX = bounds.x + dx;

      if (nextX < 0 || nextX + bounds.width > si.workAreaWidth) {
        // 碰到左右边界 → 反转方向
        this._moveAccumX = 0;
        return -direction;
      }

      window.electronAPI.moveWindow(dx, 0);
      // 移动后标记边界缓存过期
      this._cachedBounds = null;
    }
    return direction;
  }

  // 获取缓存的窗口边界（减少同步IPC调用）
  _getCachedBounds() {
    const now = performance.now();
    if (!this._cachedBounds || now - this._boundsCacheTime > this._BOUNDS_CACHE_TTL) {
      this._cachedBounds = this.getWindowBounds();
      this._boundsCacheTime = now;
    }
    return this._cachedBounds || { x: 0, y: 0, width: 250, height: 250 };
  }

  // 根据 Canvas 内偏移移动 Electron 窗口
  moveWindow(dx, dy) {
    if (!isElectron()) return;
    window.electronAPI.moveWindow(dx, dy);
  }

  // 设置窗口位置
  setWindowPos(x, y) {
    if (!isElectron()) return;
    window.electronAPI.setWindowPosition(x, y);
  }

  // 获取窗口边界
  getWindowBounds() {
    if (!isElectron()) return { x: 0, y: 0, width: 200, height: 250 };
    return window.electronAPI.getWindowBounds();
  }

  // 修正位置，确保窗口不超出屏幕
  clampToScreen(bounds) {
    const si = this.screenInfo;
    const clamped = { ...bounds };
    if (clamped.x < 0) clamped.x = 0;
    if (clamped.y < 0) clamped.y = 0;
    if (clamped.x + clamped.width > si.workAreaWidth) clamped.x = si.workAreaWidth - clamped.width;
    if (clamped.y + clamped.height > si.workAreaHeight) clamped.y = si.workAreaHeight - clamped.height;
    return clamped;
  }

  // 移动到屏幕边缘（侧边隐藏用）
  moveToEdge(edge) {
    if (!isElectron()) return;
    const bounds = this.getWindowBounds();
    const si = this.screenInfo;
    const tab = SIDE_HIDE.TAB_SIZE;

    switch (edge) {
      case 'left':  this.setWindowPos(-(bounds.width - tab), bounds.y); break;
      case 'right': this.setWindowPos(si.workAreaWidth - tab, bounds.y); break;
      case 'top':   this.setWindowPos(bounds.x, -(bounds.height - tab)); break;
    }
  }

  // 恢复原始位置
  restorePosition(origBounds) {
    if (!isElectron() || !origBounds) return;
    window.electronAPI.setWindowBounds(origBounds.x, origBounds.y, origBounds.w, origBounds.h);
  }

  // 设置窗口可穿透鼠标
  setIgnoreMouse(ignore) {
    if (!isElectron()) return;
    window.electronAPI.setIgnoreMouse(ignore);
  }

  // 重置亚像素累积器
  resetMoveAccum() {
    this._moveAccumX = 0;
    this._moveAccumY = 0;
  }
}
