// jsmpeg by Dominic Szablewski - phoboslab.org, github.com/phoboslab

(function(window){ "use strict";
 
var	SOCKET_MAGIC_BYTES_h264 = 'h264'; 
var	SOCKET_MAGIC_BYTES_hevc = 'hevc'; 
let sequenceStarted2 = false;
let sequenceStarted = false;
//======================================
var canvas = document.getElementById('videoCanvas');
var pictureCount = 0;
var lastPictureCount = 0;
// Create the decoder and canvas
var decoder = null;  //new Worker('h265bsd_worker.js');
var codec = 0; // 0 = h264, 1 = hevc
// var decoder = new Worker('h264bsd_worker.min.js');
var display = new H264bsdCanvas(canvas);	
var buf = null;
//======================================
	
// Input

var mouseLock = !!document.location.href.match('mouselock');
var lastMouse = {x: 0, y: 0};
if( mouseLock ) {
	// FUCK YEAH, VENDOR PREFIXES. LOVE EM!
	canvas.requestPointerLock = canvas.requestPointerLock ||
		canvas.mozRequestPointerLock || 
		canvas.webkitRequestPointerLock || 
		(function(){});
}

// enum input_type_t
var INPUT_KEY = 0x0001,
	INPUT_MOUSE_BUTTON = 0x0002,
	INPUT_MOUSE_ABSOLUTE = 0x0004,
	INPUT_MOUSE_RELATIVE = 0x0008;

var KEY_DOWN = 0x01,
	KEY_UP = 0x00,
	MOUSE_1_DOWN = 0x0002,
	MOUSE_1_UP = 0x0004,
	MOUSE_2_DOWN = 0x0008,
	MOUSE_2_UP = 0x0010;

// struct input_key_t { uint16 type, uint16 state; uint16 key_code; }
var sendKey = function(ev, action, key) {
	client.send(new Uint16Array([INPUT_KEY, action, key]));
	ev.preventDefault();
};

// struct input_mouse_t { uint16 type, uint16 flags; float32 x; float32 y; }
var mouseDataBuffer = new ArrayBuffer(12);
var mouseDataTypeFlags = new Uint16Array(mouseDataBuffer, 0);
var mouseDataCoords = new Float32Array(mouseDataBuffer, 4);

var sendMouse = function(ev, action) {
	var type = 0;
	var x, y;

	if( action ) {
		type |= INPUT_MOUSE_BUTTON;
		
		// Attempt to lock pointer at mouse1 down
		if( mouseLock && action === MOUSE_1_DOWN ) {
			canvas.requestPointerLock();
		}
	}
	
	// Only make relative mouse movements if no button is pressed
	if( !action && mouseLock ) {
		type |= INPUT_MOUSE_RELATIVE;
		
		var p = ev.changedTouches ? ev.changedTouches[0] : ev;
		
		// FUCK, DID I MENTION I LOOOOOVE VENDOR PREFIXES? SO USEFUL!
		x = p.movementX || p.mozMovementX || p.webkitMovementX;
		y = p.movementY || p.mozMovementY || p.webkitMovementY;

		if( typeof x === 'undefined' ) {
			x = p.clientX - lastMouse.x;
			y = p.clientY - lastMouse.y;
		}

		lastMouse.x = p.clientX;
		lastMouse.y = p.clientY;
	}

	// If we send absoulte mouse coords, we can always do so, even for
	// button presses.
	if( !mouseLock ) {
		type |= INPUT_MOUSE_ABSOLUTE;
		
		var rect = canvas.getBoundingClientRect();
		var scaleX = canvas.width / (rect.right-rect.left),
			scaleY = canvas.height / (rect.bottom-rect.top);
		
		var p = ev.changedTouches ? ev.changedTouches[0] : ev;
		var x = (p.clientX - rect.left) * scaleX,
			y = (p.clientY - rect.top) * scaleY;
	}

	mouseDataTypeFlags[0] = type;
	mouseDataTypeFlags[1] = (action||0);
	mouseDataCoords[0] = x;
	mouseDataCoords[1] = y;
	
	client.send(mouseDataBuffer);
	ev.preventDefault();
};


// Keyboard
window.addEventListener('keydown', function(ev) { sendKey(ev, KEY_DOWN, ev.keyCode); }, false );
window.addEventListener('keyup', function(ev) { sendKey(ev, KEY_UP, ev.keyCode); }, false );

// Mouse
canvas.addEventListener('mousemove', function(ev){ sendMouse(ev, null); }, false);
canvas.addEventListener('mousedown', function(ev){ sendMouse(ev, ev.button == 2 ? MOUSE_2_DOWN : MOUSE_1_DOWN); }, false);
canvas.addEventListener('mouseup', function(ev){ sendMouse(ev, ev.button == 2 ? MOUSE_2_UP : MOUSE_1_UP); }, false);

// Touch
canvas.addEventListener('touchstart', function(ev){
	lastMouse.x = ev.changedTouches[0].clientX;
	lastMouse.y = ev.changedTouches[0].clientY;
	sendMouse(ev, MOUSE_1_DOWN);
}, false);
canvas.addEventListener('touchend', function(ev){ sendMouse(ev, MOUSE_1_UP); }, false);
canvas.addEventListener('touchmove', function(ev){ sendMouse(ev, null); }, false);

// Touch buttons emulating keyboard keys
var defineTouchButton = function( element, keyCode ) {
	element.addEventListener('touchstart', function(ev){ sendKey(ev, KEY_DOWN, keyCode); }, false);
	element.addEventListener('touchend', function(ev){ sendKey(ev, KEY_UP, keyCode); }, false);
};

var touchKeys = document.querySelectorAll('.key');
for( var i = 0; i < touchKeys.length; i++ ) {
	defineTouchButton(touchKeys[i], touchKeys[i].dataset.code);
}

var js264 = window.js264 = function( url, opts ) {
	console.log('JS: ', 'jsvmpp = window.jsvmpp');
	opts = opts || {}; 
	this.canvas = opts.canvas || document.createElement('canvas'); 
	if( url instanceof WebSocket ) {
		this.client = url;
		this.client.onopen = this.initSocketClient.bind(this);		
	} 
	else {
		this.load(url);
	}	
}; 
// ----------------------------------------------------------------------------
// Streaming over WebSockets
js264.prototype.waitForIntraFrame = true;
js264.prototype.socketBufferSize = 5 * 512 * 1024; // 512kb each

js264.prototype.initSocketClient = function( client ) {
	this.client.binaryType = 'arraybuffer';
	this.client.onmessage = this.receiveSocketMessage.bind(this);
};

js264.prototype.decodeSocketHeader = function( data ) {
	// Custom header sent to all newly connected clients when streaming
	// over websockets:
	decoder = new Worker('../js264/h264bsd_worker.js');
	codec = 0;
	this.width = (data[4] * 256 + data[5]);
	this.height = (data[6] * 256 + data[7]);
	
	if( sequenceStarted ) { return; }
	sequenceStarted = true;

	console.log('JJ codec:',codec, this.width,this.height); 
	// struct { char magic[4] = "jsmp"; unsigned short width, height; };
	// if( 
	// 	data[0] == SOCKET_MAGIC_BYTES_hevc.charCodeAt(0) && 
	// 	data[1] == SOCKET_MAGIC_BYTES_hevc.charCodeAt(1) && 
	// 	data[2] == SOCKET_MAGIC_BYTES_hevc.charCodeAt(2) && 
	// 	data[3] == SOCKET_MAGIC_BYTES_hevc.charCodeAt(3)
	// ) {
	// 	decoder = new Worker('../js265/h265bsd_worker.js');
	// 	codec = 1;
	// 	this.width = (data[4] * 256 + data[5]);
	// 	this.height = (data[6] * 256 + data[7]);
	 
	// 	if( sequenceStarted ) { return; }
	//     sequenceStarted = true;
	
	// 	console.log('JJ codec:', codec, 'width:', this.width, 'height:',this.height); 
	// } else if( 
	// 	data[0] == SOCKET_MAGIC_BYTES_h264.charCodeAt(0) && 
	// 	data[1] == SOCKET_MAGIC_BYTES_h264.charCodeAt(1) && 
	// 	data[2] == SOCKET_MAGIC_BYTES_h264.charCodeAt(2) && 
	// 	data[3] == SOCKET_MAGIC_BYTES_h264.charCodeAt(3)
	// ) {
	// 	decoder = new Worker('../js264/h264bsd_worker.js');
	// 	codec = 0;
	// 	this.width = (data[4] * 256 + data[5]);
	// 	this.height = (data[6] * 256 + data[7]);
	 
	// 	if( sequenceStarted ) { return; }
	//     sequenceStarted = true;
	
	// 	console.log('JJ codec:',codec, this.width,this.height); 
	// } else {
	// 	console.log('Invalid magic bytes: ', data[0], data[1], data[2], data[3]);
	// 	return;
	// }
	
//======================================
    decoder.addEventListener('error', function(e) {
        console.log('Decoder error', e);
    })

    decoder.addEventListener('message', function(e) {
        var message = e.data;
        if (!message.hasOwnProperty('type')) return;

        switch(message.type) {
        case 'pictureParams':
			console.log('pictureParams ready'); 
            var croppingParams = message.croppingParams;   
            if(croppingParams === null) {
                canvas.width = message.width;
                canvas.height = message.height; 
            } else {
                canvas.width = croppingParams.width;
                canvas.height = croppingParams.height;	 
            }
			// console.log("canvas.width", canvas.width, "canvas.height", canvas.height)
            break;
        case 'noInput':
            var copy = new Uint8Array(buf);
            decoder.postMessage({
                'type' : 'queueInput',
                'data' : copy.buffer
            }, [copy.buffer]);
            break;
        case 'pictureReady':
            display.drawNextOutputPicture(
                message.width, 
                message.height, 
                message.croppingParams, 
                new Uint8Array(message.data));
                ++pictureCount;
            break;
        case 'decoderReady':
            console.log('Decoder ready');
            break;
		default:
			console.log('JS: ', message.type);
			sequenceStarted = false;
			sequenceStarted2 = false;
        }
    });
//======================================	
}; 

js264.prototype.receiveSocketMessage = function( event ) {
	buf = new Uint8Array(event.data);
	console.log(buf[0], buf[1], buf[2], buf[3], buf[4], sequenceStarted, sequenceStarted2)
	if( !sequenceStarted ) {
		this.decodeSocketHeader(buf);
		return;
	} 
//======================================	
	if( !sequenceStarted2 && buf[0] === 0x00 &&
		buf[1] === 0x00 && buf[2] === 0x00 && buf[3] === 0x01 )  {  
			console.log("this.sequenceStarted2 =", sequenceStarted2);
			if ((codec == 0 && ( buf[4] == 0x27 || buf[4] == 0x67 )) || (codec == 1 && buf[4] == 0x40)) {
				sequenceStarted2 = true; 
				console.log('JxJ ',buf.length , buf[0],buf[1],buf[2],buf[3],buf[4] ); 
			}
    }
  
    if( sequenceStarted2 ) {
        var copy = new Uint8Array(buf)                
        decoder.postMessage(
           {'type' : 'queueInput', 'data' : copy.buffer}, 
           [copy.buffer]);
 
    }   
//======================================	 
};  
	
})(window);
