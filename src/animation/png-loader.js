// PngLoader - 从 VPet 资源目录加载 PNG 帧
// 使用 manifest 定位帧文件，通过 Electron/浏览器 fetch 加载为 ImageBitmap
// 支持 LRU 缓存以避免 5000+ 帧同时驻留内存

class PngLoader {
  constructor(manifest, assetBasePath) {
    this.manifest = manifest;
    this.basePath = assetBasePath; // e.g. 'D:/demo3/VPet/VPet-Simulator.Windows/mod/0000_core/pet/vup/'
    this._cache = new Map();       // key: filePath → ImageBitmap
    this._maxCache = 200;          // 最大缓存帧数
    this._accessOrder = [];        // LRU 顺序
  }

  // 加载单个帧
  async loadFrame(filePath, duration) {
    const key = filePath;
    if (this._cache.has(key)) {
      this._touchLRU(key);
      return this._cache.get(key);
    }

    let bitmap;

    if (isElectron() && window.electronAPI.readPngFrame) {
      // Electron: 通过 IPC 主进程读取文件
      const base64 = window.electronAPI.readPngFrame(filePath);
      if (!base64) throw new Error(`无法加载帧: ${filePath}`);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      bitmap = await createImageBitmap(blob);
    } else {
      // 浏览器环境
      const fullPath = this.basePath + filePath.replace(/\//g, '\\');
      const url = 'file:///' + fullPath.replace(/\\/g, '/');
      const resp = await fetch(url);
      const blob = await resp.blob();
      bitmap = await createImageBitmap(blob);
    }

    this._cache.set(key, bitmap);
    this._accessOrder.push(key);
    this._evictLRU();
    return bitmap;
  }

  // 预加载一组帧
  async preloadFrames(frameList) {
    const promises = frameList.map(f => this.loadFrame(f.file, f.duration));
    return await Promise.all(promises);
  }

  // 从 manifest 获取指定动画的帧信息列表
  getFrameList(graphType, modeType, animatType) {
    const modes = this.manifest.animations[graphType];
    if (!modes) return null;

    // 先精确匹配 modeType
    let atypes = modes[modeType];
    // 回退到 normal
    if (!atypes) atypes = modes['normal'];
    if (!atypes) return null;

    // 精确匹配 animatType
    let frames = atypes[animatType];
    // 回退到 single
    if (!frames) frames = atypes['single'];
    // 回退到 b_loop
    if (!frames) frames = atypes['b_loop'];
    if (!frames) return null;

    return frames;
  }

  // 创建可播放的 FrameAnim 实例
  async createFrameAnim(graphType, modeType, animatType) {
    const frameList = this.getFrameList(graphType, modeType, animatType);
    if (!frameList || frameList.length === 0) return null;

    // 限制一次加载的帧数
    const frames = await this.preloadFrames(frameList.slice(0, 100));

    // 获取每帧时长
    const durations = frameList.slice(0, 100).map(f => f.duration);

    return new RealFrameAnim(frames, durations, animatType);
  }

  _touchLRU(key) {
    const idx = this._accessOrder.indexOf(key);
    if (idx >= 0) this._accessOrder.splice(idx, 1);
    this._accessOrder.push(key);
  }

  _evictLRU() {
    while (this._cache.size > this._maxCache) {
      const oldest = this._accessOrder.shift();
      if (oldest) {
        const bmp = this._cache.get(oldest);
        if (bmp) bmp.close();
        this._cache.delete(oldest);
      }
    }
  }
}

// RealFrameAnim - 真实 PNG 帧动画播放器
class RealFrameAnim {
  constructor(frames, durations, animatType) {
    this.frames = frames;         // ImageBitmap[]
    this.durations = durations;   // 每帧的显示时长(ms)
    this.isLoop = (animatType === 'b_loop');
    this.animatType = animatType;

    this._currentFrame = 0;
    this._elapsed = 0;
    this._running = false;
    this._onFrame = null;
    this._onComplete = null;
    this._loopCount = 0;
    this._loopTarget = 1;
    this._loopIteration = 0;
  }

  get currentFrameImage() {
    if (this.frames.length === 0) return null;
    return this.frames[this._currentFrame % this.frames.length];
  }

  reset() {
    this._currentFrame = 0;
    this._elapsed = 0;
    this._running = false;
    this._loopIteration = 0;
  }

  play(onFrame, onComplete) {
    if (this.frames.length === 0) { if (onComplete) onComplete(); return; }
    this._running = true;
    this._onFrame = onFrame;
    this._onComplete = onComplete;
    this._currentFrame = 0;
    this._elapsed = 0;
    this._loopTarget = 1;
    // 立即触发第一帧
    if (onFrame) onFrame(this.currentFrameImage, 0);
  }

  playLoop(onFrame, count, onComplete) {
    if (this.frames.length === 0) { if (onComplete) onComplete(); return; }
    this._running = true;
    this._onFrame = onFrame;
    this._onComplete = onComplete;
    this._currentFrame = 0;
    this._elapsed = 0;
    this._loopTarget = count;
    this._loopIteration = 0;
    if (onFrame) onFrame(this.currentFrameImage, 0);
  }

  update(dt) {
    if (!this._running || this.frames.length === 0) return false;

    const dur = this.durations[this._currentFrame % this.durations.length] || 125;
    this._elapsed += dt;

    if (this._elapsed >= dur) {
      this._elapsed -= dur;
      this._currentFrame++;

      if (this._currentFrame >= this.frames.length) {
        this._loopIteration++;
        if (this._loopTarget > 0 && this._loopIteration >= this._loopTarget) {
          this._running = false;
          this._currentFrame = this.frames.length - 1;
          if (this._onComplete) { const cb = this._onComplete; this._onComplete = null; cb(); }
          return true;
        }
        this._currentFrame = 0;
      }

      if (this._onFrame) {
        this._onFrame(this.currentFrameImage, this._currentFrame % this.frames.length);
      }
      return true;
    }
    return false;
  }

  stop() {
    this._running = false;
    this._onComplete = null;
    this._onFrame = null;
  }
}