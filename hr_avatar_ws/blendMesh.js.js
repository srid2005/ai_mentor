const GID = 'custom';

function BlendMesh(_sourceMesh) {
	this.mesh = _sourceMesh;
	this.restPose = JSON.parse(JSON.stringify(_sourceMesh.vertices));
	
	// Resets point back to its rest pose.
	this.resetPoint = function(vertIndex) {
		this.mesh.vertices[vertIndex].x = this.restPose[vertIndex].x;
		this.mesh.vertices[vertIndex].y = this.restPose[vertIndex].y;
		this.mesh.vertices[vertIndex].z = this.restPose[vertIndex].z;
	}
	
	// Native p5.js doesn't support vertices to update in the draw loop, so this is a workaround to force an update.
	this.refreshMesh = function() {
		this.mesh._edgesToVertices();
		
		canvas.createBuffers(GID, this.mesh);
		canvas.drawBuffers(GID);

		this.mesh.dirtyFlags['vertexNormals'] = true;
		this.mesh.dirtyFlags['lineVertices'] = true;
		this.mesh.dirtyFlags['vertices'] = true;
	}
	
	// Adds an offset to the supplied vertex.
	this.addDelta = function(targetMesh, blendValue, vertIndex) {
		let deltaX = targetMesh.vertices[vertIndex].x - this.restPose[vertIndex].x;
		let deltaY = targetMesh.vertices[vertIndex].y - this.restPose[vertIndex].y;
		let deltaZ = targetMesh.vertices[vertIndex].z - this.restPose[vertIndex].z;

		this.mesh.vertices[vertIndex].x += deltaX * blendValue;
		this.mesh.vertices[vertIndex].y += deltaY * blendValue;
		this.mesh.vertices[vertIndex].z += deltaZ * blendValue;
	}
}