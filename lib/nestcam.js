'use strict';

let uuid, Service, Characteristic, StreamController;

const fs = require('fs');
const ip = require('ip');
const spawn = require('child_process').spawn;
const querystring = require('querystring');
const NexusStreamer = require('./streamer').NexusStreamer;

class NestCam {
  constructor(api, info) {
    let self = this;
    self.ffmpegCodec = "libx264";
    self.api = api;
    self.name = info.name;
    self.uuid = info.uuid;
    self.serialNumber = info.serial_number;
    self.nexusTalkHost = info.direct_nexustalk_host;
    self.apiHost = info.nexus_api_http_server.slice(8); // remove https://
  }

  // Homebridge

  configureWithHAP(hap, config) {
    uuid = hap.uuid;
    Service = hap.Service;
    Characteristic = hap.Characteristic;
    StreamController = hap.StreamController;

    let self = this;
    // This is for backward compatibility with the old useOMX config value
    if (config.useOMX) {
      self.ffmpegCodec = "h264_omx";
    } else if (config.ffmpegCodec) {
      self.ffmpegCodec = config.ffmpegCodec;
    }
    self.services = [];
    self.streamControllers = [];

    self.sessions = {};

    let numberOfStreams = 2;
    let videoResolutions = [
      [320, 240, 30],
      [480, 360, 30],
      [640, 480, 30],
      [1024, 768, 30],
      [1152, 864, 30],
      [1280, 960, 30],
      [1600, 1200, 30]
    ];

    let options = {
      proxy: false,
      srtp: true,
      video: {
        resolutions: videoResolutions,
        codec: {
          profiles: [0, 1, 2],
          levels: [0, 1, 2]
        }
      },
      audio: {
        codecs: [
          {
            type: "OPUS",
            samplerate: 24
          },
          {
            type: "OPUS",
            samplerate: 16
          },
          {
            type: "OPUS",
            samplerate: 8
          },
          {
            type: "AAC-eld",
            samplerate: 16
          }
        ]
      }
    }

    self.createCameraControlService();
    self._createStreamControllers(numberOfStreams, options);
  }

  // Camera Source

  handleSnapshotRequest(request, callback) {
    let self = this;
    let query = querystring.stringify({
      uuid: self.uuid,
      width: request.width
    });
    self.api.sendRequest(self.apiHost, '/get_image?' + query, 'GET')
      .then((response) => {
        callback(undefined, response);
      })
      .catch((err) => {
        callback(err);
      });
  }

  handleCloseConnection(connectionID) {
    let self = this;
    self.streamControllers.forEach((controller) => {
      controller.handleCloseConnection(connectionID);
    });
  }

  prepareStream(request, callback) {
    let self = this;

    let sessionID = uuid.unparse(request["sessionID"]);
    let streamer = new NexusStreamer(self.nexusTalkHost, self.uuid, self.api.sessionToken, self.ffmpegCodec);
    self.sessions[sessionID] = streamer;
    streamer.prepareStream(request, callback);
  }

  handleStreamRequest(request) {
    let self = this;

    let sessionID = request["sessionID"];
    let requestType = request["type"];

    if (sessionID) {
      let sessionIdentifier = uuid.unparse(sessionID);
      let streamer = self.sessions[sessionIdentifier];
      if (!streamer) {
        return;
      }

      if (requestType === 'start') {
        streamer.startPlaybackWithRequest(request);
      } else if (requestType === 'stop') {
        streamer.stopPlayback();
        delete self.sessions[sessionIdentifier];
      }
    }
  }

  createCameraControlService() {
    let controlService = new Service.CameraControl();
    this.services.push(controlService);
  }

  _createStreamControllers(maxStreams, options) {
    let self = this;
    for (var i = 0; i < maxStreams; i++) {
      var streamController = new StreamController(i, options, self);
      self.services.push(streamController.service);
      self.streamControllers.push(streamController);
    }
  }
}

module.exports = {
  NestCam: NestCam
};
