// GraphCore v2 - 使用真实 PNG 帧的动画注册表 + 调度器
// 接受 PngLoader，按需加载 RealFrameAnim

class GraphCore {
  constructor(pngLoader) {
    this.loader = pngLoader;
    this._currentAnim = null;
    this._currentGraphType = null;
    this._onComplete = null;

    // 缓存已加载的动画实例: "graphType|modeType|animatType" → RealFrameAnim
    this._animCache = new Map();
  }

  _cacheKey(graphType, modeType, animatType) {
    return `${graphType}|${modeType}|${animatType}`;
  }

  // 获取或加载动画
  async getAnim(graphType, modeType, animatType) {
    const key = this._cacheKey(graphType, modeType, animatType);
    if (this._animCache.has(key)) return this._animCache.get(key);

    const anim = await this.loader.createFrameAnim(graphType, modeType, animatType);
    if (anim) this._animCache.set(key, anim);
    return anim;
  }

  // 查找已缓存的动画（同步）
  findCached(graphType, modeType, animatType) {
    let anim = this._animCache.get(this._cacheKey(graphType, modeType, animatType));
    if (anim) return anim;

    // 回退到 normal
    anim = this._animCache.get(this._cacheKey(graphType, 'normal', animatType));
    if (anim) return anim;
    // 回退到 b_loop
    anim = this._animCache.get(this._cacheKey(graphType, modeType, 'b_loop'));
    if (anim) return anim;
    // 回退到 normal + b_loop
    anim = this._animCache.get(this._cacheKey(graphType, 'normal', 'b_loop'));
    return anim;
  }

  // 异步查找（会尝试加载）
  async find(graphType, modeType, animatType) {
    let anim = this.findCached(graphType, modeType, animatType);
    if (anim) return anim;
    return await this.getAnim(graphType, modeType, animatType);
  }

  // 预加载一组动画
  async preload(graphType, modeType) {
    for (const atype of ['a_start', 'b_loop', 'c_end', 'single']) {
      await this.getAnim(graphType, modeType, atype);
    }
  }

  // 预加载常用动画
  async preloadCommon() {
    const common = [
      ['default', 'normal', 'b_loop'],
      ['default', 'normal', 'single'],
      ['move', 'normal', 'b_loop'],
      ['sleep', 'normal', 'b_loop'],
      ['touch_head', 'normal', 'b_loop'],
      ['touch_head', 'happy', 'b_loop'],
      ['raise', 'normal', 'b_loop'],
      ['say', 'normal', 'b_loop'],
      ['startup', 'normal', 'single'],
      ['idle', 'normal', 'b_loop'],
    ];
    for (const [gt, mt, at] of common) {
      await this.getAnim(gt, mt, at).catch(() => {});
    }
  }

  // 同步播放（用于已缓存的动画）
  playSync(graphType, modeType, animatType, onFrame, onComplete) {
    const anim = this.findCached(graphType, modeType, animatType);
    if (!anim) {
      if (onComplete) onComplete();
      return null;
    }
    this._currentAnim = anim;
    this._currentGraphType = graphType;
    this._onComplete = onComplete;
    anim.reset();
    anim.play(onFrame, () => {
      this._currentAnim = null;
      this._currentGraphType = null;
      if (onComplete) onComplete();
    });
    return anim;
  }

  // 同步播放循环
  playLoopSync(graphType, modeType, animatType, onFrame, loopCount) {
    const anim = this.findCached(graphType, modeType, animatType);
    if (!anim) return null;
    this._currentAnim = anim;
    this._currentGraphType = graphType;
    anim.reset();
    anim.playLoop(onFrame, loopCount, () => {
      this._currentAnim = null;
      this._currentGraphType = null;
    });
    return anim;
  }

  // 播放完整动画链 A_Start → B_Loop → C_End
  playChain(graphType, modeType, onFrame, onComplete, loopCount = 2) {
    // 尝试 SINGLE
    const single = this.findCached(graphType, modeType, 'single');
    if (single) {
      return this.playSync(graphType, modeType, 'single', onFrame, onComplete);
    }

    const start = this.findCached(graphType, modeType, 'a_start');
    const loop = this.findCached(graphType, modeType, 'b_loop');
    const end = this.findCached(graphType, modeType, 'c_end');

    if (!start && !loop && !end) {
      if (onComplete) onComplete();
      return null;
    }

    if (!start && !end && loop) {
      return this.playLoopSync(graphType, modeType, 'b_loop', onFrame, loopCount);
    }

    this._chainPlay([start, loop, end].filter(Boolean), onFrame, onComplete, loopCount);
  }

  _chainPlay(anims, onFrame, onComplete, loopCount, idx = 0) {
    if (idx >= anims.length) {
      if (onComplete) onComplete();
      return;
    }
    const anim = anims[idx];
    this._currentAnim = anim;
    anim.reset();

    if (anim.isLoop && idx === 1 && loopCount > 0) {
      anim.playLoop(onFrame, loopCount, () => {
        this._chainPlay(anims, onFrame, onComplete, loopCount, idx + 1);
      });
    } else {
      anim.play(onFrame, () => {
        this._chainPlay(anims, onFrame, onComplete, loopCount, idx + 1);
      });
    }
  }

  stop() {
    if (this._currentAnim) {
      this._currentAnim.stop();
      this._currentAnim = null;
    }
  }

  get currentGraphType() { return this._currentGraphType; }
  get isPlaying() { return !!this._currentAnim; }
  get currentAnim() { return this._currentAnim; }
}