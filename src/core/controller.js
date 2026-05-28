// Controller - 窗口控制器（对标 VPet IController / MWController）
// 管理窗口移动、边缘检测、位置修正

class Controller {
  constructor() {
    this._screenInfo = null;
  }

  get screenInfo() {
    if (!this._screenInfo && isElectron()) {
      this._screenInfo = window.electronAPI.getScreenInfo();
    }
    return this._screenInfo || { workAreaWidth: 1920, workAreaHeight: 1080 };
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
}