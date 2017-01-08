/* global THREE */
/* global AR */
/* global POS */

import '../lib/MMDLoader.js';
import 'babel-polyfill';

// THREE.MMDLoader = MMDLoader;

const oldOnload = window.onload;

window.onload = function() {

    oldOnload && oldOnload();

    function videoDimensions(video) {
        // Ratio of the video's intrisic dimensions
        const videoRatio = video.videoWidth / video.videoHeight;
        // The width and height of the video element
        let width = video.offsetWidth;
        let height = video.offsetHeight;
        // The ratio of the element's width to its height
        const elementRatio = width / height;
        // If the video element is short and wide
        if(elementRatio > videoRatio) width = height * videoRatio;
        // It must be tall and thin, or exactly equal to the original ratio
        else height = width / videoRatio;
        return {
            width: width,
            height: height
        };
    }

    class JsArucoMarker {
        constructor() {
            this.canvasElement = document.createElement('canvas');
            this.context = this.canvasElement.getContext('2d');
            this.videoScaleDown = 2;
            this.modelSize = 15.0; // mm
        }

        detectMarkers(videoElement) {
            const {context, videoScaleDown, canvasElement} = this;
            // if no new image for videoElement do nothing
            if (videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA){
                return [];
            }
            canvasElement.width = videoElement.videoWidth / videoScaleDown;
            canvasElement.height = videoElement.videoHeight / videoScaleDown;

            context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
            const imageData = context.getImageData(0, 0, canvasElement.width, canvasElement.height);

            // detect markers
            const detector = new AR.Detector();
            const markers = detector.detect(imageData);

            // return the result
            return markers;
        }

        markerToObject3D(marker, object3d, videoElement) {
            const {canvasElement} = this;
            // convert corners coordinate - not sure why
            // marker.corners;
            const corners = [];
            for (const corner of marker.corners){
                corners.push({
                    x : corner.x - (canvasElement.width / 2),
                    y : (canvasElement.height / 2) - corner.y,
                });
            }
            // compute the pose from the canvas
            const posit = new POS.Posit(this.modelSize, canvasElement.width);
            const pose = posit.pose(corners);

            if( pose === null )	return;

            // Translate pose to THREE.Object3D
            const rotation = pose.bestRotation;
            const translation = pose.bestTranslation;

            let scaleDownX = 1;
            let scaleDownY = 1;
            const realSize = videoDimensions(videoElement);
            scaleDownX = videoElement.videoWidth / realSize.width;
            scaleDownY = videoElement.videoHeight / realSize.height;

            object3d.scale.x = this.modelSize / scaleDownX;
            object3d.scale.y = this.modelSize / scaleDownY;
            object3d.scale.z = this.modelSize / ((scaleDownX + scaleDownY) / 2);

            object3d.rotation.x = -Math.asin(-rotation[1][2]);
            object3d.rotation.y = -Math.atan2(rotation[0][2], rotation[2][2]);
            object3d.rotation.z =  Math.atan2(rotation[1][0], rotation[1][1]);

            object3d.position.x =  translation[0] / scaleDownX;
            object3d.position.y =  translation[1] / scaleDownY;
            object3d.position.z = -translation[2];
        }
    }

    // shim
    navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
    window.URL = window.URL || window.webkitURL;

    function webcamGrabbing() {
        // create video element
        const domElement = document.createElement('video');
        domElement.setAttribute('autoplay', true);

        domElement.style.zIndex = -1;
        domElement.style.position = 'absolute';
        domElement.style.top = '0px';
        domElement.style.left = '0px';
        domElement.style.width = '100%';
        domElement.style.height = '100%';

        // get the media sources
        MediaStreamTrack.getSources(sourceInfos => {
            // define getUserMedia() constraints
            const constraints = {
                video: true,
                audio: false,
            };
            // to mirror the video element when it isnt 'environment'

            // it it finds the videoSource 'environment', modify constraints.video
            for (const sourceInfo of sourceInfos) {
                if(sourceInfo.kind == 'video' && sourceInfo.facing == 'environment') {
                    constraints.video = {
                        optional: [{sourceId: sourceInfo.id}]
                    };
                }
            }

            // try to get user media
            navigator.getUserMedia( constraints, function(stream){
                domElement.src = URL.createObjectURL(stream);
            }, error => {
                alert('Cant getUserMedia()! due to ', error);
            });
        });

        return domElement;
    }

    // play
    const renderer	= new THREE.WebGLRenderer({
        antialias	: true,
        alpha		: true,
    });
    renderer.setSize( window.innerWidth, window.innerHeight );
    document.body.appendChild(renderer.domElement);


    // array of functions for the rendering loop
    let onRenderFcts = [];

    // init scene and camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(37, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.z = 0;

    let markerObject3D = new THREE.Object3D();
    scene.add(markerObject3D);

    // set 3 point lighting
    let object3d	= new THREE.AmbientLight(0x101010);
    object3d.name	= 'Ambient light';
    scene.add(object3d);

    object3d	= new THREE.DirectionalLight('white', 0.1*1.6);
    object3d.position.set(2.6,1,3).setLength(1);
    object3d.name	= 'Back light';
    scene.add(object3d);

    object3d = new THREE.DirectionalLight('white', 0.375*1.6);
    object3d.position.set(-2, -1, 0);
    object3d.name 	= 'Key light';
    scene.add(object3d);

    object3d	= new THREE.DirectionalLight('white', 0.8*1);
    object3d.position.set(3, 3, 2);
    object3d.name = 'Fill light';
    scene.add(object3d);

    function makePhongMaterials ( materials ) {
        const array = [];
        for (const material of materials){
            const m = new THREE.MeshPhongMaterial();
            m.copy(material);
            m.needsUpdate = true;
            array.push( m );
        }
        return new THREE.MultiMaterial( array );
    }

    const onProgress = xhr => {
        if ( xhr.lengthComputable ) {
            var percentComplete = xhr.loaded / xhr.total * 100;
            console.log( Math.round(percentComplete, 2) + '% downloaded' );
        }
    };

    const onError = () => {
        alert('Download Model Error');
    };

    const modelFile = 'https://cdn.rawgit.com/mrdoob/three.js/dev/examples/models/mmd/miku/miku_v2.pmd';
    const vmdFiles = [ 'https://cdn.rawgit.com/mrdoob/three.js/dev/examples/models/mmd/vmds/wavefile_v2.vmd' ];

    const helper = new THREE.MMDHelper();
    const loader = new THREE.MMDLoader();
    loader.load( modelFile, vmdFiles, function (object) {
        const mesh = object;
        mesh.scale.set(1,1,1).multiplyScalar(1/35);
        mesh.rotation.x = Math.PI/2;
        mesh.material = makePhongMaterials(mesh.material.materials);

        markerObject3D.add( mesh );

        // scene.add(mesh);
        for (const material of mesh.material.materials) {
            material.emissive.multiplyScalar(1);
        }
        helper.add(mesh);
        helper.setAnimation(mesh);

        onRenderFcts.push(function(now, delta){
            helper.animate(delta/1000);
        });

        // /*
        //  * Note: create CCDIKHelper after calling helper.setAnimation()
        //  */
        const ikHelper = new THREE.CCDIKHelper( mesh );
        ikHelper.visible = false;
        scene.add(ikHelper);
   }, onProgress, onError );

    // handle window resize
    window.addEventListener('resize', () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    }, false);


    // render the scene
    onRenderFcts.push(() => {
        renderer.render( scene, camera );
    });

    // run the rendering loop
    let previousTime = performance.now();
    requestAnimationFrame(function animate(now){
        requestAnimationFrame( animate );
        onRenderFcts.forEach(function(onRenderFct){
            onRenderFct(now, now - previousTime);
        });
        previousTime = now;
    });

    // init the marker recognition
    const jsArucoMarker	= new JsArucoMarker();

    // const videoGrabbing = new THREEx.WebcamGrabbing()
    const domElement = webcamGrabbing();

    document.body.appendChild(domElement);

    // process the image source with the marker recognition
    function reMark(){
        const markers	= jsArucoMarker.detectMarkers(domElement);
        const object3d	= markerObject3D;

        object3d.visible = false;
        // see if this.markerId has been found
        markers.forEach(function(marker){
            jsArucoMarker.markerToObject3D(marker, object3d, domElement);
            object3d.visible = true;
        });
    }

    onRenderFcts.push(reMark);
};
