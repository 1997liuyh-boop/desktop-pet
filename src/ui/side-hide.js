// SideHide - 宠物边缘自动隐藏
class SideHide {
  constructor(core, controller) {
    this.core = core;
    this.controller = controller;
    this.isHidden = false;
    this.hideEdge = null;
    this.idleTimeMs = 0;
    this.originalBounds = null;
    this.enabled = true;
  }

  update(dtMs) {
    if (!this.enabled || !isElectron()) return;

    if (this.core.state === PetState.IDLE || this.core.state === PetState.SIT) {
      this.idleTimeMs += dtMs;
    } else {
      this.idleTimeMs = 0;
      if (this.isHidden) this.showFromEdge();
    }

    if (!this.isHidden && this.idleTimeMs > SIDE_HIDE.IDLE_TIMEOUT) {
      const edge = this._getNearestEdge();
      if (edge) this.hideToEdge(edge);
    }
  }

  _getNearestEdge() {
    try {
      const bounds = this.controller.getWindowBounds();
      const si = this.controller.screenInfo;
      if (!bounds || !si) return null;

      const distLeft = bounds.x;
      const distRight = si.workAreaWidth - bounds.x - bounds.width;
      const distTop = bounds.y;
      const minDist = Math.min(distLeft, distRight, distTop);

      if (minDist < 80) {
        if (minDist === distLeft) return 'left';
        if (minDist === distRight) return 'right';
        if (minDist === distTop) return 'top';
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  hideToEdge(edge) {
    try {
      const bounds = this.controller.getWindowBounds();
      this.originalBounds = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
      this.hideEdge = edge;
      this.controller.moveToEdge(edge);
      this.isHidden = true;
    } catch (e) { /* ignore */ }
  }

  showFromEdge() {
    if (!this.originalBounds) return;
    this.controller.restorePosition(this.originalBounds);
    this.isHidden = false;
    this.hideEdge = null;
    this.originalBounds = null;
    this.idleTimeMs = 0;
  }

  resetIdle() {
    this.idleTimeMs = 0;
    if (this.isHidden) this.showFromEdge();
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; if (this.isHidden) this.showFromEdge(); }
}