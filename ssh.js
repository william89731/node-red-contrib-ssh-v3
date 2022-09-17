'use strict';

const { Client } = require('ssh2');
const { Mutex } = require('async-mutex');

module.exports = function (RED) {
    async function _connectClient(node, callback, failed = undefined){
        const release = await node.connectMutex.acquire();

        if(node.isConnected) {
            release();
            callback(node.client);
            return;
        }

        
        node.client = new Client();

        node.client.on('ready', () => {
            node.isConnected = true;
            node.log("Ssh client ready");
            node.status({ fill: "green", shape: "dot", text: 'Connected' });

            release();
            callback(node.client);
        });

        node.client.on('close', () => {
            node.isConnected = false;
            node.status({ fill: "red", shape: "dot", text: 'Disconnected' });
        });

        node.client.on('end', () => {
            node.isConnected = false;
            node.status({ fill: "red", shape: "dot", text: "Disconnected" });
        });

        node.client.on('error', (err) => {
            node.status({fill: "red", shape: "dot", text: err});
            node.log(err);
            release();
            node.isConnected = false;

            if(failed) {
                failed(err);
            }
        });

        node.client.on('continue', () => {
            if(node.continue) {
                node.continue();
            }
        })

        
        node.client.connect(node.options);
    }

    function SshV3(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        node.options = {
            host: config.hostname,
            port: 22,
            username: node.credentials.username ? node.credentials.username : undefined,
            password: node.credentials.password ? node.credentials.password : undefined,
            privateKey: config.ssh ? require('fs').readFileSync(config.ssh) : undefined
        };

        node.connectMutex = new Mutex();
        node.sendMutex = new Mutex();

        node.status({ fill: "blue", shape: "dot", text: "Initializing" });

        
        node.on('close', function () {
            node.client && node.client.end();
            node.client && node.client.destroy();
        });

        node.on('input', async (msg, send, done) => {
            if (!msg.payload) {
                node.warn("Invalid msg.payload.");
                return;
            }

            const release = await node.sendMutex.acquire();

            
            const session = {
                code: 0,
                stdout: [],
                stderr: []
            };

            const notify = (type, data) => {
                switch (type) {
                    case 0:
                        session.code = data;
                        msg.session = session;
                        send(msg);
                        done();
                        break;
                    case 1:
                        session.stdout.push(data.toString());
                        break;
                    case 2:
                        session.stderr.push(data.toString());
                        break;
                }
            };


            await _connectClient(node, (conn) => {
                node.continue = () => {
                    release();
                };

                const wait = conn.exec(msg.payload, (err, stream) => {
                    if (err) {
                        node.log("Ssh client error in input.");
                        throw err;
                    }

                    stream.on('close', function (code, signal) {
                        notify(0, code);
                    }).on('data', (data) => {
                        notify(1, data);
                    }).stderr.on('data', (data) => {
                        notify(2, data);
                    });
                });

                if(wait) {
                    node.continue = null;
                    release();
                }
            }, (err) => {
                release();
                node.error(err, msg);
            });
        });

        _connectClient(node, (conn) => { node.debug("SSH-CLI initial connection succeeded."); });

        node.debug("SSH-CLI setup done.");
    }

    
    RED.nodes.registerType("ssh-v3",SshV3, {
        credentials: {
            email: { type: "text" },
            username: { type: "text" },
            password: { type: "password" }
        }
    });
}