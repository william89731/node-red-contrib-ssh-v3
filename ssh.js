'use strict';

module.exports = function (RED) {
    function SshV3(config) {
        RED.nodes.createNode(this, config);

        let node = this;

        node.status({ fill: "red", shape: "dot", text: "waiting" });

        let Client = require('ssh2').Client;

        let session = {
            code: 0,
            stdout: [],
            stderr: []
        };

        let notify = (type, data) => {
            switch (type) {
                case 0:
                    session.code = data;
                    node.send(session);
                    session = {
                        code: 0,
                        stdout: [],
                        stderr: []
                    };
                    break;
                case 1:
                    session.stdout.push(data.toString());
                    break;
                case 2:
                    session.stderr.push(data.toString());
                    break;
            }
        };


        let conn = new Client();

        conn.on('ready', () => {
            node.status({ fill: "green", shape: "dot", text: 'Ready' });
            node.on('input', (msg) => {
                conn.exec(msg.payload, (err, stream) => {
                    if (err) throw err;
                    stream.on('close', function (code, signal) {
                        node.warn('Stream :: close :: code: ' + code + ', signal: ' + signal);
                        conn.end();
                        notify(0, code);
                    }).on('data', (data) => {
                        node.status({ fill: "green", shape: "dot", text: data.toString() });
                        notify(1, data);
                    }).stderr.on('data', (data) => {
                        node.status({ fill: "black", shape: "dot", text: data.toString() });
                        notify(2, data);
                    });
                });
            })
        });

        conn.on('close', (err) => {
            node.warn('Ssh client close', err);
        });

        conn.on('error', (err) => {
            node.warn('Ssh client error', err);
        });

        conn.connect({
            host: config.hostname,
            port: 22,
            username: node.credentials.username ? node.credentials.username : undefined,
            password: node.credentials.password ? node.credentials.password : undefined,
            privateKey: config.ssh ? require('fs').readFileSync(config.ssh) : undefined
        });


        node.on('close', function () {
            node.warn('Ssh client dispose', err);
            conn ? conn.close() : undefined;
            conn ? conn.dispose : undefined;
        });
    }


    RED.nodes.registerType("ssh-v3", SshV3, {
        credentials: {
            username: { type: "text" },
            password: { type: "text" },


        }

    });
}
