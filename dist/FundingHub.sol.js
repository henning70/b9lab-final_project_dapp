var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("FundingHub error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("FundingHub error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("FundingHub contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of FundingHub: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to FundingHub.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: FundingHub not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "default": {
    "abi": [
      {
        "constant": true,
        "inputs": [],
        "name": "fundingProject",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "funds",
            "type": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "createProject",
        "outputs": [
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "uint256"
          },
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "projects",
        "outputs": [
          {
            "name": "prjNumber",
            "type": "uint256"
          },
          {
            "name": "prjOwner",
            "type": "address"
          },
          {
            "name": "prjAddr",
            "type": "address"
          },
          {
            "name": "prjToRaise",
            "type": "uint256"
          },
          {
            "name": "prjRaised",
            "type": "uint256"
          },
          {
            "name": "prjDeadline",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "projectNum",
            "type": "uint256"
          }
        ],
        "name": "getContractInfo",
        "outputs": [
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "uint256"
          },
          {
            "name": "",
            "type": "uint256"
          },
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "contributor",
            "type": "address"
          },
          {
            "name": "projectNum",
            "type": "uint256"
          },
          {
            "name": "contribution",
            "type": "uint256"
          }
        ],
        "name": "contribute",
        "outputs": [
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "address"
          },
          {
            "name": "",
            "type": "uint256"
          },
          {
            "name": "",
            "type": "uint256"
          },
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "getProjectNumber",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "fundingHub",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [],
        "payable": false,
        "type": "constructor"
      },
      {
        "payable": true,
        "type": "fallback"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "fundingProject",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "funds",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "ProjectCreated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "contributor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "project",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution",
            "type": "uint256"
          }
        ],
        "name": "ContributionReceived",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060405234610000575b60008054600160a060020a0319166c01000000000000000000000000338102041790555b5b610ad88061003d6000396000f36060604052361561006b5760e060020a60003504622c80c5811461008957806302da667b146100b2578063107046bd146100ed5780638aa3e0111461013c5780638da5cb5b14610183578063a08f793c146101ac578063b98171d3146101f9578063f9b8057f14610218575b6100875b6000600060003411156100825750349050335b5b5050565b005b3461000057610096610241565b60408051600160a060020a039092168252519081900360200190f35b34610000576100c5600435602435610250565b60408051600160a060020a039094168452602084019290925282820152519081900360600190f35b34610000576100fd60043561038e565b60408051968752600160a060020a03958616602088015293909416858401526060850191909152608084015260a0830191909152519081900360c00190f35b346100005761014c6004356103d0565b60408051600160a060020a039687168152949095166020850152838501929092526060830152608082015290519081900360a00190f35b346100005761009661041f565b60408051600160a060020a039092168252519081900360200190f35b346100005761014c60043560243560443561042e565b60408051600160a060020a039687168152949095166020850152838501929092526060830152608082015290519081900360a00190f35b34610000576102066105cc565b60408051918252519081900360200190f35b34610000576100966105d3565b60408051600160a060020a039092168252519081900360200190f35b600154600160a060020a031681565b60006000600060006040516104f6806105e283396040519101819003906000f08015610000576001805473ffffffffffffffffffffffffffffffffffffffff199081166c0100000000000000000000000093840284900417825560058054808401808355600090815260066020908152604080832084905584548352808320870180548716338a028a90041790558654855484528184206002018054909716600160a060020a039182168a029990990498909817909555835482528482206003018d90558354825284822060040182905583548252908490209092018a905592548251941684528301899052828101889052519092507f142e33e8ca08dd930acf904a42633a4d41d34f15ccb4bd31bee212de71def2e7916060908290030190a1600154600160a060020a031693508592508491505b509250925092565b6006602052600090815260409020805460018201546002830154600384015460048501546005909501549394600160a060020a03938416949290931692909186565b60008181526006602052604090206001810154600282015460038301546004840154600590940154600160a060020a03938416949390921692909184848484845b505050505091939590929450565b600054600160a060020a031681565b60008281526006602090815260408083206004810180548601908190556001808301546002840154600385015460059095015483546c01000000000000000000000000600160a060020a039384168181029190910473ffffffffffffffffffffffffffffffffffffffff199092169190911790945586518c831681529788018490528787018a9052955188978897889788979490951695949290917fe482e8d853bcf23b76d7656a12af7c09cc6820a4683d6c48851261c2b12323b3919081900360600190a1600160009054906101000a9004600160a060020a0316600160a060020a03166321ee3634868f878f8888886000604051602001526040518860e060020a0281526004018088600160a060020a0316815260200187600160a060020a0316815260200186600160a060020a03168152602001858152602001848152602001838152602001828152602001975050505050505050602060405180830381600087803b156100005760325a03f11561000057508e9b509499508b985092965090945087925085915084905b5050505050939792965093509350565b6005545b90565b600254600160a060020a03168156606060405234610000575b60008054600160a060020a0319166c01000000000000000000000000338102041790555b5b6104b98061003d6000396000f3606060405236156100565760e060020a6000350463117de2fd81146100745780631f6d49421461009b57806321ee3634146100d55780633f19d0431461010b578063410085df146101455780638da5cb5b1461016c575b6100725b60006000600034111561006d5750349050335b5b5050565b005b3461000057610087600435602435610195565b604080519115158252519081900360200190f35b34610000576100ab600435610244565b60408051600160a060020a0394851681529290931660208301528183015290519081900360600190f35b346100005761008760043560243560443560643560843560a43560c435610272565b604080519115158252519081900360200190f35b34610000576100ab6004356103b6565b60408051600160a060020a0394851681529290931660208301528183015290519081900360600190f35b34610000576100876004356024356103ed565b604080519115158252519081900360200190f35b34610000576101796104aa565b60408051600160a060020a039092168252519081900360200190f35b604051600090600160a060020a038416906207a12090849084818181858888f19350505050156102085760408051600160a060020a03851681526020810184905281517f5afeca38b2064c23a692c4cf353015d80ab3ecc417b4f893f372690c11fbd9a6929181900390910190a161023d565b604080516001815290517f61e7116a55b37bae582b2ca5034c0477e9439ed906dcce14d5cf23320f1fed919181900360200190a15b5b92915050565b600460205260009081526040902080546001820154600290920154600160a060020a03918216929091169083565b60008284106102bb57604080516001815290517f317521815fd92667e85a4f7df7db80307647f2bc2ada3bf871a43a67cda335839181900360200190a16102b98885610195565b505b8142111561030357604080516001815290517f2081dadb00f558db4d76710a318b9b95fa29e092616d4c476b11bfef1f7581b89181900360200190a161030187866103ed565b505b814210156103a757604080516001815290517fcd34bcf2d8ddb36d336a107645ecde1ea3179fec06eb4cc8cad378a762facec69181900360200190a1600160a060020a038716600090815260046020526040902080546c01000000000000000000000000808a0281900473ffffffffffffffffffffffffffffffffffffffff199283161783556001830180548a830292909204919092161790556002018054860190555b5060015b979650505050505050565b600160a060020a038082166000908152600460205260409020805460018201546002909201549083169291909116905b9193909250565b604051600090600160a060020a038416906207a12090849084818181858888f19350505050156104675760408051600160a060020a03851681526020810184905281517fbb28353e4598c3b9199101a66e0989549b659a59a54d2c27fbb183f1932c8e6d929181900390910190a150600161023d5661023d565b604080516001815290517f858f955dff6fac91a44ffc0ddfa98b0fe59dbce944346313ff8baaf1dfd10b199181900360200190a150600061023d565b5b92915050565b600054600160a060020a03168156",
    "events": {
      "0x142e33e8ca08dd930acf904a42633a4d41d34f15ccb4bd31bee212de71def2e7": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "fundingProject",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "funds",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "ProjectCreated",
        "type": "event"
      },
      "0xe482e8d853bcf23b76d7656a12af7c09cc6820a4683d6c48851261c2b12323b3": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "contributor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "project",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution",
            "type": "uint256"
          }
        ],
        "name": "ContributionReceived",
        "type": "event"
      }
    },
    "updated_at": 1482262015773,
    "links": {},
    "address": "0x747b12f1518a6a3743f85d618d429730a771ac3f"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "FundingHub";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.FundingHub = Contract;
  }
})();
