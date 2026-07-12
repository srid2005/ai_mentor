/*
Facial Rig

Ray character rig by CGTarian Online School (from Maya)

jasonlabbe3d.com
twitter.com/russetPotato
*/

const MODEL_HEIGHT = 40;

var canvas;
var myFont;
var drawEdges = false;
var controls = [];
var blendMeshes = {};
var emotionController;

var meshes = {
	normal: null,
	hair: null,
	brows: null,
	eyes: null,
	iris: null,
	pupils: null,

	head_jawUp: null,
	head_jawDown: null,
	head_jawLeft: null,
	head_jawRight: null,

	head_L_mouthCornerUp: null,
	head_L_mouthCornerDown: null,
	head_L_mouthCornerIn: null,
	head_L_mouthCornerOut: null,

	head_R_mouthCornerUp: null,
	head_R_mouthCornerDown: null,
	head_R_mouthCornerIn: null,
	head_R_mouthCornerOut: null,

	head_L_upperLidUp: null,
	head_L_upperLidDown: null,

	head_R_upperLidUp: null,
	head_R_upperLidDown: null,

	head_L_lowerLidUp: null,
	head_L_lowerLidDown: null,

	head_R_lowerLidUp: null,
	head_R_lowerLidDown: null,

	head_L_browUp: null,
	head_L_browDown: null,
	head_L_browIn: null,
	head_L_browOut: null,

	brows_L_browUp: null,
	brows_L_browDown: null,
	brows_L_browIn: null,
	brows_L_browOut: null,

	head_R_browUp: null,
	head_R_browDown: null,
	head_R_browIn: null,
	head_R_browOut: null,

	brows_R_browUp: null,
	brows_R_browDown: null,
	brows_R_browIn: null,
	brows_R_browOut: null,

	head_L_cheeksUp: null,
	head_L_cheeksDown: null,
	head_L_cheeksIn: null,
	head_L_cheeksOut: null,

	head_R_cheeksUp: null,
	head_R_cheeksDown: null,
	head_R_cheeksIn: null,
	head_R_cheeksOut: null,

	head_upperLipsUp: null,
	head_upperLipsDown: null,
	head_upperLipsLeft: null,
	head_upperLipsRight: null,

	head_lowerLipsUp: null,
	head_lowerLipsDown: null,
	head_lowerLipsLeft: null,
	head_lowerLipsRight: null
};

function preload() {
	myFont = loadFont('Roboto-Black.ttf');
	
	// Procedurally load in obj files.
	for (let name in meshes) {
		meshes[name] = loadModel(name + '.obj');
	}
}

function setup() {
	canvas = createCanvas(windowWidth, windowHeight, WEBGL);
	
	ortho(-width / 2, width / 2, -height / 2, height / 2, 0, 1000);
	
	background(50);
	textFont(myFont);
	
	// Determine which meshes will be blending to targets.
	blendMeshes.normal = new BlendMesh(meshes.normal);
	blendMeshes.brows = new BlendMesh(meshes.brows);
	
	// Create controls that will drive the mesh. Each one now carries a name
	// instead of a screen position, since nothing drags them by hand anymore.

	controls.push(new Control('jaw', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_jawUp,
			meshes.head_jawDown,
			meshes.head_jawLeft,
			meshes.head_jawRight
		)
	]));

	controls.push(new Control('mouthCornerL', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_L_mouthCornerUp,
			meshes.head_L_mouthCornerDown,
			meshes.head_L_mouthCornerOut,
			meshes.head_L_mouthCornerIn)
	]));

	controls.push(new Control('mouthCornerR', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_R_mouthCornerUp,
			meshes.head_R_mouthCornerDown,
			meshes.head_R_mouthCornerIn,
			meshes.head_R_mouthCornerOut
		)
	]));

	controls.push(new Control('upperLidL', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_L_upperLidUp,
			meshes.head_L_upperLidDown,
			null,
			null
		)
	]));

	controls.push(new Control('upperLidR', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_R_upperLidUp,
			meshes.head_R_upperLidDown,
			null,
			null
		)
	]));

	controls.push(new Control('lowerLidL', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_L_lowerLidUp,
			meshes.head_L_lowerLidDown,
			null,
			null
		)
	]));

	controls.push(new Control('lowerLidR', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_R_lowerLidUp,
			meshes.head_R_lowerLidDown,
			null,
			null
		)
	]));

	controls.push(new Control('browL', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_L_browUp,
			meshes.head_L_browDown,
			meshes.head_L_browOut,
			meshes.head_L_browIn
		),
		new TargetGroup(
			blendMeshes.brows,
			meshes.brows_L_browUp,
			meshes.brows_L_browDown,
			meshes.brows_L_browOut,
			meshes.brows_L_browIn
		)
	]));

	controls.push(new Control('browR', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_R_browUp,
			meshes.head_R_browDown,
			meshes.head_R_browOut,
			meshes.head_R_browIn
		),
		new TargetGroup(
			blendMeshes.brows,
			meshes.brows_R_browUp,
			meshes.brows_R_browDown,
			meshes.brows_R_browOut,
			meshes.brows_R_browIn
		)
	]));

	controls.push(new Control('cheekL', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_L_cheeksUp,
			meshes.head_L_cheeksDown,
			meshes.head_L_cheeksOut,
			meshes.head_L_cheeksIn
		)
	]));

	controls.push(new Control('cheekR', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_R_cheeksUp,
			meshes.head_R_cheeksDown,
			meshes.head_R_cheeksIn,
			meshes.head_R_cheeksOut
		)
	]));

	controls.push(new Control('upperLips', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_upperLipsUp,
			meshes.head_upperLipsDown,
			meshes.head_upperLipsLeft,
			meshes.head_upperLipsRight
		)
	]));

	controls.push(new Control('lowerLips', [
		new TargetGroup(
			blendMeshes.normal,
			meshes.head_lowerLipsUp,
			meshes.head_lowerLipsDown,
			meshes.head_lowerLipsLeft,
			meshes.head_lowerLipsRight
		)
	]));

	// Drives the controls toward named emotion presets instead of the mouse.
	emotionController = new EmotionController(controls);
	emotionController.scheduleNextBlink();
	emotionController.playEmotion('neutral', 0);
}

function draw() {
  background(50);
	
	strokeWeight(1);
	
	if (drawEdges) {
		stroke(25);
	} else {
		noStroke();
	}
	
	lights();
	
	fill(255);
	textAlign(CENTER);
	text(`
	Keys 1-9, 0 trigger emotions · s toggles speaking · y nods · n shakes head · space toggles edges
	Current emotion: ${emotionController.currentEmotion}${emotionController.speaking ? ' (speaking)' : ''}`,
			 0, height / 2 - 80);
	
	emotionController.update();
	
	push();
	translate(0, 50);
	scale(140);
	rotateX(radians(180) + emotionController.headRotation.x);
	rotateY(radians(180) + emotionController.headRotation.y);
	rotateZ(emotionController.headRotation.z);
	
	blendMeshToTargets();
	
	for (let blendMesh of Object.values(blendMeshes)) {
		blendMesh.refreshMesh();
	}
	
	displayMeshes();
	pop();
}

function displayMeshes() {
	ambientLight(50);
	directionalLight(80, 80, 80, -0.6, 0.55, -1);
	directionalLight(200, 50, 50, 0.2, -0.48, 0.5);
	
	ambientMaterial(180, 125, 110);
  model(blendMeshes.normal.mesh);
	
	ambientMaterial(75, 60, 50);
	model(blendMeshes.brows.mesh);
	model(meshes.hair);
	
	ambientMaterial(255, 255, 255);
	model(meshes.eyes);
	
	ambientMaterial(155, 208, 235);
	model(meshes.iris);
	
	ambientMaterial(0, 0, 0);
	model(meshes.pupils);
}

// Maps the verts to their targets based on the controls' offset.
function blendMeshToTargets() {
	for (let control of controls) {
		control.storeOutputs();
	}
	
	for (let blendMesh of Object.values(blendMeshes)) {
		for (let vertIndex = 0; vertIndex < blendMesh.mesh.vertices.length; vertIndex++) {
			// Reset vert to default pose.
			blendMesh.resetPoint(vertIndex);

			// Add on all deltas to verts.
			for (let control of controls) {
				for (let targetGroup of control.targetGroups) {
					if (blendMesh.mesh == targetGroup.blendMesh.mesh) {
						if (targetGroup.yawTarget != null) {
							targetGroup.blendMesh.addDelta(targetGroup.yawTarget, control.outputs.x, vertIndex);
						}

						if (targetGroup.pitchTarget != null) {
							targetGroup.blendMesh.addDelta(targetGroup.pitchTarget, control.outputs.y, vertIndex);
						}
					}
				}
			}
		}
	}
}

// Keys 1-9, 0 trigger emotions; 's' toggles speaking; space toggles wireframe edges.
const EMOTION_KEYS = {
	'1': 'neutral',
	'2': 'friendly',
	'3': 'listening',
	'4': 'thinking',
	'5': 'curious',
	'6': 'approving',
	'7': 'skeptical',
	'8': 'concerned',
	'9': 'surprised',
	'0': 'stern'
};

function keyPressed() {
	if (key === ' ') {
		drawEdges = !drawEdges;
	} else if (key.toLowerCase() === 's') {
		if (emotionController.speaking) {
			emotionController.stopSpeaking();
		} else {
			emotionController.startSpeaking();
		}
	} else if (key.toLowerCase() === 'y') {
		emotionController.playGesture('nod');
	} else if (key.toLowerCase() === 'n') {
		emotionController.playGesture('shake');
	} else if (EMOTION_KEYS[key]) {
		emotionController.playEmotion(EMOTION_KEYS[key], 500);
	}
}