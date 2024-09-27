self.Module = {
    onRuntimeInitialized: function () {
        onWasmLoaded();
    }
};
self.importScripts('wasm_noQSBP/libffmpeg_264.js');

// window = this;
var noParams = true;
var LOG_LEVEL_WASM = 1;
var DECODER_H264 = 0;
var DECODER_H265 = 1;
var decoder_type = DECODER_H265;
var totalSize = 0;
var CHUNK_SIZE = 4096;
var pts = 0
var IDR_comed = false;

function onMessage(e) {
    var message = e.data;
    // var buf = new Uint8Array(message.data);
    var buf = new Uint8Array(message.data);
    var size = buf.length;
    if (!IDR_comed && size <= 6556) {
        console.log("IDR is not come yet, ignore this frame")
        return;
    } else IDR_comed = true;
    
    totalSize += size;

    var dataLength = size;
    var offset = 0;

    switch (message.type) {
        case 'queueInput':
            // console.log("[" + (pts) + "] Read len = ", size + ", Total size = " + totalSize)
            if (dataLength > CHUNK_SIZE) {
                do {
                    let len = Math.min(CHUNK_SIZE, dataLength);
                    var data = buf.buffer.slice(offset, offset + len);
                    var typedArray = new Uint8Array(data);
                    dataLength -= len;
                    offset += len;

                    var cacheBuffer = Module._malloc(len);
                    Module.HEAPU8.set(typedArray, cacheBuffer);
                    // console.log("[" + (pts) + "] Read len = ", len + ", Total size = " + totalSize)

                    Module._decodeData(cacheBuffer, len, pts++)
                    if (cacheBuffer != null) {
                        Module._free(cacheBuffer);
                        cacheBuffer = null;
                    }
                    
                } while (dataLength > 0)
            } else {
                var cacheBuffer = Module._malloc(size);
                Module.HEAPU8.set(buf, cacheBuffer);

                Module._decodeData(cacheBuffer, size, pts++)
                if (cacheBuffer != null) {
                    Module._free(cacheBuffer);
                    cacheBuffer = null;
                }
            }
            
            break;
        default:
            console.log('onMessage:unknown message type', message.type);
    }
}

function setDecoder(type) {
    decoder_type = type;
}

function initFinish() {
    console.log("init start");
    var videoSize = 0;
    var videoCallback = Module.addFunction(function (addr_y, addr_u, addr_v, stride_y, stride_u, stride_v, width, height, pts) {
        // console.log("[%d]In video callback, size = %d * %d, pts = %d", ++videoSize, width, height, pts)
        let size = width * height + width * height / 2
        // console.log("======> One Frame ");
        // console.log("======> ======> width, height, pts", width, height, pts);
        // console.log("======> ======> Y ", stride_y, addr_y);
        // console.log("======> ======> U ", stride_u, addr_u);
        // console.log("======> ======> V ", stride_v, addr_v);
        var croppingParams = { width: width, height: height, top: 0, left: 0 };
        let data = new Uint8Array(size);
        let pos = 0;
        for(let i=0; i< height; i++) {
            let src = addr_y + i * stride_y
            let tmp = HEAPU8.subarray(src, src + width)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        for(let i=0; i< height / 2; i++) {
            let src = addr_u + i * stride_u
            let tmp = HEAPU8.subarray(src, src + width / 2)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        for(let i=0; i< height / 2; i++) {
            let src = addr_v + i * stride_v
            let tmp = HEAPU8.subarray(src, src + width / 2)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }

        if (noParams) {
            postMessage({
                'type': 'pictureParams',
                'width': width,
                'height': height,
                'croppingParams': croppingParams,
            });
            noParams = false;
        };
        postMessage({
            'type': 'pictureReady',
            'width': width,
            'height': height,
            'croppingParams': croppingParams,
            'data': data.buffer,
        }, [data.buffer]);
    }, 'viiiiiiiii');
    var ret = Module._openDecoder(decoder_type, videoCallback, LOG_LEVEL_WASM);
    if(ret == 0) {
        console.log("openDecoder success");
    } else {
        console.error("openDecoder failed with error", ret);
        return;
    }
};

function onWasmLoaded() {
    console.log("Wasm Loaded");
    setDecoder(0);
    initFinish();
    addEventListener('message', onMessage);
    postMessage({ 'type': 'decoderReady' });
   
}
