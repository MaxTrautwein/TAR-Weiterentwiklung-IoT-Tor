module.exports = function(RED) {
    /**
     * Attempts to get and convert the `ON` / `OFF` response from a Tasmota msg and retun it as `True`/`False`
     * @param {*} obj Json object
     * @param {string} name Name example: `Switch1`
     * @param {string} act parameter example: `Action`
     * @returns `True`/`False` on error: `null`
     */
    function getOnOff_to_TrueFalse(obj,name,act){
       try{
            let val = obj[name][act];
            switch(val){
                case "ON":
                    return true;
                    break;
                case "OFF":
                    return false;
                    break;
                default:
                    console.log("Error unexpected Value for getOnOff_to_TrueFalse: '" + val + "'" );
                    return null;
            }
        }catch (e){
            return null;
        }
    }

    /**
     * (MQTT -> Node Red) Sends a `True` Pulse
     * @param {*} t unused
     * @param {*} payload unused
     * @param {*} ref Node
     * @param {*} port Node Port
     */
    function PulseTrue(t,payload,ref,port){
        var sendarr =  Array(ref.outputs).fill(null);
        sendarr[port] = {payload:true};
        if (ref.outputs === 1){
            ref.send(sendarr[port]);
        }else{
            ref.send(sendarr);
        }
        sendarr[port] = {payload:false};
        if (ref.outputs === 1){
            ref.send(sendarr[port]);
        }else{
            ref.send(sendarr);
        }

    }
    /**
     * (MQTT -> Node Red) Translates Tasmota Switch msgs
     * @param {*} conf Json Port config
     * @param {*} payload msg Playload
     * @param {*} ref Node
     * @param {*} port Node Port
     * @returns nothing
     */
    function SwitchModeOnOFF(conf,payload,ref,port){
        let sendarr =  Array(ref.outputs).fill(null);
        let switchN = "Switch" + conf["arg"];
        let val = getOnOff_to_TrueFalse(JSON.parse(payload),switchN,"Action");
        if (val === null){
            return;
        }
        sendarr[port] = {payload:val};
        if (ref.outputs === 1){
            ref.send(sendarr[port]);
        }else{
            ref.send(sendarr);
        }
    }



    /**
     * (Node Red -> MQTT) Sends a Msg twice
     * @param {*} t MQTT Topic
     * @param {*} payload MQTT Payload
     * @param {*} ref Node
     */
    function DoubleOnTrue(t,payload,ref){
        var msg = { payload:payload, topic:t };
        ref.brokerConn.publish(msg, function(err) {
            let args = arguments;
            let l = args.length;
            ref.done(err);
        });
        ref.brokerConn.publish(msg, function(err) {
            let args = arguments;
            let l = args.length;
            ref.done(err);
        });
    }

    /**
     * (Node Red -> MQTT) Sends a Msg once
     * @param {*} t MQTT Topic
     * @param {*} payload MQTT Payload
     * @param {*} ref Node
     */
    function SingleOnTrue(t,payload,ref){
        var msg = { payload:payload, topic:t };
        ref.brokerConn.publish(msg, function(err) {
            let args = arguments;
            let l = args.length;
            ref.done(err);
        });
        //ref.send(msg);
    }

    /**
     * (Node Red -> MQTT) Sends Diffrent Msg based on input (`True`,`False`) on possibly diffrent Topics
     * @param {*} conf Json Port config
     * @param {*} ref Node
     * @param {*} msg NodeRed Msg object
     */
    function TrueFalseMessage(conf,ref,msg){
        var topic2 = conf["Topic"];
        if (conf["Topic_alt"] !== undefined){
            topic2 = conf["Topic_alt"];
        }
        switch (msg.payload) {
            case true:
                ref.brokerConn.publish({ payload:conf["payload"], topic:conf["Topic"] }, function(err) {
                    let args = arguments;
                    let l = args.length;
                    ref.done(err);
                });
                //ref.send();
                break;
            case false:
                //TODO
                ref.brokerConn.publish({ payload:conf["payload_alt"], topic:conf["Topic"] }, function(err) {
                    let args = arguments;
                    let l = args.length;
                    ref.done(err);
                });
                //ref.send({ payload:conf["payload_alt"], topic:conf["Topic"] });
                break;
            default:
                //Should not happen
                ref.error("unexpected input '" + msg.payload + "' is not a bool")
                break;
        }
    }

    /**
     * Handels Input and Output msgs
     * @param {*} conf Json Port config
     * @param {*} msg Tasmota msg object
     * @param {*} ref Node
     * @param {*} lib Libary ref
     * @param {*} port Node Red Output Port
     */
    function HandleOI(conf,msg,ref,lib,port = 0){
        switch(conf["Interpreter"]){
            case "DoubleOnTrueDelay": 
                //Back Compat
                if (msg.payload !== true) break;
                DoubleOnTrue(conf["Topic"],conf["payload"],ref);
                break;
            case "DoubleOnTrue":
                if (msg.payload !== true) break;
                DoubleOnTrue(conf["Topic"],conf["payload"],ref);
                break;
            case "SingleOnTrue":
                if (msg.payload !== true) break;
                SingleOnTrue(conf["Topic"],conf["payload"],ref);
                break;
            case "PulseTrue":
                if(msg.topic !== conf["Topic"]) break;
                PulseTrue(conf["Topic"],msg.payload,ref,port);
                break;
            case "SwitchModeOnOFF":
                if(msg.topic !== conf["Topic"]) break;
                if (!lib.TryParseJson(msg.payload)) return;
                SwitchModeOnOFF(conf,msg.payload,ref,port);
                break;
            case "TrueFalseMessage":
                TrueFalseMessage(conf,ref,msg);
        }
    }

    /**
     * (Node Red -> MQTT) OutputNode
     * @param {*} config 
     */
    function OutputNode(config) {
        RED.nodes.createNode(this,config);
        const lib  = require("../resources/library");
        const mqttHandler  = require("../resources/mqttHandler");
        this.broker = config.broker;

        this.configuration = RED.nodes.getNode(config.configuration);
        this.AusgangName = config.AusgangName;
        this.allports = config.allports;

        this.jsonC = JSON.parse( this.configuration.configur);
        var node = this;
        this.brokerConn = RED.nodes.getNode(this.broker);

        if (this.brokerConn) {

            this.status({fill:"red",shape:"ring",text:"node-red:common.status.disconnected"});
            
            node.on('input', function(msg) {
                if (this.allports){
                    //Handle allports
                    let outputConfig = this.jsonC["Output"][msg.__port];
                    HandleOI(outputConfig,msg,this,lib);
                }else{
                    //Handle Single
                    let outputConfig = this.jsonC["Output"][parseInt(this.AusgangName)];
                    HandleOI(outputConfig,msg,this,lib);
                }
            });
            if (this.brokerConn.connected) {
                node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
            }
            node.brokerConn.register(node);
            this.on('close', function(done) {
                node.brokerConn.deregister(node,done);
            });
    
        }
    }
    //Register Node
    RED.nodes.registerType("Output",OutputNode);

    /**
     * (MQTT -> Node Red) InputNode
     * @param {*} config 
     */
    function InputNode(config) {
        RED.nodes.createNode(this,config);
        const lib  = require("../resources/library");
        const mqttHandler  = require("../resources/mqttHandler");

        this.configuration = RED.nodes.getNode(config.configuration);
        this.EingangName = config.EingangName;
        this.allportsi = config.allportsi;
        this.outputs = config.outputs;
        this.broker = config.broker;

        this.jsonC = JSON.parse( this.configuration.configur);
        var node = this;
        this.brokerConn = RED.nodes.getNode(this.broker);

        if (this.brokerConn) {
            this.status({fill:"red",shape:"ring",text:"node-red:common.status.disconnected"});
            mqttHandler.SubscribeHandler(this.brokerConn,node,0 ,function(msg) {
                if (node.jsonC){
                    if (node.allportsi){
                        //Handle allports
                        for(let i = 0; i< node.jsonC["Input"].length;i++){
                            HandleOI(node.jsonC["Input"][i],msg,node,lib,i);
                        }
                    }else{
                        //Handle Single
                        let outputConfig = node.jsonC["Input"][parseInt(node.EingangName)];
                        HandleOI(outputConfig,msg,node,lib);
                    }
                }
                
            });
            if (this.brokerConn.connected) {
                node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
            }
            this.brokerConn.register(node);
            this.on('close', function(removed, done) {
                if (this.brokerConn) {
                    this.brokerConn.unsubscribe("#",node.id, removed);
                    this.brokerConn.deregister(node,done);
                }
            });
        }
    }
    //Register Node
    RED.nodes.registerType("Input",InputNode);


}