// Identifies targets that the blend mesh can lerp to.
function TargetGroup(_blendMesh, _upTarget, _downTarget, _leftTarget, _rightTarget) {
	this.blendMesh = _blendMesh;
	this.upTarget = _upTarget;
	this.downTarget = _downTarget;
	this.leftTarget = _leftTarget;
	this.rightTarget = _rightTarget;
	this.yawTarget = null;
	this.pitchTarget = null;
}