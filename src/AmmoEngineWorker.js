'use strict';


importScripts('./AmmoEngineConfig.js');
importScripts('../lib/ammo.fast.js');


/********************************************
            Global Objects
 ********************************************/

function PhysicsObject(collisionObject, transform) {
    this.collisionObject = collisionObject || null;
    this.transform = transform || null;

    this.collisionStatus = [];

    this.isGhostObject = false;
    this.hasCallback = false;
}

var g_objectsList = [];
var g_shapes = {};
    
// Map to store the ammo objects which key is the ptr of body
var g_ammoPtrIdxMap = {};

// Init
var g_broadphase = new Ammo.btDbvtBroadphase();
var g_collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
var g_dispatcher = new Ammo.btCollisionDispatcher(g_collisionConfiguration);
var g_solver = new Ammo.btSequentialImpulseConstraintSolver();
var g_world = new Ammo.btDiscreteDynamicsWorld(g_dispatcher, g_broadphase, g_solver, g_collisionConfiguration);
var g_ghostPairCallback = null;


onmessage = function(e) {

    var buffer = new Float32Array(e.data);
    
    var nChunk = buffer[0];

    var offset = 1;
    for (var i = 0; i < nChunk; i++) {
        var cmdType = buffer[offset++];
        // Dispatch
        switch(cmdType) {
            case CMD_ADD_COLLIDER:
                offset = cmd_AddCollisionObject(buffer, offset);
                break;
            case CMD_REMOVE_COLLIDER:
                offset = cmd_RemoveCollisionObject(buffer, offset);
                break;
            case CMD_MOD_COLLIDER:
                offset = cmd_ModCollisionObject(buffer, offset);
                break;
            case CMD_STEP:
                cmd_Step(buffer[offset++], buffer[offset++], buffer[offset++]);
                break;
            default:
        }
    }
}

/********************************************
            Buffer Object
 ********************************************/

var g_buffer = {

    array : [],
    offset : 0,

    packScalar : function(scalar) {
        this.array[this.offset++] = scalar;
    },

    packVector2 : function(vector) {
        this.array[this.offset++] = vector.getX();
        this.array[this.offset++] = vector.getY();
    },

    packVector3 : function(vector) {
        this.array[this.offset++] = vector.getX();
        this.array[this.offset++] = vector.getY();
        this.array[this.offset++] = vector.getZ();
    },

    packVector4 : function(vector) {
        this.array[this.offset++] = vector.getX();
        this.array[this.offset++] = vector.getY();
        this.array[this.offset++] = vector.getZ();
        this.array[this.offset++] = vector.getW();
    },

    toFloat32Array : function() {
        this.array.length = this.offset;
        return new Float32Array(this.array);
    }
}

/********************************************
            Util Functions
 ********************************************/

function _unPackVector3(buffer, offset) {
    return new Ammo.btVector3(buffer[offset++], buffer[offset++], buffer[offset]);
}

function _setVector3(vec3, buffer, offset) {
    vec3.setX(buffer[offset++]);
    vec3.setY(buffer[offset++]);
    vec3.setZ(buffer[offset++]);
    return offset;
}

function _setVector4(vec4, buffer, offset) {
    vec4.setX(buffer[offset++]);
    vec4.setY(buffer[offset++]);
    vec4.setZ(buffer[offset++]);
    vec4.setW(buffer[offset++]);
    return offset++
}

function _createShape(buffer, offset) {
    // Shape
    var shapeId = buffer[offset++];
    var shapeType = buffer[offset++];
    var shape = g_shapes[shapeId];
    if (!shape) {
        switch(shapeType) {
            case SHAPE_SPHERE:
                shape = new Ammo.btSphereShape(buffer[offset++]);
                break;
            case SHAPE_BOX:
                shape = new Ammo.btBoxShape(_unPackVector3(buffer, offset));
                offset += 3;
                break;
            case SHAPE_CYLINDER:
                shape = new Ammo.btCylinderShape(_unPackVector3(buffer, offset));
                offset += 3;
                break;
            case SHAPE_CONE:
                shape = new Ammo.btConeShape(buffer[offset++], buffer[offset++]);
                break;
            case SHAPE_CAPSULE:
                shape = new Ammo.btCapsuleShape(buffer[offset++], buffer[offset++]);
                break;
            case SHAPE_CONVEX_TRIANGLE_MESH:
            case SHAPE_BVH_TRIANGLE_MESH:
                var nTriangles = buffer[offset++];
                var nVertices = buffer[offset++];
                var indexStride = 3 * 4;
                var vertexStride = 3 * 4;
                
                var triangleIndices = buffer.subarray(offset, offset + nTriangles * 3);
                offset += nTriangles * 3;
                var indicesPtr = Ammo.allocate(indexStride * nTriangles, 'i32', Ammo.ALLOC_NORMAL);
                for (var i = 0; i < triangleIndices.length; i++) {
                    Ammo.setValue(indicesPtr + i * 4, triangleIndices[i], 'i32');
                }

                var vertices = buffer.subarray(offset, offset + nVertices * 3);
                offset += nVertices * 3;
                var verticesPtr = Ammo.allocate(vertexStride * nVertices, 'float', Ammo.ALLOC_NORMAL);
                for (var i = 0; i < vertices.length; i++) {
                    Ammo.setValue(verticesPtr + i * 4, vertices[i], 'float');
                }

                var indexVertexArray = new Ammo.btTriangleIndexVertexArray(nTriangles, indicesPtr, indexStride, nVertices, verticesPtr, vertexStride);
                // TODO Cal AABB ?
                if (shapeType === SHAPE_CONVEX_TRIANGLE_MESH) {
                    shape = new Ammo.btConvexTriangleMeshShape(indexVertexArray, true);
                } else {
                    shape = new Ammo.btBvhTriangleMeshShape(indexVertexArray, true, true);
                }
                break;
            case SHAPE_CONVEX_HULL:
                var nPoints = buffer[offset++];
                var stride = 3 * 4;
                var points = buffer.subarray(offset, offset + nPoints * 3);
                offset += nPoints * 3;
                var pointsPtr = Ammo.allocate(stride * nPoints, 'float', Ammo.ALLOC_NORMAL);
                for (var i = 0; i < points.length; i++) {
                    Ammo.setValue(pointsPtr + i * 4, points[i], 'float');
                }

                shape = new btConvexHullShape(pointsPtr, nPoints, stride);
                break;
            case SHAPE_STATIC_PLANE:
                var normal = _unPackVector3(buffer, offset);
                offset+=3;
                shape = new Ammo.btStaticPlaneShape(normal, buffer[offset++]);
                break;
            default:
                throw new Error('Unknown type ' + shapeType);
                break;
        }

        g_shapes[shapeId] = shape;
    } else {
        if (shapeType === SHAPE_SPHERE) {
            offset += 1;
        } else if (shapeType === SHAPE_CONVEX_TRIANGLE_MESH) {
            // TODO
        } else {
            offset += 3;
        }
    }

    return [shape, offset];
}

/********************************************
                COMMANDS
 ********************************************/

function cmd_AddCollisionObject(buffer, offset) {
    var idx = buffer[offset++];
    var bitMask = buffer[offset++];

    var collisionFlags = buffer[offset++];
    var isGhostObject = COLLISION_FLAG_GHOST_OBJECT & collisionFlags;
    var hasCallback = COLLISION_FLAG_HAS_CALLBACK & collisionFlags;

    if (MOTION_STATE_MOD_BIT & bitMask) {
        var origin = new Ammo.btVector3(buffer[offset++], buffer[offset++], buffer[offset++]);
        var quat = new Ammo.btQuaternion(buffer[offset++], buffer[offset++], buffer[offset++], buffer[offset++]);
        var transform = new Ammo.btTransform(quat, origin);
    } else {
        var transform = new Ammo.btTransform();
    }

    if (!isGhostObject) {
        var motionState = new Ammo.btDefaultMotionState(transform);

        if (RIGID_BODY_PROP_MOD_BIT.linearVelocity & bitMask) {
            var linearVelocity = _unPackVector3(buffer, offset);
            offset += 3;
        }
        if (RIGID_BODY_PROP_MOD_BIT.angularVelocity & bitMask) {
            var angularVelocity = _unPackVector3(buffer, offset);
            offset += 3;
        }
        if (RIGID_BODY_PROP_MOD_BIT.linearFactor & bitMask) {
            var linearFactor = _unPackVector3(buffer, offset);
            offset += 3;
        }
        if (RIGID_BODY_PROP_MOD_BIT.angularFactor & bitMask) {
            var angularFactor = _unPackVector3(buffer, offset);
            offset += 3;
        }
        if (RIGID_BODY_PROP_MOD_BIT.centerOfMass & bitMask) {
            // TODO
            // centerOfMass = _unPackVector3(buffer, offset);
            offset += 3;
        }
        if (RIGID_BODY_PROP_MOD_BIT.localInertia & bitMask) {
            var localInertia = _unPackVector3(buffer, offset);
            offset += 3;
        }
        var mass = buffer[offset++];
    }

    var res = _createShape(buffer, offset);
    var shape = res[0];
    offset = res[1];

    if (!isGhostObject) {
        if (!localInertia) {
            localInertia = new Ammo.btVector3(0, 0, 0);
            if (mass !== 0) { // Is dynamic
                shape.calculateLocalInertia(mass, localInertia);
            }
        }
        var rigidBodyInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
        var rigidBody = new Ammo.btRigidBody(rigidBodyInfo);

        rigidBody.setCollisionFlags(collisionFlags);

        linearVelocity && rigidBody.setLinearVelocity(linearVelocity);
        angularVelocity && rigidBody.setAngularVelocity(angularVelocity);
        linearFactor && rigidBody.setLinearFactor(linearFactor);
        angularFactor && rigidBody.setAngularFactor(angularFactor);

        rigidBody.setFriction(buffer[offset++]);
        rigidBody.setRestitution(buffer[offset++]);

        var physicsObject = new PhysicsObject(rigidBody, transform);
        physicsObject.hasCallback = hasCallback;
        g_objectsList[idx] = physicsObject;
        g_ammoPtrIdxMap[rigidBody.ptr] = idx;

        g_world.addRigidBody(rigidBody);
    } else {
        // TODO Pair Caching Ghost Object ?
        var ghostObject = new Ammo.btGhostObject();
        ghostObject.setCollisionShape(shape);
        ghostObject.setWorldTransform(transform);

        var physicsObject = new PhysicsObject(ghostObject, transform);
        physicsObject.hasCallback = hasCallback;
        physicsObject.isGhostObject = true;
        g_objectsList[idx] = physicsObject;
        g_world.addCollisionObject(ghostObject);

        g_ammoPtrIdxMap[ghostObject.ptr] = idx;
        // TODO
        if (!g_ghostPairCallback) {
            g_ghostPairCallback = new Ammo.btGhostPairCallback();
            g_world.getPairCache().setInternalGhostPairCallback(g_ghostPairCallback);
        }
    }

    return offset;
}


// TODO destroy ?
function cmd_RemoveCollisionObject(buffer, offset) {
    var idx = buffer[offset++];
    var obj = g_objectsList[idx];
    g_objectsList[idx] = null;
    if (obj.isGhostObject) {
        g_world.removeCollisionObject(obj.collisionObject);
    } else {
        g_world.removeRigidBody(obj.collisionObject);
    }
    return offset;
}

function cmd_ModCollisionObject(buffer, offset) {
    var idx = buffer[offset++];
    var bitMask = buffer[offset++];

    var obj = g_objectsList[idx];
    var collisionObject = obj.collisionObject;

    if (COLLISION_FLAG_MOD_BIT & bitMask) {
        var collisionFlags = buffer[offset++];
        collisionObject.setCollisionFlags(collisionFlags);

        obj.hasCallback = collisionFlags & COLLISION_FLAG_HAS_CALLBACK;
        obj.isGhostObject = collisionFlags & COLLISION_FLAG_GHOST_OBJECT;
    }
    if (MOTION_STATE_MOD_BIT.position & bitMask) {
        var motionState = collisionObject.getMotionState();
        var transform = obj.transform;
        motionState.getWorldTransform(transform);
        offset = _setVector3(transform.getOrigin(), offset);
        offset = _setVector4(transform.getRotation(), offset);
        motionState.setWorldTransform(transform);
    }

    if (RIGID_BODY_PROP_MOD_BIT.linearVelocity & bitMask) {
        offset = _setVector3(collisionObject.getLinearVelocity(), offset);
    }
    if (RIGID_BODY_PROP_MOD_BIT.angularVelocity & bitMask) {
        offset = _setVector3(collisionObject.getAngularVelocity(), offset);
    }
    if (RIGID_BODY_PROP_MOD_BIT.linearFactor & bitMask) {
        offset = _setVector3(collisionObject.getLinearFactor(), offset);
    }
    if (RIGID_BODY_PROP_MOD_BIT.angularFactor & bitMask) {
        offset = _setVector3(collisionObject.getAngularFactor(), offset);
    }
    if (RIGID_BODY_PROP_MOD_BIT.centerOfMass & bitMask) {
        // TODO
        offset += 3;
    }
    if (RIGID_BODY_PROP_MOD_BIT.localInertia & bitMask) {
        // TODO
        offset += 3;
    }
    // TODO
    var mass = buffer[offset++];
    // Shape
    if (SHAPE_MOD_BIT & bitMask) {
        var res = _createShape(buffer, offset);
        var shape = res[0];
        offset = res[1];
        collisionObject.setCollisionShape(shape);
    }
    if (MATERIAL_MOD_BIT & bitMask) {
        collisionObject.setFriction(buffer[offset++]);
        collisionObject.setRestitution(buffer[offset++]);
    }
 
    return offset;
}

function cmd_Step(timeStep, maxSubSteps, fixedTimeStep) {

    var startTime = new Date().getTime();
    g_world.stepSimulation(timeStep, maxSubSteps, fixedTimeStep);
    var stepTime = new Date().getTime() - startTime;

    var nChunk = 3;
    g_buffer.offset = 0;
    g_buffer.packScalar(nChunk);

    // Sync Motion State
    g_buffer.packScalar(CMD_SYNC_MOTION_STATE);
    var nObjects = 0;
    var nObjectsOffset = g_buffer.offset;
    g_buffer.packScalar(nObjects);

    for (var i = 0; i < g_objectsList.length; i++) {
        var obj = g_objectsList[i];
        if (!obj) {
            continue;
        }
        var collisionObject = obj.collisionObject;
        if (collisionObject.isStaticOrKinematicObject()) {
            continue;
        }
        // Idx
        g_buffer.packScalar(i);
        var motionState = collisionObject.getMotionState();
        motionState.getWorldTransform(obj.transform);

        g_buffer.packVector3(obj.transform.getOrigin());
        g_buffer.packVector4(obj.transform.getRotation());
        nObjects++;
    }
    g_buffer.array[nObjectsOffset] = nObjects;

    // Return step time
    g_buffer.packScalar(CMD_STEP_TIME);
    g_buffer.packScalar(stepTime);

    // Tick callback
    _tickCallback(g_world);

    var array = g_buffer.toFloat32Array();

    postMessage(array.buffer, [array.buffer]);
}

// nmanifolds - [idxA - idxB - ncontacts - [pA - pB - normal]... ]...
function _tickCallback(world) {

    g_buffer.packScalar(CMD_COLLISION_CALLBACK);

    var nManifolds = g_dispatcher.getNumManifolds();
    var nCollision = 0;
    var tickCmdOffset = g_buffer.offset;
    g_buffer.packScalar(0);  //nManifolds place holder

    for (var i = 0; i < nManifolds; i++) {
        var contactManifold = g_dispatcher.getManifoldByIndexInternal(i);
        var obAPtr = contactManifold.getBody0();
        var obBPtr = contactManifold.getBody1();

        var nContacts = contactManifold.getNumContacts();

        if (nContacts > 0) {
            var obAIdx = g_ammoPtrIdxMap[obAPtr];
            var obBIdx = g_ammoPtrIdxMap[obBPtr];

            var obA = g_objectsList[obAIdx];
            var obB = g_objectsList[obBIdx];

            if (obA.hasCallback || obB.hasCallback) {
                var nActualContacts = 0;
                var chunkStartOffset = g_buffer.offset;
                // place holder for idxA, idxB, idxC
                g_buffer.offset += 3;
                var isCollided = false;
                for (var j = 0; j < nContacts; j++) {
                    var cp = contactManifold.getContactPoint(j);

                    if (cp.getDistance() <= 0) {
                        var pA = cp.getPositionWorldOnA();
                        var pB = cp.getPositionWorldOnB();
                        var normal = cp.get_m_normalWorldOnB();

                        g_buffer.packVector3(pA);
                        g_buffer.packVector3(pB);
                        g_buffer.packVector3(normal);
                        nActualContacts++;

                        isCollided = true;
                    }
                }

                if (isCollided) {
                    g_buffer.array[chunkStartOffset] = obAIdx;
                    g_buffer.array[chunkStartOffset+1] = obBIdx;
                    g_buffer.array[chunkStartOffset+2] = nActualContacts;
                    nCollision++;
                } else {
                    g_buffer.offset -= 3;
                }
            }
        }
    }

    g_buffer.array[tickCmdOffset] = nCollision;
}