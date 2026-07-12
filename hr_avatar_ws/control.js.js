/*
Control (rewritten)

Originally a mouse-draggable point. Now it's just a named channel pair
(channelX, channelY), each ranging -1..1, that something else (the
EmotionController) sets every frame. storeOutputs() still does the same
job it always did: pick which target (up/down/left/right) each
TargetGroup should blend to, and how far (0..1).
*/

function Control(_name, _targetGroups) {
	this.name = _name;
	this.targetGroups = _targetGroups;

	// -1..1. Sign picks the target (e.g. + = up/right), magnitude picks blend amount.
	this.channelX = 0;
	this.channelY = 0;

	this.outputs = {x: 0, y: 0};

	// Calculates lerp values and targets to use for later (same contract as before).
	this.storeOutputs = function() {
		this.outputs.x = Math.abs(this.channelX);
		this.outputs.y = Math.abs(this.channelY);

		for (let targetGroup of this.targetGroups) {
			if (targetGroup.leftTarget != null && targetGroup.rightTarget != null) {
				targetGroup.yawTarget = this.channelX >= 0 ? targetGroup.rightTarget : targetGroup.leftTarget;
			}

			if (targetGroup.upTarget != null && targetGroup.downTarget != null) {
				targetGroup.pitchTarget = this.channelY >= 0 ? targetGroup.upTarget : targetGroup.downTarget;
			}
		}
	}
}
