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
      throw new Error("Project error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("Project error: contract binary not set. Can't deploy new instance.");
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

      throw new Error("Project contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of Project: " + unlinked_libraries);
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
      throw new Error("Invalid address passed to Project.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: Project not deployed or address not set.");
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
        "constant": false,
        "inputs": [
          {
            "name": "proj_owner",
            "type": "address"
          },
          {
            "name": "proj_raised",
            "type": "uint256"
          }
        ],
        "name": "payout",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "project_address",
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
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "contributors",
        "outputs": [
          {
            "name": "contributor",
            "type": "address"
          },
          {
            "name": "contribution",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "killer",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "contributor",
            "type": "address"
          }
        ],
        "name": "getContributions",
        "outputs": [
          {
            "name": "",
            "type": "address"
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
        "inputs": [
          {
            "name": "contributor_address",
            "type": "address"
          },
          {
            "name": "contribution_amount",
            "type": "uint256"
          }
        ],
        "name": "refund",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "proj_raised",
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
        "constant": false,
        "inputs": [],
        "name": "getProject",
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
          },
          {
            "name": "",
            "type": "uint256"
          },
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "proj_goal",
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
        "constant": false,
        "inputs": [
          {
            "name": "contributor_address",
            "type": "address"
          },
          {
            "name": "contribution_amount",
            "type": "uint256"
          }
        ],
        "name": "fund",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "proj_owner",
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
        "constant": true,
        "inputs": [],
        "name": "proj_deadline",
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
        "name": "project_balance",
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
        "name": "proj_balance",
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
        "name": "contributor_address",
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
        "constant": true,
        "inputs": [],
        "name": "contribution_amount",
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
        "name": "proj_active",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "project_owner",
            "type": "address"
          },
          {
            "name": "project_goal",
            "type": "uint256"
          },
          {
            "name": "project_deadline",
            "type": "uint256"
          }
        ],
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
            "name": "proj_owner",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "proj_balance",
            "type": "uint256"
          }
        ],
        "name": "payoutEvent",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "contributor_address",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution_amount",
            "type": "uint256"
          }
        ],
        "name": "refundEvent",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "proj_owner",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "proj_balance",
            "type": "uint256"
          }
        ],
        "name": "doPayoutEvent",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "contributor_address",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution_amount",
            "type": "uint256"
          }
        ],
        "name": "doDeadlineEvent",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "proj_balance",
            "type": "uint256"
          }
        ],
        "name": "doContributionEvent",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "successEvent",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "errorEvent",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "projectStatus",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x60606040523461000057604051606080610a348339810160409081528151602083015191909201515b600080546c01000000000000000000000000338102819004600160a060020a031992831617835560058054878302929092049190921617905560068390556007556009819055600a805460ff191660011790555b5050505b6109a68061008e6000396000f3606060405236156100da5760e060020a6000350463117de2fd81146100e45780631594614f146100f95780631f6d4942146101225780633ab3d4f6146101555780633f19d04314610164578063410085df1461019757806365b3ba07146101ac5780636e57b700146101cb5780637a497b7a1461020f5780637b1837de1461022e5780638105c002146102435780638da5cb5b1461026c57806391e13a7a14610295578063bae628c8146102b4578063cd654c20146102d3578063ddaeadaf146102f2578063f5669e751461031b578063f77b23b01461033a575b6100e25b5b5b565b005b34610000576100e260043560243561035b565b005b346100005761010661042d565b60408051600160a060020a039092168252519081900360200190f35b346100005761013260043561043c565b60408051600160a060020a03909316835260208301919091528051918290030190f35b34610000576100e2610461565b005b346100005761013260043561048a565b60408051600160a060020a03909316835260208301919091528051918290030190f35b34610000576100e26004356024356104b4565b005b34610000576101b961071f565b60408051918252519081900360200190f35b34610000576101d8610725565b60408051600160a060020a039096168652602086019490945284840192909252606084015215156080830152519081900360a00190f35b34610000576101b961074b565b60408051918252519081900360200190f35b34610000576100e2600435602435610751565b005b3461000057610106610918565b60408051600160a060020a039092168252519081900360200190f35b3461000057610106610927565b60408051600160a060020a039092168252519081900360200190f35b34610000576101b9610936565b60408051918252519081900360200190f35b34610000576101b961093c565b60408051918252519081900360200190f35b34610000576101b9610942565b60408051918252519081900360200190f35b3461000057610106610948565b60408051600160a060020a039092168252519081900360200190f35b34610000576101b9610957565b60408051918252519081900360200190f35b346100005761034761095d565b604080519115158252519081900360200190f35b600654600754106104265760408051600160a060020a03841681526020810183905281517f05ccd5e3de7d0e51467778b05ac36bfb952fa2e122e854d8fe31f40ad316b6b1929181900390910190a1604051600160a060020a038316906207a1209083906000818181858888f193505050501561040357604080516001815290516000805160206109868339815191529181900360200190a1600a805460ff19169055610426565b604080516001815290516000805160206109668339815191529181900360200190a15b5b5b5b5050565b600154600160a060020a031681565b600b6020526000908152604090208054600190910154600160a060020a039091169082565b60005433600160a060020a03908116911614156100de57600054600160a060020a0316ff5b5b5b565b600160a060020a038082166000908152600b6020526040902080546001909101549116905b915091565b600a5460ff1615156105805760408051600160a060020a03841681526020810183905281517fcb1ed30c8a84603cc9cd35d8ffd0eb9298b137e6ade703816a297932f375f51d929181900390910190a1604051600160a060020a038316906207a1209083906000818181858888f193505050501561055d57604080516001815290516000805160206109868339815191529181900360200190a1600a805460ff19169055610580565b604080516001815290516000805160206109668339815191529181900360200190a15b5b5b600954421061064b5760408051600160a060020a03841681526020810183905281517fcb1ed30c8a84603cc9cd35d8ffd0eb9298b137e6ade703816a297932f375f51d929181900390910190a1604051600160a060020a038316906207a1209083906000818181858888f193505050501561062857604080516001815290516000805160206109868339815191529181900360200190a1600a805460ff1916905561064b565b604080516001815290516000805160206109668339815191529181900360200190a15b5b5b600654600754106104265760408051600160a060020a03841681526020810183905281517fcb1ed30c8a84603cc9cd35d8ffd0eb9298b137e6ade703816a297932f375f51d929181900390910190a1604051600160a060020a038316906207a1209083906000818181858888f193505050501561040357604080516001815290516000805160206109868339815191529181900360200190a1600a805460ff19169055610426565b604080516001815290516000805160206109668339815191529181900360200190a15b5b5b5b5050565b60075481565b600554600654600754600954600a54600160a060020a039094169360ff165b9091929394565b60065481565b6007805482019055600a5460ff161515600114156108d45760095442106107c05760408051600160a060020a03841681526020810183905281517f68956f48b0b6a7b97afac6b79e1516348ccab75d176b6556244b3b946c297faf929181900390910190a16107c082826104b4565b5b600654600754106108305760055460075460408051600160a060020a039093168352602083019190915280517f5867e74c7e42acac8dd729797ff1222d84388dd740fdf17643bd5b351bc0cf779281900390910190a160055460075461083091600160a060020a03169061035b565b5b600954421080156108455750600654600754105b156108cf5760075460408051918252517f43cbdea690264ce795e23f1fc2964dea6a26151ce77f1932ea691d97189da80f9181900360200190a1600160a060020a0382166000908152600b60205260409020805473ffffffffffffffffffffffffffffffffffffffff19166c01000000000000000000000000808502041781556001018054820190555b610426565b604080516001815290517fcc71cb3d3bc2cbf73204e72f6412129df3d0a72569c1e3dbf687d93b456de9e09181900360200190a161042682826104b4565b5b5b5050565b600554600160a060020a031681565b600054600160a060020a031681565b60095481565b60035481565b60085481565b600254600160a060020a031681565b60045481565b600a5460ff16815666a77db7fca2e5dd0eef22be7e4b5576babe30fb3d8dcd4ba786067a0fd0010261c966a818ab8cca1e1ed105cf1bc92b7ab5daf3b194d882c798183fe9722595",
    "events": {
      "0x5afeca38b2064c23a692c4cf353015d80ab3ecc417b4f893f372690c11fbd9a6": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "Payout",
        "type": "event"
      },
      "0xbb28353e4598c3b9199101a66e0989549b659a59a54d2c27fbb183f1932c8e6d": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "Refund",
        "type": "event"
      },
      "0x317521815fd92667e85a4f7df7db80307647f2bc2ada3bf871a43a67cda33583": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "GotPayout",
        "type": "event"
      },
      "0x2081dadb00f558db4d76710a318b9b95fa29e092616d4c476b11bfef1f7581b8": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "GotDeadline",
        "type": "event"
      },
      "0xcd34bcf2d8ddb36d336a107645ecde1ea3179fec06eb4cc8cad378a762facec6": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "GotContribute",
        "type": "event"
      },
      "0x61e7116a55b37bae582b2ca5034c0477e9439ed906dcce14d5cf23320f1fed91": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "ErrorPayout",
        "type": "event"
      },
      "0x858f955dff6fac91a44ffc0ddfa98b0fe59dbce944346313ff8baaf1dfd10b19": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "ErrorDeadline",
        "type": "event"
      },
      "0x05ccd5e3de7d0e51467778b05ac36bfb952fa2e122e854d8fe31f40ad316b6b1": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "proj_owner",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "proj_balance",
            "type": "uint256"
          }
        ],
        "name": "payoutEvent",
        "type": "event"
      },
      "0xcb1ed30c8a84603cc9cd35d8ffd0eb9298b137e6ade703816a297932f375f51d": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "contributor_address",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution_amount",
            "type": "uint256"
          }
        ],
        "name": "refundEvent",
        "type": "event"
      },
      "0xc08b958476490c55d1f9b85539177c85c1cc04d861efd8fa55c1c3024ea331b6": {
        "anonymous": false,
        "inputs": [],
        "name": "doPayoutEvent",
        "type": "event"
      },
      "0x90dbc02d9e9bfebb269e2143c3dbadc7e10572fba198567fd1953b29353abe88": {
        "anonymous": false,
        "inputs": [],
        "name": "doDeadlineEvent",
        "type": "event"
      },
      "0x2d58f906c2960ae4533609d85e6b0652529a9b0849307c89a95b49d08580f91d": {
        "anonymous": false,
        "inputs": [],
        "name": "doContributionEvent",
        "type": "event"
      },
      "0xe272d68d2551c3bb078050f05542a06863e4eb2ca44d2793fecf77563808ee1d": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "error",
            "type": "bytes"
          }
        ],
        "name": "errorEvent",
        "type": "event"
      },
      "0x5867e74c7e42acac8dd729797ff1222d84388dd740fdf17643bd5b351bc0cf77": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "proj_owner",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "proj_balance",
            "type": "uint256"
          }
        ],
        "name": "doPayoutEvent",
        "type": "event"
      },
      "0x68956f48b0b6a7b97afac6b79e1516348ccab75d176b6556244b3b946c297faf": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "contributor_address",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution_amount",
            "type": "uint256"
          }
        ],
        "name": "doDeadlineEvent",
        "type": "event"
      },
      "0x43cbdea690264ce795e23f1fc2964dea6a26151ce77f1932ea691d97189da80f": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "proj_balance",
            "type": "uint256"
          }
        ],
        "name": "doContributionEvent",
        "type": "event"
      },
      "0x049859dcbad5f30fc53e063e822d4ae13b1f4022db0f779b2555cf41c0cd6bb7": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "success",
            "type": "bytes"
          }
        ],
        "name": "successEvent",
        "type": "event"
      },
      "0x95a1f3a1dafdd4c1af344e3d7c69a72cbce8a3f15fe1cf95a7f5bd23df2e71a1": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "success",
            "type": "string"
          }
        ],
        "name": "successEvent",
        "type": "event"
      },
      "0x94f8f71e1e35b594828465568a17f7b8d6a023d5472ad568a335543fe73636cd": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "error",
            "type": "string"
          }
        ],
        "name": "errorEvent",
        "type": "event"
      },
      "0xc0fd787b8e4983140dba2cb60e806b6ced141fabb512cfbdc94efa8d740abc0a": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "status",
            "type": "string"
          }
        ],
        "name": "projectStatus",
        "type": "event"
      },
      "0x15504e11775a2cc1976320e3c666e5965057d329614934f0b707fc711dfb82ec": {
        "anonymous": false,
        "inputs": [],
        "name": "successEvent",
        "type": "event"
      },
      "0x8ddc291ed4b499a62841e3007ad67c98809fff928081ee0fa02477e9048ff156": {
        "anonymous": false,
        "inputs": [],
        "name": "errorEvent",
        "type": "event"
      },
      "0x1ab33308cd2c9806f033bd0473678798cf88497a22cb331d8d70ff333cd0d679": {
        "anonymous": false,
        "inputs": [],
        "name": "projectStatus",
        "type": "event"
      },
      "0x61c966a818ab8cca1e1ed105cf1bc92b7ab5daf3b194d882c798183fe9722595": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "successEvent",
        "type": "event"
      },
      "0x66a77db7fca2e5dd0eef22be7e4b5576babe30fb3d8dcd4ba786067a0fd00102": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "errorEvent",
        "type": "event"
      },
      "0xcc71cb3d3bc2cbf73204e72f6412129df3d0a72569c1e3dbf687d93b456de9e0": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "projectStatus",
        "type": "event"
      }
    },
    "updated_at": 1482611513030,
    "links": {},
    "address": "0xc90ce86b2f59a0baa77f12379c6658026bae6a61"
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

  Contract.contract_name   = Contract.prototype.contract_name   = "Project";
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
    window.Project = Contract;
  }
})();
