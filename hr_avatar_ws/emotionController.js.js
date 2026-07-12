/*
EmotionController

Drives every named Control toward whichever emotion preset is active,
easing over `duration` ms. Also layers two independent overlays on top:
  - blinking (automatic, periodic, on the eyelid controls)
  - speaking (toggled on/off, jitters jaw + lips like a rough viseme)

Usage:
	emotionController.playEmotion('thinking', 700);
	emotionController.startSpeaking();
	emotionController.stopSpeaking();

Call emotionController.update() once per frame, before blendMeshToTargets().
*/

function EmotionController(_controls) {
	this.controls = {};
	for (let control of _controls) {
		this.controls[control.name] = control;
	}

	this.currentEmotion = 'neutral';
	this.duration = 600;
	this.startTime = 0;

	this.from = {};
	this.to = {};
	this.current = {};
	for (let name in this.controls) {
		this.from[name] = {x: 0, y: 0};
		this.to[name] = {x: 0, y: 0};
		this.current[name] = {x: 0, y: 0};
	}

	// Head rotation (degrees), tweened the same way as the face controls.
	// tiltZ = head cocked side to side, turnY = head turned left/right, nodX = chin up/down.
	this.headFrom = {tiltZ: 0, turnY: 0, nodX: 0};
	this.headTo = {tiltZ: 0, turnY: 0, nodX: 0};
	this.headCurrent = {tiltZ: 0, turnY: 0, nodX: 0};

	// Final combined rotation (radians) that main.js.js reads each frame.
	this.headRotation = {x: 0, y: 0, z: 0};

	// --- Emotion transitions -------------------------------------------------

	this.playEmotion = function(emotionName, duration = 600) {
		let preset = EMOTIONS[emotionName];
		if (!preset) {
			console.warn('Unknown emotion: ' + emotionName);
			return;
		}

		this.currentEmotion = emotionName;
		this.duration = duration;
		this.startTime = millis();

		for (let name in this.controls) {
			// Start the tween from wherever the control currently is.
			this.from[name] = {x: this.current[name].x, y: this.current[name].y};
			let target = preset[name] || {x: 0, y: 0};
			this.to[name] = {x: target.x || 0, y: target.y || 0};
		}

		let headTarget = preset.head || {};
		this.headFrom = {tiltZ: this.headCurrent.tiltZ, turnY: this.headCurrent.turnY, nodX: this.headCurrent.nodX};
		this.headTo = {
			tiltZ: headTarget.tiltZ || 0,
			turnY: headTarget.turnY || 0,
			nodX: headTarget.nodX || 0
		};
	}

	this.update = function() {
		let t = this.duration > 0 ? constrain((millis() - this.startTime) / this.duration, 0, 1) : 1;
		let eased = 1 - Math.pow(1 - t, 3); // ease-out cubic

		this.updateBlink();
		this.updateSpeaking();

		for (let name in this.controls) {
			let control = this.controls[name];

			let cx = lerp(this.from[name].x, this.to[name].x, eased);
			let cy = lerp(this.from[name].y, this.to[name].y, eased);
			this.current[name] = {x: cx, y: cy};

			// Blink only affects the upper eyelids, and only closes them (subtracts).
			let blink = 0;
			if (name === 'upperLidL' || name === 'upperLidR') {
				blink = this.blinkAmount;
			}

			// Speaking drives jaw, both lips and mouth corners.
			// speakValue      → lower jaw + lower lip  (primary open movement)
			// speakValueUpper → upper lip              (slight phase offset from wsClient)
			let speakX = 0;
			let speakY = 0;
			if (this.speaking) {
				if (name === 'jaw') {
					speakY = -this.speakValue * 0.85;
				}
				if (name === 'lowerLips') {
					speakY = -this.speakValue * 0.55;
				}
				if (name === 'upperLips') {
					// Upper lip rises independently — feels like real articulation
					speakY = this.speakValueUpper * 0.50;
				}
				if (name === 'mouthCornerL') {
					// Corners stretch very slightly outward as mouth opens
					speakX =  this.speakValue * 0.18;
					speakY = -this.speakValue * 0.08;
				}
				if (name === 'mouthCornerR') {
					speakX = -this.speakValue * 0.18;
					speakY = -this.speakValue * 0.08;
				}
			}

			control.channelX = constrain(cx + speakX, -1, 1);
			control.channelY = constrain(cy - blink + speakY, -1, 1);
		}

		// --- Head pose (same eased t as the face controls) ---
		this.headCurrent.tiltZ = lerp(this.headFrom.tiltZ, this.headTo.tiltZ, eased);
		this.headCurrent.turnY = lerp(this.headFrom.turnY, this.headTo.turnY, eased);
		this.headCurrent.nodX = lerp(this.headFrom.nodX, this.headTo.nodX, eased);

		this.updateIdleSway();
		this.updateGesture();

		this.headRotation = {
			x: radians(this.headCurrent.nodX + this.idle.nodX + this.gestureOffset.nodX),
			y: radians(this.headCurrent.turnY + this.idle.turnY + this.gestureOffset.turnY),
			z: radians(this.headCurrent.tiltZ + this.idle.tiltZ)
		};
	}

	// --- Idle sway ---------------------------------------------------------------
	// Small continuous drift so the head never looks perfectly frozen, even at rest.

	this.idle = {tiltZ: 0, turnY: 0, nodX: 0};

	this.updateIdleSway = function() {
		let t = millis();
		this.idle.tiltZ = (noise(t * 0.00025) - 0.5) * 4;
		this.idle.turnY = (noise(t * 0.00035 + 100) - 0.5) * 14;
		this.idle.nodX = (noise(t * 0.0002 + 200) - 0.5) * 4;
	}

	// --- Gestures (nod = "yes", shake = "no") -------------------------------------
	// A quick decaying oscillation layered on top of everything else.

	this.gesture = null;
	this.gestureStart = 0;
	this.gestureDuration = 900;
	this.gestureAmplitude = 10;
	this.gestureCycles = 2;
	this.gestureOffset = {turnY: 0, nodX: 0};

	this.playGesture = function(type, duration = 900, amplitude = 10, cycles = 2) {
		this.gesture = type; // 'nod' or 'shake'
		this.gestureStart = millis();
		this.gestureDuration = duration;
		this.gestureAmplitude = amplitude;
		this.gestureCycles = cycles;
	}

	this.updateGesture = function() {
		this.gestureOffset = {turnY: 0, nodX: 0};

		if (!this.gesture) {
			return;
		}

		let elapsed = millis() - this.gestureStart;
		if (elapsed >= this.gestureDuration) {
			this.gesture = null;
			return;
		}

		let envelope = Math.sin(Math.PI * elapsed / this.gestureDuration); // 0 -> 1 -> 0
		let wave = Math.sin(elapsed * (this.gestureCycles * TWO_PI / this.gestureDuration)) * envelope * this.gestureAmplitude;

		if (this.gesture === 'nod') {
			this.gestureOffset.nodX = wave;
		} else if (this.gesture === 'shake') {
			this.gestureOffset.turnY = wave;
		}
	}

	// --- Blinking --------------------------------------------------------------

	this.blinkAmount = 0;
	this.blinking = false;
	this.blinkStart = 0;
	this.nextBlinkTime = 2000; // gets randomized once millis() is running (see main.js.js setup)

	this.scheduleNextBlink = function() {
		this.nextBlinkTime = millis() + random(2000, 5000);
	}

	this.updateBlink = function() {
		let now = millis();

		if (!this.blinking && now > this.nextBlinkTime) {
			this.blinking = true;
			this.blinkStart = now;
		}

		if (this.blinking) {
			let bt = (now - this.blinkStart) / 120; // 120ms per half (close/open)
			if (bt < 1) {
				this.blinkAmount = lerp(0, 1.2, bt);
			} else if (bt < 2) {
				this.blinkAmount = lerp(1.2, 0, bt - 1);
			} else {
				this.blinking = false;
				this.blinkAmount = 0;
				this.scheduleNextBlink();
			}
		}
	}

	// --- Speaking ----------------------------------------------------------------

	this.speaking = false;
	this.speakValue = 0;
	this.speakValueUpper = 0;          // upper lip — phase-offset from speakValue
	// Set to 0..1 from wsClient to drive jaw from the wave amplitude.
	// Set back to -1 to restore the internal Perlin-noise jaw jitter.
	this.externalSpeakValue = -1;
	this.externalSpeakValueUpper = -1; // upper lip channel from wsClient

	this.startSpeaking = function() {
		this.speaking = true;
	}

	this.stopSpeaking = function() {
		this.speaking = false;
		this.speakValue = 0;
		this.speakValueUpper = 0;
	}

	this.updateSpeaking = function() {
		if (this.speaking) {
			if (this.externalSpeakValue >= 0) {
				// Wave-driven jaw: synced to avatar wave bars from wsClient.js
				this.speakValue = constrain(this.externalSpeakValue, 0, 1);
			} else {
				// Fallback: internal Perlin-noise jaw jitter (keyboard mode)
				this.speakValue = constrain((noise(millis() * 0.008) - 0.3) * 1.4, 0, 1);
			}

			if (this.externalSpeakValueUpper >= 0) {
				// wsClient provides an independent upper-lip oscillator
				this.speakValueUpper = constrain(this.externalSpeakValueUpper, 0, 1);
			} else {
				// Fallback: offset Perlin so upper lip doesn't perfectly mirror jaw
				this.speakValueUpper = constrain((noise(millis() * 0.008 + 0.9) - 0.25) * 1.1, 0, 1);
			}
		}
	}
}