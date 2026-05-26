/**
 * Canvas renderer - draws the pet character with all animations
 */
class PetRenderer {
  constructor(canvas, pet) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pet = pet;
  }

  draw() {
    const ctx = this.ctx;
    const pet = this.pet;

    ctx.clearRect(0, 0, pet.canvasW, pet.canvasH);

    // Mood-based overlay
    const mood = pet.mood;
    if (mood === ModeType.ILL) {
      ctx.save();
      ctx.fillStyle = 'rgba(200, 220, 180, 0.25)';
      ctx.fillRect(0, 0, pet.canvasW, pet.canvasH);
      ctx.restore();
    } else if (mood === ModeType.POOR) {
      ctx.save();
      ctx.fillStyle = 'rgba(180, 180, 180, 0.1)';
      ctx.fillRect(0, 0, pet.canvasW, pet.canvasH);
      ctx.restore();
    }

    this.drawShadow(pet.x, pet.y);

    switch (pet.state) {
      case PetState.IDLE:  this.drawIdle(pet.x, pet.y, pet.direction, pet.animTimer); break;
      case PetState.WALK:  this.drawWalk(pet.x, pet.y, pet.direction, pet.animTimer); break;
      case PetState.SIT:   this.drawSit(pet.x, pet.y, pet.direction, pet.animTimer); break;
      case PetState.SLEEP: this.drawSleep(pet.x, pet.y, pet.direction, pet.animTimer); break;
      case PetState.HAPPY: this.drawHappy(pet.x, pet.y, pet.direction, pet.animTimer); break;
      case PetState.DRAG:  this.drawIdle(pet.x, pet.y, pet.direction, pet.animTimer); break;
      case PetState.EAT:   this.drawEat(pet.x, pet.y, pet.direction, pet.animTimer); break;
      case PetState.WORK:  this.drawWork(pet.x, pet.y, pet.direction, pet.animTimer); break;
      case PetState.CHAT:  this.drawIdle(pet.x, pet.y, pet.direction, pet.animTimer); break;
      default: this.drawIdle(pet.x, pet.y, pet.direction, pet.animTimer);
    }

    // Sick effects
    if (mood === ModeType.ILL) this.drawSickEffects(pet.x, pet.y);

    this.drawHearts();
    this.drawSleepZs();

    // Typewriter-aware speech bubble
    if (pet.isSpeechVisible()) {
      this.drawTypewriterBubble(pet.x, pet.y - 70, pet);
    }

    this.drawNameTag();
  }

  drawShadow(x, y) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.beginPath();
    ctx.ellipse(x, y + 48, 22, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // === IDLE ANIMATION ===
  drawIdle(x, y, dir, timer) {
    const ctx = this.ctx;
    const breath = Math.sin(timer * 0.05) * 1.5; // Subtle breathing

    ctx.save();
    ctx.translate(x, y + breath);
    ctx.scale(dir, 1);

    // Tail (behind body) - gentle sway
    this.drawTail(0, 0, Math.sin(timer * 0.04) * 8);

    // Back legs
    this.drawBackLegs(0, 0);

    // Body
    this.drawBody(0, 0);

    // Front legs
    this.drawFrontLegs(0, 0);

    // Head
    this.drawHead(0, -28);

    // Ears
    this.drawEars(0, -28);

    // Face
    this.drawFace(0, -28, this.pet.expression, timer);

    ctx.restore();
  }

  // === WALK ANIMATION ===
  drawWalk(x, y, dir, timer) {
    const ctx = this.ctx;
    const cycle = Math.floor(timer / 8) % 4;
    const legOffsets = [
      { fl: 0, bl: 0 },     // Stand
      { fl: 5, bl: -4 },    // Step 1
      { fl: 0, bl: 0 },     // Stand
      { fl: -4, bl: 5 },    // Step 2
    ];
    const bobY = Math.sin(timer * 0.3) * 3;

    ctx.save();
    ctx.translate(x, y + bobY);
    ctx.scale(dir, 1);

    // Tail - sway during walk
    this.drawTail(0, 0, Math.sin(timer * 0.15) * 15);

    // Back legs with walk animation
    this.drawBackLegs(0, 0, legOffsets[cycle].bl);

    // Body
    this.drawBody(0, 0);

    // Front legs with walk animation
    this.drawFrontLegs(0, 0, legOffsets[cycle].fl);

    // Head
    this.drawHead(0, -28);

    // Ears
    this.drawEars(0, -28);

    // Face
    this.drawFace(0, -28, 'normal', timer);

    ctx.restore();
  }

  // === SIT ANIMATION ===
  drawSit(x, y, dir, timer) {
    const ctx = this.ctx;

    ctx.save();
    ctx.translate(x, y + 5);
    ctx.scale(dir, 1);

    // Tail wrapped around
    this.drawTail(0, 5, 25);

    // Body (squished down)
    this.drawBodySitting(0, 5);

    // Back legs (spread out)
    this.drawBackLegsSitting(0, 5);

    // Front legs (straight down)
    this.drawFrontLegsSitting(0, 5);

    // Head
    this.drawHead(0, -20);

    // Ears
    this.drawEars(0, -20);

    // Face
    this.drawFace(0, -20, this.pet.expression, timer);

    ctx.restore();
  }

  // === SLEEP ANIMATION ===
  drawSleep(x, y, dir, timer) {
    const ctx = this.ctx;
    const breath = Math.sin(timer * 0.03) * 2;

    ctx.save();
    ctx.translate(x + 10, y + 35);
    ctx.scale(dir, 1);

    // Tail
    this.drawTail(0, 0, 30 + Math.sin(timer * 0.02) * 5);

    // Body (lying down - rotated)
    ctx.rotate(-0.3);
    this.drawBodyLying(0, 0, breath);

    // Front legs tucked
    this.drawFrontLegsTucked(0, 0);

    // Back legs tucked
    this.drawBackLegsTucked(0, 0);

    // Head
    ctx.rotate(-0.2);
    this.drawHead(0, -22);

    // Closed eyes
    this.drawFaceSleeping(0, -22, timer);

    ctx.restore();
  }

  // === HAPPY ANIMATION ===
  drawHappy(x, y, dir, timer) {
    const ctx = this.ctx;
    const bounce = Math.abs(Math.sin(timer * 0.1)) * 8;

    ctx.save();
    ctx.translate(x, y - bounce);
    ctx.scale(dir, 1);

    // Tail - excited wagging
    this.drawTail(0, 0, Math.sin(timer * 0.3) * 20);

    // Back legs
    this.drawBackLegs(0, 0);

    // Body
    this.drawBody(0, 0);

    // Front legs (raised in excitement)
    this.drawFrontLegsRaised(0, 0, Math.sin(timer * 0.2) * 5);

    // Head
    this.drawHead(0, -28);

    // Ears (perked)
    this.drawEarsPerked(0, -28);

    // Happy face
    this.drawFace(0, -28, 'happy', timer);

    ctx.restore();
  }

  // === EAT ANIMATION ===
  drawEat(x, y, dir, timer) {
    const ctx = this.ctx;
    const nod = Math.sin(timer * 0.2) * 3;

    ctx.save();
    ctx.translate(x, y + nod);
    ctx.scale(dir, 1);

    this.drawTail(0, 0, 10);

    // Sitting body
    this.drawBodySitting(0, 5);

    this.drawBackLegsSitting(0, 5);
    this.drawFrontLegsSitting(0, 5);

    // Food item near mouth
    ctx.fillStyle = '#d2691e';
    ctx.beginPath();
    ctx.arc(18, -30, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.arc(18, -30, 2, 0, Math.PI * 2);
    ctx.fill();

    this.drawHead(0, -20);
    this.drawEars(0, -20);
    this.drawFace(0, -20, 'happy', timer);

    ctx.restore();
  }

  // === BODY PARTS ===

  drawBody(x, y) {
    const ctx = this.ctx;
    // Main body - orange tabby
    const gradient = ctx.createLinearGradient(x - 18, y, x + 18, y);
    gradient.addColorStop(0, '#ff9800');
    gradient.addColorStop(0.5, '#ffb74d');
    gradient.addColorStop(1, '#ff9800');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 20, 24, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly
    ctx.fillStyle = '#fff3e0';
    ctx.beginPath();
    ctx.ellipse(x, y + 15, 12, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stripes on body
    ctx.strokeStyle = '#e65100';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 2);
    ctx.quadraticCurveTo(x, y - 6, x + 10, y - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 6);
    ctx.quadraticCurveTo(x, y + 2, x + 10, y + 6);
    ctx.stroke();
  }

  drawBodySitting(x, y) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(x - 16, y, x + 16, y);
    gradient.addColorStop(0, '#ff9800');
    gradient.addColorStop(0.5, '#ffb74d');
    gradient.addColorStop(1, '#ff9800');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y + 8, 18, 20, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly
    ctx.fillStyle = '#fff3e0';
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 10, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBodyLying(x, y, breath) {
    const ctx = this.ctx;
    ctx.fillStyle = '#ff9800';
    ctx.beginPath();
    ctx.ellipse(x, y + breath, 30, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff3e0';
    ctx.beginPath();
    ctx.ellipse(x, y + 3 + breath, 20, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawHead(x, y) {
    const ctx = this.ctx;
    // Head
    ctx.fillStyle = '#ffb74d';
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Inner face (lighter area)
    ctx.fillStyle = '#ffe0b2';
    ctx.beginPath();
    ctx.arc(x, y + 4, 12, 0, Math.PI * 2);
    ctx.fill();

    // Head stripe pattern
    ctx.strokeStyle = '#e65100';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x, y - 8);
    ctx.stroke();
  }

  drawEars(x, y) {
    const ctx = this.ctx;
    // Left ear
    ctx.fillStyle = '#ff9800';
    ctx.beginPath();
    ctx.moveTo(x - 18, y - 6);
    ctx.lineTo(x - 8, y - 24);
    ctx.lineTo(x - 2, y - 8);
    ctx.closePath();
    ctx.fill();

    // Inner left ear
    ctx.fillStyle = '#ffccbc';
    ctx.beginPath();
    ctx.moveTo(x - 14, y - 7);
    ctx.lineTo(x - 8, y - 18);
    ctx.lineTo(x - 4, y - 8);
    ctx.closePath();
    ctx.fill();

    // Right ear
    ctx.fillStyle = '#ff9800';
    ctx.beginPath();
    ctx.moveTo(x + 18, y - 6);
    ctx.lineTo(x + 8, y - 24);
    ctx.lineTo(x + 2, y - 8);
    ctx.closePath();
    ctx.fill();

    // Inner right ear
    ctx.fillStyle = '#ffccbc';
    ctx.beginPath();
    ctx.moveTo(x + 14, y - 7);
    ctx.lineTo(x + 8, y - 18);
    ctx.lineTo(x + 4, y - 8);
    ctx.closePath();
    ctx.fill();
  }

  drawEarsPerked(x, y) {
    const ctx = this.ctx;
    // Perked up ears
    ctx.fillStyle = '#ff9800';
    ctx.beginPath();
    ctx.moveTo(x - 16, y - 5);
    ctx.lineTo(x - 6, y - 28);
    ctx.lineTo(x - 1, y - 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffccbc';
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 6);
    ctx.lineTo(x - 6, y - 21);
    ctx.lineTo(x - 3, y - 7);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ff9800';
    ctx.beginPath();
    ctx.moveTo(x + 16, y - 5);
    ctx.lineTo(x + 6, y - 28);
    ctx.lineTo(x + 1, y - 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffccbc';
    ctx.beginPath();
    ctx.moveTo(x + 12, y - 6);
    ctx.lineTo(x + 6, y - 21);
    ctx.lineTo(x + 3, y - 7);
    ctx.closePath();
    ctx.fill();
  }

  drawFace(x, y, expression, timer) {
    const ctx = this.ctx;

    // Eyes
    if (expression === 'happy') {
      // Happy squint
      ctx.strokeStyle = '#3e2723';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x - 7, y - 1, 4, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 7, y - 1, 4, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
    } else if (expression === 'surprised') {
      // Wide eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x - 7, y - 1, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.arc(x + 7, y - 1, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#3e2723';
      ctx.beginPath();
      ctx.arc(x - 7, y - 1, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.arc(x + 7, y - 1, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal eyes (blink occasionally)
      const blink = Math.sin(timer * 0.02) > 0.95;

      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x - 7, y - 1, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.arc(x + 7, y - 1, 5, 0, Math.PI * 2);
      ctx.fill();

      if (!blink) {
        ctx.fillStyle = '#3e2723';
        ctx.beginPath();
        ctx.arc(x - 7, y - 1, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.arc(x + 7, y - 1, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Eye shine
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x - 6, y - 2.5, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.arc(x + 8, y - 2.5, 1, 0, Math.PI * 2);
        ctx.fill();
      }

      if (expression === 'sleepy') {
        ctx.fillStyle = 'rgba(255, 183, 77, 0.7)';
        ctx.fillRect(x - 12, y - 6, 10, 5);
        ctx.fillRect(x + 2, y - 6, 10, 5);
      }
      if (expression === 'sick') {
        // Droopy eyes
        ctx.strokeStyle = '#3e2723';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x - 7, y, 4, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 7, y, 4, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
        // Dark circles
        ctx.fillStyle = 'rgba(100, 80, 120, 0.2)';
        ctx.beginPath();
        ctx.arc(x - 7, y - 1, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 7, y - 1, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Nose
    ctx.fillStyle = '#ff8a80';
    ctx.beginPath();
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x - 3, y + 6);
    ctx.lineTo(x + 3, y + 6);
    ctx.closePath();
    ctx.fill();

    // Mouth
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 1;
    if (expression === 'happy') {
      // Wide smile
      ctx.beginPath();
      ctx.arc(x, y + 8, 6, 0.1, Math.PI - 0.1);
      ctx.stroke();
    } else if (expression === 'surprised') {
      // Open mouth
      ctx.fillStyle = '#ef9a9a';
      ctx.beginPath();
      ctx.arc(x, y + 8, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Small smile
      ctx.beginPath();
      ctx.moveTo(x - 3, y + 8);
      ctx.quadraticCurveTo(x, y + 11, x + 3, y + 8);
      ctx.stroke();
    }

    // Whiskers
    ctx.strokeStyle = '#bfbfbf';
    ctx.lineWidth = 0.8;
    // Left whiskers
    ctx.beginPath();
    ctx.moveTo(x - 5, y + 4);
    ctx.lineTo(x - 22, y + 0);
    ctx.moveTo(x - 5, y + 6);
    ctx.lineTo(x - 22, y + 7);
    ctx.stroke();
    // Right whiskers
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 4);
    ctx.lineTo(x + 22, y + 0);
    ctx.moveTo(x + 5, y + 6);
    ctx.lineTo(x + 22, y + 7);
    ctx.stroke();
  }

  drawFaceSleeping(x, y, timer) {
    const ctx = this.ctx;

    // Closed eyes (curved lines)
    ctx.strokeStyle = '#3e2723';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x - 7, y, 3, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 7, y, 3, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();

    // Nose
    ctx.fillStyle = '#ff8a80';
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x - 2, y + 6);
    ctx.lineTo(x + 2, y + 6);
    ctx.closePath();
    ctx.fill();

    // Slight smile
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 2, y + 8);
    ctx.quadraticCurveTo(x, y + 10, x + 2, y + 8);
    ctx.stroke();
  }

  drawTail(x, y, sway) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 5, y + 20);
    ctx.quadraticCurveTo(x - 20, y + 15 + sway, x - 15, y - 5 + sway * 0.5);
    ctx.stroke();

    // Tail tip
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - 15, y - 5 + sway * 0.5, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  drawFrontLegs(x, y, offset = 0) {
    const ctx = this.ctx;
    ctx.fillStyle = '#ffb74d';
    const legW = 7;
    const legH = 20;

    // Left front leg
    ctx.beginPath();
    ctx.roundRect(x - 10 - legW / 2, y + 19 + offset, legW, legH, 4);
    ctx.fill();

    // Right front leg
    ctx.beginPath();
    ctx.roundRect(x + 10 - legW / 2, y + 19 - offset, legW, legH, 4);
    ctx.fill();

    // Paws
    ctx.fillStyle = '#fff3e0';
    ctx.beginPath();
    ctx.roundRect(x - 10 - legW / 2, y + 35 + offset, legW, 5, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x + 10 - legW / 2, y + 35 - offset, legW, 5, 3);
    ctx.fill();
  }

  drawFrontLegsRaised(x, y, raise) {
    const ctx = this.ctx;
    const legW = 7;
    const legH = 16;

    // Raised front legs
    ctx.fillStyle = '#ffb74d';
    ctx.save();
    ctx.translate(x - 8, y + 28);
    ctx.rotate(-0.5);
    ctx.beginPath();
    ctx.roundRect(-legW / 2, raise - legH, legW, legH, 4);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x + 8, y + 28);
    ctx.rotate(0.5);
    ctx.beginPath();
    ctx.roundRect(-legW / 2, raise - legH, legW, legH, 4);
    ctx.fill();
    ctx.restore();
  }

  drawFrontLegsSitting(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = '#ffb74d';
    // Straight down
    ctx.beginPath();
    ctx.roundRect(x - 7, y + 18, 6, 20, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 18, 6, 20, 3);
    ctx.fill();

    // Paws
    ctx.fillStyle = '#fff3e0';
    ctx.beginPath();
    ctx.roundRect(x - 7, y + 34, 6, 5, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 34, 6, 5, 3);
    ctx.fill();
  }

  drawFrontLegsTucked(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = '#ffb74d';
    ctx.beginPath();
    ctx.roundRect(x + 8, y + 5, 15, 7, 3);
    ctx.fill();
  }

  drawBackLegs(x, y, offset = 0) {
    const ctx = this.ctx;
    ctx.fillStyle = '#f57c00';
    const legW = 8;

    // Left back leg
    ctx.beginPath();
    ctx.ellipse(x - 9, y + 30 + offset, 5, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Right back leg
    ctx.beginPath();
    ctx.ellipse(x + 9, y + 30 - offset, 5, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Paws
    ctx.fillStyle = '#fff3e0';
    ctx.beginPath();
    ctx.ellipse(x - 9, y + 34 + offset, 4, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 9, y + 34 - offset, 4, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBackLegsSitting(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = '#f57c00';
    // Spread out
    ctx.beginPath();
    ctx.ellipse(x - 14, y + 22, 9, 7, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 14, y + 22, 9, 7, -0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff3e0';
    ctx.beginPath();
    ctx.ellipse(x - 14, y + 26, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 14, y + 26, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBackLegsTucked(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = '#f57c00';
    ctx.beginPath();
    ctx.ellipse(x + 8, y + 12, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // === EFFECTS ===

  drawHearts() {
    const ctx = this.ctx;
    for (const h of this.pet.hearts) {
      ctx.save();
      ctx.globalAlpha = h.opacity;
      ctx.fillStyle = '#ff4081';
      ctx.font = `${h.size}px serif`;
      ctx.fillText('❤', h.x - h.size / 2, h.y);
      ctx.restore();
    }
  }

  drawSleepZs() {
    const ctx = this.ctx;
    for (const z of this.pet.sleepZs) {
      ctx.save();
      ctx.globalAlpha = z.opacity;
      ctx.fillStyle = '#90caf9';
      ctx.font = `bold ${z.size}px sans-serif`;
      ctx.fillText('Z', z.x, z.y);
      ctx.restore();
    }
  }

  drawSpeechBubble(x, y, text, timer) {
    const ctx = this.ctx;
    const opacity = Math.min(1, timer / 20); // Fade in
    const fadeOut = timer < 30 ? timer / 30 : 1; // Fade out
    const alpha = opacity * fadeOut;

    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Measure text
    ctx.font = '13px "Microsoft YaHei", sans-serif';
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const bubbleW = textWidth + 20;
    const bubbleH = 30;

    const bx = x - bubbleW / 2;
    const by = y - bubbleH;

    // Bubble background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, 10);
    ctx.fill();
    ctx.stroke();

    // Bubble tail
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.moveTo(x - 5, by + bubbleH);
    ctx.lineTo(x, by + bubbleH + 8);
    ctx.lineTo(x + 5, by + bubbleH);
    ctx.closePath();
    ctx.fill();

    // Text
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, by + bubbleH / 2);

    ctx.restore();
  }

  // === WORK ANIMATION ===
  drawWork(x, y, dir, timer) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y + 5);
    ctx.scale(dir, 1);

    this.drawTail(0, 5, 15);
    this.drawBodySitting(0, 5);
    this.drawBackLegsSitting(0, 5);
    this.drawFrontLegsSitting(0, 5);
    this.drawHead(0, -20);
    this.drawEars(0, -20);
    this.drawFace(0, -20, 'normal', timer);

    // Laptop/book prop
    ctx.fillStyle = '#607d8b';
    ctx.beginPath();
    ctx.roundRect(-10, 15, 25, 18, 3);
    ctx.fill();
    ctx.fillStyle = '#37474f';
    ctx.beginPath();
    ctx.roundRect(-6, 18, 17, 12, 2);
    ctx.fill();
    ctx.fillStyle = '#2196f3';
    ctx.beginPath();
    ctx.roundRect(-4, 20, 6, 6, 1);
    ctx.fill();

    // Speech bubble: "Working..."
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(18, -30, 50, 18, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#555';
    ctx.font = '9px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('工作中...', 43, -18);

    ctx.restore();
  }

  // === SICK EFFECTS ===
  drawSickEffects(x, y) {
    const ctx = this.ctx;
    const t = this.pet.animTimer;

    // Sweat drops
    ctx.save();
    ctx.fillStyle = '#64b5f6';
    ctx.globalAlpha = 0.7;
    for (let i = 0; i < 2; i++) {
      const sx = x + 15 + i * 10 + Math.sin(t * 0.05 + i) * 3;
      const sy = y - 40 + t * 0.2 % 30;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx - 3, sy + 6, sx + 3, sy + 6, sx, sy + 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // === TYPEWRITER SPEECH BUBBLE ===
  drawTypewriterBubble(x, y, pet) {
    const ctx = this.ctx;
    const text = pet.getActiveSpeechText();
    if (!text) return;

    const opacity = pet.getSpeechOpacity();
    if (opacity <= 0) return;

    ctx.save();
    ctx.globalAlpha = opacity;

    ctx.font = '13px "Microsoft YaHei", sans-serif';
    // Auto-wrap at ~18 chars
    const charsPerLine = 16;
    const lines = [];
    for (let i = 0; i < text.length; i += charsPerLine) {
      lines.push(text.substring(i, i + charsPerLine));
    }
    const maxLineW = ctx.measureText('喵'.repeat(charsPerLine)).width + 10;
    const bubbleW = Math.max(40, Math.min(maxLineW, text.length * 8 + 20));
    const lineH = 18;
    const bubbleH = lines.length * lineH + 16;

    const bx = x - bubbleW / 2;
    const by = y - bubbleH;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, 10);
    ctx.fill();
    ctx.stroke();

    // Tail
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.moveTo(x - 5, by + bubbleH);
    ctx.lineTo(x, by + bubbleH + 8);
    ctx.lineTo(x + 5, by + bubbleH);
    ctx.closePath();
    ctx.fill();

    // Text lines
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, x, by + 8 + i * lineH);
    });

    // Blinking cursor during streaming
    if (pet.speech && pet.speech.isStreaming && Math.floor(pet.animTimer / 15) % 2) {
      const lastLine = lines[lines.length - 1] || '';
      const lw = ctx.measureText(lastLine).width;
      ctx.fillStyle = '#333';
      ctx.fillRect(x + lw / 2 + 2, by + 8 + (lines.length - 1) * lineH, 2, lineH);
    }

    ctx.restore();
  }

  drawNameTag() {
    const ctx = this.ctx;
    const pet = this.pet;
    if (pet.state === PetState.DRAG) return;

    ctx.save();
    ctx.globalAlpha = 0.5;

    // Mood emoji
    const moodEmojis = {
      [ModeType.HAPPY]: '😊', [ModeType.NORMAL]: '😐',
      [ModeType.POOR]: '😞', [ModeType.ILL]: '🤒',
    };
    const emoji = moodEmojis[pet.mood] || '';

    ctx.fillStyle = '#333';
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`小橘 ${emoji}`, pet.x, pet.y - 50);
    ctx.restore();
  }
}
