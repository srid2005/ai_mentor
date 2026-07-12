/*
Emotion presets for the interviewer avatar.

Each entry maps control name -> {x, y}, where x/y are in -1..1.
Any control not mentioned for a given emotion is assumed to be 0
(back to rest pose). Tune these numbers by watching the model —
they're starting points, not exact science.

Control names available (see main.js.js):
  jaw, mouthCornerL, mouthCornerR,
  upperLidL, upperLidR, lowerLidL, lowerLidR,
  browL, browR, cheekL, cheekR,
  upperLips, lowerLips
*/

const EMOTIONS = {

	neutral: {},

	friendly: {
		head: {nodX: -3},
		mouthCornerL: {y: 0.6},
		mouthCornerR: {y: 0.6},
		cheekL:       {y: 0.4},
		cheekR:       {y: 0.4},
		browL:        {y: 0.15},
		browR:        {y: 0.15}
	},

	listening: {
		head: {tiltZ: 4},
		browL:        {y: 0.1},
		browR:        {y: 0.1},
		mouthCornerL: {y: 0.1},
		mouthCornerR: {y: 0.1}
	},

	thinking: {
		head: {tiltZ: -8, turnY: -12},
		browL:        {y: -0.3, x: 0.3},
		browR:        {y: -0.3, x: 0.3},
		mouthCornerL: {x: 0.4},
		mouthCornerR: {y: -0.15},
		jaw:          {x: 0.2},
		upperLidL:    {y: -0.2},
		upperLidR:    {y: -0.2}
	},

	curious: {
		head: {tiltZ: 10, turnY: 6},
		browL:        {y: 0.7},
		browR:        {y: -0.1},
		mouthCornerL: {y: 0.1},
		mouthCornerR: {y: 0.1}
	},

	approving: {
		head: {nodX: 4},
		mouthCornerL: {y: 0.8},
		mouthCornerR: {y: 0.8},
		cheekL:       {y: 0.6},
		cheekR:       {y: 0.6},
		browL:        {y: 0.2},
		browR:        {y: 0.2},
		upperLidL:    {y: -0.15},
		upperLidR:    {y: -0.15}
	},

	skeptical: {
		head: {tiltZ: 6, turnY: -5},
		browL:        {y: 0.6},
		browR:        {y: -0.4},
		mouthCornerL: {x: 0.5},
		mouthCornerR: {y: -0.2},
		upperLidL:    {y: -0.2},
		upperLidR:    {y: -0.2}
	},

	concerned: {
		head: {nodX: 5},
		browL:        {y: -0.4, x: 0.5},
		browR:        {y: -0.4, x: 0.5},
		mouthCornerL: {y: -0.3},
		mouthCornerR: {y: -0.3}
	},

	surprised: {
		head: {nodX: -7},
		browL:     {y: 1.0},
		browR:     {y: 1.0},
		upperLidL: {y: 1.0},
		upperLidR: {y: 1.0},
		jaw:       {y: -0.5}
	},

	stern: {
		head: {nodX: 3},
		browL:        {y: -0.6},
		browR:        {y: -0.6},
		mouthCornerL: {y: -0.2},
		mouthCornerR: {y: -0.2},
		cheekL:       {x: -0.3},
		cheekR:       {x: -0.3}
	},

	encouraging: {
		head: {tiltZ: -3, nodX: -2},
		mouthCornerL: {y: 0.4},
		mouthCornerR: {y: 0.4},
		browL:        {y: 0.2},
		browR:        {y: 0.2},
		upperLidL:    {y: -0.1},
		upperLidR:    {y: -0.1}
	}

};
