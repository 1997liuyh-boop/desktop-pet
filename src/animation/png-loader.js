// PngLoader - 从本地 assets/vup 资源目录加载 PNG 帧
// 使用 manifest 定位帧文件，通过 Electron/浏览器 fetch 加载为 ImageBitmap
// 支持 LRU 缓存以避免 5000+ 帧同时驻留内存
// v2: 异步帧加载 + 双缓冲预解码

class PngLoader {
  constructor(manifest, assetBasePath) {
    this.manifest = manifest;
    this.basePath = assetBasePath; // e.g. '../assets/vup/'
    this._cache = new Map();       // key: filePath → ImageBitmap
    this._maxCache = 500;          // 增大缓存：行走动画帧多，200容易被挤占
    this._accessOrder = [];        // LRU 顺序
    this._loading = new Map();     // key: filePath → Promise<ImageBitmap>  防止重复加载
  }

  // 加载单个帧（异步，优先使用异步IPC）
  async loadFrame(filePath, duration) {
    const key = filePath;

    // 已缓存 → 直接返回
    if (this._cache.has(key)) {
      this._touchLRU(key);
      return this._cache.get(key);
    }

    // 正在加载中 → 复用同一个 Promise（防止并发重复加载）
    if (this._loading.has(key)) {
      return this._loading.get(key);
    }

    const loadPromise = this._doLoadFrame(filePath);
    this._loading.set(key, loadPromise);

    try {
      const bitmap = await loadPromise;
      this._cache.set(key, bitmap);
      this._accessOrder.push(key);
      this._evictLRU();
      return bitmap;
    } finally {
      this._loading.delete(key);
    }
  }

  async _doLoadFrame(filePath) {
    let bitmap;

    if (isElectron() && window.electronAPI.readPngFrameAsync) {
      // 优先使用异步 IPC — 不阻塞渲染线程
      const base64 = await window.electronAPI.readPngFrameAsync(filePath);
      if (!base64) throw new Error(`无法加载帧: ${filePath}`);
      bitmap = await this._base64ToBitmap(base64);
    } else if (isElectron() && window.electronAPI.readPngFrame) {
      // 降级到同步 IPC（兼容旧版本）
      const base64 = window.electronAPI.readPngFrame(filePath);
      if (!base64) throw new Error(`无法加载帧: ${filePath}`);
      bitmap = await this._base64ToBitmap(base64);
    } else {
      // 浏览器环境
      const fullPath = this.basePath + filePath.replace(/\//g, '\\');
      const url = 'file:///' + fullPath.replace(/\\/g, '/');
      const resp = await fetch(url);
      const blob = await resp.blob();
      bitmap = await createImageBitmap(blob);
    }

    return bitmap;
  }

  // base64 → ImageBitmap（提取为公共方法）
  async _base64ToBitmap(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    return createImageBitmap(blob);
  }

  // 预加载一组帧
  async preloadFrames(frameList) {
    // 并发加载，最多同时8个请求避免IPC拥塞
    const results = [];
    const concurrency = 8;
    for (let i = 0; i < frameList.length; i += concurrency) {
      const batch = frameList.slice(i, i + concurrency);
      const bitmaps = await Promise.all(batch.map(f => this.loadFrame(f.file, f.duration)));
      results.push(...bitmaps);
    }
    return results;
  }

  // 从 manifest 获取指定动画的帧信息列表
  getFrameList(graphType, modeType, animatType) {
    const modes = this.manifest.animations[graphType];
    if (!modes) return null;

    let atypes = modes[modeType];
    if (!atypes) atypes = modes['normal'];
    if (!atypes) return null;

    return atypes[animatType] || null;
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

  // 预加载某个 graphType 的所有动画变体（行走时调用）
  async preloadGraph(graphType, modeType) {
    const modes = this.manifest.animations[graphType];
    if (!modes) return;

    let atypes = modes[modeType] || modes['normal'];
    if (!atypes) return;

    const allFrames = [];
    for (const animatType of Object.keys(atypes)) {
      const frameList = atypes[animatType];
      if (Array.isArray(frameList)) {
        allFrames.push(...frameList);
      }
    }

    if (allFrames.length > 0) {
      await this.preloadFrames(allFrames);
    }
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

// RealFrameAnim - 真实 PNG 帧动画播放器（双缓冲版）
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

    // 双缓冲：预缓存下一帧引用，减少帧切换延迟
    this._nextFrameReady = false;
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
    this._nextFrameReady = false;
  }

  play(onFrame, onComplete) {
    if (this.frames.length === 0) { if (onComplete) onComplete(); return; }
    this._running = true;
    this._onFrame = onFrame;
    this._onComplete = onComplete;
    this._currentFrame = 0;
    this._elapsed = 0;
    this._loopTarget = 1;
    this._nextFrameReady = false;
    // 立即触发第一帧
    if (onFrame) onFrame(this.currentFrameImage, 0);
    this._prepareNextFrame();
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
    this._nextFrameReady = false;
    if (onFrame) onFrame(this.currentFrameImage, 0);
    this._prepareNextFrame();
  }

  // 预标记下一帧已就绪（ImageBitmap已解码，切换零延迟）
  _prepareNextFrame() {
    if (this.frames.length <= 1) return;
    const nextIdx = (this._currentFrame + 1) % this.frames.length;
    this._nextFrameReady = this.frames[nextIdx] != null;
  }

  update(dt) {
    if (!this._running || this.frames.length === 0) return false;

    const dur = this.durations[this._currentFrame % this.durations.length] || 125;
    this._elapsed += dt;

    if (this._elapsed >= dur) {
      // 防止累积过大时跳太多帧（最多跳2帧）
      this._elapsed -= dur;
      if (this._elapsed > dur) this._elapsed = 0;

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
      this._prepareNextFrame();
      return true;
    }
    return false;
  }

  stop() {
    this._running = false;
    this._onComplete = null;
    this._onFrame = null;
    this._nextFrameReady = false;
  }
}
