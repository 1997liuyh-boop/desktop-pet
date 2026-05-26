// SideHide - pet hides at screen edge when idle, pops out on hover
class SideHide {
  constructor(pet) {
    this.pet = pet;
    this.isHidden = false;
    this.hideEdge = null;
    this.idleTimeMs = 0;
    this.originalBounds = null;
    this.isAnimating = false;
    this.enabled = true;
  }

  update(dtMs) {
    if (!this.enabled || !isElectron()) return;

    // Accumulate idle time
    if (this.pet.state === PetState.IDLE || this.pet.state === PetState.SIT) {
      this.idleTimeMs += dtMs;
    } else {
      this.idleTimeMs = 0;
      if (this.isHidden) this.showFromEdge();
    }

    // Check if we should hide
    if (!this.isHidden && this.idleTimeMs > SIDE_HIDE.IDLE_TIMEOUT) {
      const edge = this._getNearestEdge();
      if (edge) {
        this.hideToEdge(edge);
      }
    }

    // Check if mouse is near hidden tab
    if (this.isHidden && !this.isAnimating) {
      this._checkMouseNear();
    }
  }

  _getNearestEdge() {
    try {
      const bounds = window.electronAPI.getWindowBounds();
      const screen = window.electronAPI.getScreenInfo();
      if (!bounds || !screen) return null;

      const distLeft = bounds.x;
      const distRight = screen.workAreaWidth - bounds.x - bounds.width;
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
      const bounds = window.electronAPI.getWindowBounds();
      const screen = window.electronAPI.getScreenInfo();
      if (!bounds) return;

      this.originalBounds = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
      this.hideEdge = edge;
      this.isAnimating = true;

      const tab = SIDE_HIDE.TAB_SIZE;
      let newX = bounds.x;
      let newY = bounds.y;

      switch (edge) {
        case 'left': newX = -(bounds.width - tab); break;
        case 'right': newX = screen.workAreaWidth - tab; break;
        case 'top': newY = -(bounds.height - tab); break;
      }

      window.electronAPI.setWindowBounds(newX, newY, bounds.width, bounds.height);
      this.isHidden = true;
      this.isAnimating = false;
    } catch (e) { /* ignore */ }
  }

  showFromEdge() {
    if (!this.originalBounds) return;
    try {
      this.isAnimating = true;
      window.electronAPI.setWindowBounds(
        this.originalBounds.x, this.originalBounds.y,
        this.originalBounds.w, this.originalBounds.h
      );
      this.isHidden = false;
      this.hideEdge = null;
      this.originalBounds = null;
      this.idleTimeMs = 0;
      this.isAnimating = false;
    } catch (e) { /* ignore */ }
  }

  _checkMouseNear() {
    // Simple check: if pet receives any interaction, show
    // The actual hover-based reveal is handled by the pet window's own mouseenter
  }

  resetIdle() {
    this.idleTimeMs = 0;
    if (this.isHidden) this.showFromEdge();
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; if (this.isHidden) this.showFromEdge(); }
}
