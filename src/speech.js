// TypewriterSpeech - typewriter-effect speech bubble with streaming support
class TypewriterSpeech {
  constructor() {
    this.fullText = '';
    this.visibleText = '';
    this.charIndex = 0;
    this.charSpeed = SPEECH_CFG.DEFAULT_SPEED; // ms per character in game loop (frames)
    this.charTimer = 0;
    this.displayTimer = 0;
    this.isStreaming = false;
    this.isVisible = false;
    this.opacity = 0;
    this._mode = 'inactive'; // inactive | typewriter | display | fadeout
  }

  say(text, speed = null) {
    this.fullText = text;
    this.visibleText = '';
    this.charIndex = 0;
    this.charSpeed = speed || SPEECH_CFG.DEFAULT_SPEED;
    this.charTimer = 0;
    this.displayTimer = 0;
    this.isStreaming = false;
    this.isVisible = true;
    this.opacity = 1;
    this._mode = 'typewriter';
  }

  appendChunk(chunkText) {
    // For LLM streaming: extend the full text, continue typewriter
    if (!this.isStreaming) {
      this.isStreaming = true;
      this.isVisible = true;
      this.opacity = 1;
      this._mode = 'typewriter';
      this.charSpeed = SPEECH_CFG.FAST_SPEED;
    }
    this.fullText += chunkText;
  }

  finishStreaming() {
    this.isStreaming = false;
    // When complete, switch to display mode
    if (this.charIndex >= this.fullText.length) {
      this._startDisplayPhase();
    }
  }

  update() {
    if (this._mode === 'inactive') return;

    if (this._mode === 'typewriter') {
      this.charTimer++;
      if (this.charTimer >= this.charSpeed && this.charIndex < this.fullText.length) {
        this.charTimer = 0;
        // Reveal one character at a time
        this.charIndex++;
        this.visibleText = this.fullText.substring(0, this.charIndex);
      }
      // Transition to display when all text is revealed and not streaming
      if (this.charIndex >= this.fullText.length && !this.isStreaming) {
        this._startDisplayPhase();
      }
    }

    if (this._mode === 'display') {
      this.displayTimer++;
      const totalTicks = this.fullText.length * SPEECH_CFG.DISPLAY_TICKS_PER_CHAR + 20;
      if (this.displayTimer > totalTicks) {
        this._mode = 'fadeout';
        this.displayTimer = 0;
      }
    }

    if (this._mode === 'fadeout') {
      this.displayTimer++;
      this.opacity = Math.max(0, 1 - this.displayTimer * SPEECH_CFG.CLOSE_STEP);
      if (this.opacity <= 0) {
        this._mode = 'inactive';
        this.isVisible = false;
        this.fullText = '';
        this.visibleText = '';
      }
    }
  }

  _startDisplayPhase() {
    this._mode = 'display';
    this.displayTimer = 0;
  }

  cancel() {
    this._mode = 'inactive';
    this.isVisible = false;
    this.isStreaming = false;
    this.fullText = '';
    this.visibleText = '';
    this.opacity = 0;
  }

  isComplete() {
    return this._mode === 'inactive';
  }

  getCurrentText() {
    return this.isStreaming ? this.visibleText : this.visibleText;
  }

  hasUnreadChars() {
    return this.charIndex < this.fullText.length;
  }
}
