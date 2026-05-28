// MessageBar - 说话气泡系统（对标 VPet MessageBar.xaml）
// 支持打字机效果、流式追加、自动换行、淡出

class MessageBar {
  constructor() {
    this._text = '';
    this._visibleText = '';
    this._charIndex = 0;
    this._charTimer = 0;
    this._charSpeed = SPEECH_CFG.DEFAULT_SPEED;
    this._displayTimer = 0;
    this._mode = 'inactive'; // inactive | typewriter | display | fadeout
    this._isStreaming = false;
    this._opacity = 0;
    this._isVisible = false;
  }

  get isVisible() { return this._isVisible && this._mode !== 'inactive'; }
  get opacity() { return this._opacity; }
  get isStreaming() { return this._isStreaming; }
  get visibleText() { return this._visibleText; }
  get mode() { return this._mode; }

  say(text, speed = null) {
    this._text = text;
    this._visibleText = '';
    this._charIndex = 0;
    this._charSpeed = speed || SPEECH_CFG.DEFAULT_SPEED;
    this._charTimer = 0;
    this._displayTimer = 0;
    this._isStreaming = false;
    this._isVisible = true;
    this._opacity = 1;
    this._mode = 'typewriter';
  }

  appendChunk(chunkText) {
    if (!this._isStreaming) {
      this._isStreaming = true;
      this._isVisible = true;
      this._opacity = 1;
      this._mode = 'typewriter';
      this._charSpeed = SPEECH_CFG.FAST_SPEED;
    }
    this._text += chunkText;
  }

  finishStreaming() {
    this._isStreaming = false;
    if (this._charIndex >= this._text.length) {
      this._startDisplayPhase();
    }
  }

  update() {
    if (this._mode === 'inactive') return;

    if (this._mode === 'typewriter') {
      this._charTimer++;
      if (this._charTimer >= this._charSpeed && this._charIndex < this._text.length) {
        this._charTimer = 0;
        this._charIndex++;
        this._visibleText = this._text.substring(0, this._charIndex);
      }
      if (this._charIndex >= this._text.length && !this._isStreaming) {
        this._startDisplayPhase();
      }
    }

    if (this._mode === 'display') {
      this._displayTimer++;
      const totalTicks = Math.max(this._text.length * SPEECH_CFG.DISPLAY_TICKS_PER_CHAR + 20, 60);
      if (this._displayTimer > totalTicks) {
        this._mode = 'fadeout';
        this._displayTimer = 0;
      }
    }

    if (this._mode === 'fadeout') {
      this._displayTimer++;
      this._opacity = Math.max(0, 1 - this._displayTimer * SPEECH_CFG.CLOSE_STEP);
      if (this._opacity <= 0) {
        this._mode = 'inactive';
        this._isVisible = false;
        this._text = '';
        this._visibleText = '';
      }
    }
  }

  _startDisplayPhase() {
    this._mode = 'display';
    this._displayTimer = 0;
  }

  cancel() {
    this._mode = 'inactive';
    this._isVisible = false;
    this._isStreaming = false;
    this._text = '';
    this._visibleText = '';
    this._opacity = 0;
  }
}