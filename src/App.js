import React, { useEffect, useState } from 'react';
import logo from './logo.svg';
import './App.css';
import { Janus } from 'janus-gateway';


const serverConfig = {
    server: ['ws://0.0.0.0:8188/', 'https://0.0.0.0:8089/janus'],

}
let sfutest = null;
let myroom = 2342;	// Demo room
let myusername = null;
let myid = null;
let mystream = null;
let janus = null;
// We use this other ID just to map our subscriptions to us
let mypvtid = null;
let opaqueId = "videoroomtest-" + Janus.randomString(12);
let feeds = [];
let roomCapacity = 25
const server = ['http://54.205.91.58:8088/janus'];

const iceServers = [
    {
        urls: 'stun:stun.l.google.com:19302',
    },
    {
        urls: 'turn:numb.viagenie.ca',
        username: 'admin@tico.com',
        credential: 'tico2019',
    }
    , {
        urls: 'stun:stun.xten.com',
    }
];

function App() {
    const [localStream, setLocalStream] = useState(undefined)
    const [remoteList, setRemoteList] = useState({})
    const [temp, setTemp] = useState(false)
    useEffect(() => {
        Janus.init({
            debug: true,
            dependencies: Janus.useDefaultDependencies(), // or: Janus.useOldDependencies() to get the behaviour of previous Janus versions
            callback: function () {
                console.log("init success")
            }
        });
        attachFun();
    }, [])


    const attachFun = () => {
        if (!Janus.isWebrtcSupported()) {
            alert("No WebRTC support... ");
            return;
        }
        janus = new Janus(
            {
                server,
                iceServers,
                success: function () {
                    // Attach to VideoRoom plugin
                    janus.attach(
                        {
                            plugin: "janus.plugin.videoroom",
                            opaqueId: opaqueId,
                            success: (pluginHandle) => {

                                sfutest = pluginHandle;
                                const register = {
                                    request: "join",
                                    room: myroom,
                                    ptype: "publisher",
                                    display: "Johnson"
                                };
                                sfutest.send({ message: register });
                                // console.log("videoroom successfully")
                            },
                            error: (error) => {
                                Janus.error(" -- Error attaching plugin...", error);
                                // bootbox.alert("Error attaching plugin... " + error);
                            },
                            onmessage: function (msg, jsep) {
                                Janus.debug(" ::: Got a message (publisher) :::", msg);
                                const event = msg["videoroom"];
                                Janus.debug("Event: " + event);
                                if (event) {
                                    switch (event) {
                                        case "joined":
                                            myid = msg["id"];
                                            mypvtid = msg["private_id"];
                                            Janus.log("Successfully joined room " + msg["room"] + " with ID " + myid);
                                            const configuration = {
                                                // Add data:true here if you want to publish datachannels as well
                                                media: {
                                                    audioRecv: false,
                                                    videoRecv: false,
                                                    audioSend: true,
                                                    videoSend: true
                                                },
                                                simulcast: true,
                                                simulcast2: true,
                                                success: (jsep) => {
                                                    Janus.debug("Got publisher SDP!", jsep);
                                                    const publish = {
                                                        request: "configure",
                                                        audio: true,
                                                        video: true
                                                    };
                                                    sfutest.send({ message: publish, jsep: jsep });
                                                },
                                                error: (error) => {
                                                    Janus.error("WebRTC error:", error);
                                                }
                                            }
                                            sfutest.createOffer(configuration);
                                            // Any new feed to attach to?
                                            if (msg["publishers"]) {
                                                const list = msg["publishers"];
                                                Janus.debug("Got a list of available publishers/feeds:", list);
                                                for (const f in list) {
                                                    const id = list[f]["id"];
                                                    const display = list[f]["display"];
                                                    const audio = list[f]["audio_codec"];
                                                    const video = list[f]["video_codec"];
                                                    // Janus.debug("  >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
                                                    newRemoteFeed(id, display, audio, video);
                                                }
                                            }
                                            break;
                                        case "destroyed":
                                            Janus.warn("The room has been destroyed!");
                                            break;
                                        case "event":
                                            Janus.warn("The room has been destroyed!");
                                            const { publishers, leaving, unpublished } = msg
                                            // Any new feed to attach to?
                                            if (publishers) {
                                                Janus.debug("Got a list of available publishers/feeds:", publishers);
                                                for (const item in publishers) {
                                                    const { id, display, audio_codec, video_codec } = publishers[item]
                                                    newRemoteFeed(id, display, audio_codec, video_codec);
                                                }
                                            } else if (leaving) {
                                                // One of the publishers has gone away?
                                                Janus.log("Publisher left: " + leaving);
                                                let remoteFeed = null;
                                                for (let i = 1; i < roomCapacity; i++) {
                                                    if (feeds[i] && feeds[i].rfid === leaving) {
                                                        remoteFeed = feeds[i];
                                                        break;
                                                    }
                                                }
                                                if (remoteFeed) {
                                                    Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                                                    feeds[remoteFeed.rfindex] = null;
                                                    remoteFeed.detach();
                                                }
                                            } else if (unpublished) {
                                                // One of the publishers has unpublished?
                                                Janus.log("Publisher left: " + unpublished);
                                                // if (unpublished === 'ok') {
                                                //     // That's us
                                                //     sfutest.hangup();
                                                //     return;
                                                // }
                                                let remoteFeed = null;
                                                for (let i = 1; i < roomCapacity; i++) {
                                                    if (feeds[i] && feeds[i].rfid === unpublished) {
                                                        remoteFeed = feeds[i];
                                                        break;
                                                    }
                                                }
                                                if (remoteFeed) {
                                                    Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                                                    feeds[remoteFeed.rfindex] = null;
                                                    remoteFeed.detach();
                                                }
                                            } else if (msg["error"]) {
                                                if (msg["error_code"] === 426) {
                                                    // This is a "no such room" error: give a more meaningful description
                                                    const createRoomConfig = {
                                                        request: "create",
                                                        room: myroom,
                                                        // <unique numeric ID, optional, chosen by plugin if missing>,
                                                        notify_joining: true,
                                                        bitrate: 128000,
                                                        publishers: roomCapacity, // default is 3,
                                                        record: false, // deside record video stream or not
                                                        // rec_dir: '/path/to/recordings-folder/',
                                                        // other property could refer to Video Room API https://janus.conf.meetecho.com/docs/videoroom.html
                                                    }
                                                    sfutest.send({ message: createRoomConfig });
                                                } else {
                                                    console.log(msg["error"])
                                                }
                                            }
                                            if (jsep) {
                                                Janus.debug("Handling SDP as well...", jsep);
                                                sfutest.handleRemoteJsep({ jsep: jsep });
                                                // Check if any of the media we wanted to publish has
                                                // been rejected (e.g., wrong or unsupported codec)
                                                let audio = msg["audio_codec"];
                                                if (localStream && localStream.getAudioTracks() && localStream.getAudioTracks().length > 0 && !audio) {
                                                    // Audio has been rejected
                                                    console.warning("Our audio stream has been rejected, viewers won't hear us");
                                                }
                                                let video = msg["video_codec"];
                                                if (localStream && localStream.getVideoTracks() && localStream.getVideoTracks().length > 0 && !video) {
                                                    // Video has been rejected
                                                    console.warning("Our video stream has been rejected, viewers won't see us");
                                                }
                                            }
                                            break;
                                    }
                                }
                            },
                            onlocalstream: function (stream) {
                                setLocalStream(stream)
                            },
                            webrtcState: function (on) {
                                Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
                            },
                            onremotestream: function (remoteList) {
                                //do nothing
                            },

                        });

                },
                error: function (error) {
                    Janus.error(error);
                    window.location.reload();
                    console.error("error:", error)
                },
            });
    }
    const newRemoteFeed = (id, display, audio, video) => {
        // A new feed has been published, create a new plugin handle and attach to it as a subscriber
        let remoteFeed = null;
        janus.attach(
            {
                plugin: 'janus.plugin.videoroom',
                opaqueId,
                success: (pluginHandle) => {
                    remoteFeed = pluginHandle;
                    remoteFeed.simulcastStarted = false;
                    Janus.log(`[VideoRoom][Remote] Plugin attached! (${remoteFeed.getPlugin()}, id=${remoteFeed.getId()})`);
                    Janus.log('[VideoRoom][Remote] -- This is a subscriber');
                    // We wait for the plugin to send us an offer
                    const subscribe = {
                        request: 'join', room: myroom, ptype: 'subscriber', feed: id, private_id: mypvtid,
                    };
                    // In case you don't want to receive audio, video or data, even if the
                    // publisher is sending them, set the 'offer_audio', 'offer_video' or
                    // 'offer_data' properties to false (they're true by default), e.g.:
                    // subscribe["offer_video"] = false;
                    // For example, if the publisher is VP8 and this is Safari, let's avoid video
                    if (Janus.webRTCAdapter.browserDetails.browser === 'safari'
                        && (video === 'vp9' || (video === 'vp8' && !Janus.safariVp8))) {
                        if (video) {
                            video = video.toUpperCase();
                        }
                        // toastr.warning("Publisher is using " + video + ", but Safari doesn't support it: disabling video");
                        subscribe.offer_video = false;
                    }
                    remoteFeed.videoCodec = video;
                    remoteFeed.send({ message: subscribe });
                },
                error: (error) => {
                    Janus.error('[VideoRoom][Remote]  -- Error attaching plugin...', error);
                    // bootbox.alert("Error attaching plugin... " + error);
                },
                onmessage: (msg, jsep) => {
                    const event = msg.videoroom;
                    Janus.log('[VideoRoom][Remote] ::: Got a message (publisher) :::', msg, event);
                    if(event === "attached") {
                        // Subscriber created and attached
                        for(var i=1;i<roomCapacity;i++) {
                            if(!feeds[i]) {
                                feeds[i] = remoteFeed;
                                remoteFeed.rfindex = i;
                                break;
                            }
                        }
                        remoteFeed.rfid = msg["id"];
                        remoteFeed.rfdisplay = msg["display"];
                    }
                    if (msg.error && msg.error !== null) {
                        Janus.log('[VideoRoom][Remote][ERROR]', msg.error);
                    } else if (event && event !== null) {
                        if (event === 'attached') {
                            // Subscriber created and attached
                            Janus.log(`[VideoRoom][Remote] Successfully attached to feed ${remoteFeed.rfid} (${remoteFeed.rfdisplay}) in room ${msg.room}`);
                        }
                    }
                    if (jsep) {
                        Janus.debug('[VideoRoom][Remote] Handling SDP as well...');
                        Janus.debug(jsep);
                        // Answer and attach
                        remoteFeed.createAnswer(
                            {
                                jsep,
                                // Add data:true here if you want to subscribe to datachannels as well
                                // (obviously only works if the publisher offered them in the first place)
                                media: { audioSend: false, videoSend: false },	// We want recvonly audio/video
                                success: (jsep) => {
                                    Janus.debug('[VideoRoom][Remote] Got SDP!');
                                    Janus.debug(`[VideoRoom][Remote] ${jsep}`);
                                    const body = { request: 'start', room: myroom };
                                    remoteFeed.send({ message: body, jsep });
                                },
                                error: (error) => {
                                    Janus.error('[VideoRoom][Remote] WebRTC error:', error);
                                },
                            }
                        );
                    }
                },
                webrtcState: (on) => {
                    Janus.log(`[VideoRoom][Remote] says this WebRTC PeerConnection (feed #' ${remoteFeed.rfindex} ') is '${(on ? 'up' : 'down')}' now')`);
                },
                onlocalstream: (stream) => {
                    // The subscriber stream is recvonly, we don't expect anything here
                    Janus.log('[VideoRoom][Remote] === local stream === ', stream);
                },
                onremotestream: (stream) => {
                    Janus.log(`[VideoRoom][Remote] Remote feed #${remoteFeed.rfindex}`);
                    // var videoTracks = stream.getVideoTracks();
                    // if(videoTracks === null || videoTracks === undefined || videoTracks.length === 0) {
                    //   // No remote video
                    // } else {
                    // }
                    remoteList[id] = stream;
                    setRemoteList(remoteList)
                },
                oncleanup: () => {
                    Janus.log(`[VideoRoom][Remote] ::: Got a cleanup notification (remote feed ${id}) :::`);
                },
            }
        );
    }

    return (
        <div className="App">
            <header className="App-header">
                <div> MyScreen:</div>

                {localStream && <video
                    ref={video => {
                        if (video) {
                            video.srcObject = localStream;
                        }
                    }}
                    autoPlay
                    playsInline
                    muted
                />}
                <div> Remote: {temp}</div>
                {Object.keys(remoteList).map((key, index) => {
                    const stream = remoteList[key];
                    console.log("stream>>", stream)
                    return (
                        <div key={index}>
                            <div>index:{index}</div>
                            <video
                                ref={video => {
                                    if (video) {
                                        video.srcObject = stream;
                                    }
                                }}
                                autoPlay
                                playsInline
                            />
                        </div>
                    )
                })}
                <button onClick={() => {
                    setTemp(!temp)
                }}>Fetch Remote Stream
                </button>
            </header>
        </div>
    );
}

export default App;
