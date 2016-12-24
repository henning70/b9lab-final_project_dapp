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
        "constant": false,
        "inputs": [
          {
            "name": "funding_project_goal",
            "type": "uint256"
          },
          {
            "name": "funding_project_deadline",
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
            "name": "project_id",
            "type": "uint256"
          },
          {
            "name": "project_owner",
            "type": "address"
          },
          {
            "name": "project_address",
            "type": "address"
          },
          {
            "name": "project_goal",
            "type": "uint256"
          },
          {
            "name": "project_balance",
            "type": "uint256"
          },
          {
            "name": "project_deadline",
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
            "name": "funding_project_id",
            "type": "uint256"
          },
          {
            "name": "project_active",
            "type": "bool"
          }
        ],
        "name": "setProjectStatus",
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
        "constant": false,
        "inputs": [],
        "name": "getProjectCount",
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
        "name": "funding_project_address",
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
            "name": "funding_project_id",
            "type": "uint256"
          }
        ],
        "name": "getProjectDetails",
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
        "inputs": [
          {
            "name": "_funding_project_id",
            "type": "uint256"
          },
          {
            "name": "_contributor",
            "type": "address"
          },
          {
            "name": "_contribution",
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
            "name": "funding_project_owner",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "funding_project_address",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "funding_project_goal",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "funding_project_deadline",
            "type": "uint256"
          }
        ],
        "name": "proj_created_event",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "funding_project_contributor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "project",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "funding_project_contribution",
            "type": "uint256"
          }
        ],
        "name": "proj_contribution_event",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060405234610000575b60008054600160a060020a0319166c01000000000000000000000000338102041790555b5b6110fb8061003d6000396000f3606060405236156100775760e060020a600035046302da667b8114610095578063107046bd146100d05780633ab3d4f61461011f5780633af6cd1e1461012e5780633bcff3b0146101555780634a31dc54146101745780635f8439e31461019d5780638952ac1e146101e45780638da5cb5b14610231575b6100935b60006000600034111561008e5750349050335b5b5050565b005b34610000576100a860043560243561025a565b60408051600160a060020a039094168452602084019290925282820152519081900360600190f35b34610000576100e0600435610407565b60408051968752600160a060020a03958616602088015293909416858401526060850191909152608084015260a0830191909152519081900360c00190f35b3461000057610093610449565b005b3461000057610141600435602435610472565b604080519115158252519081900360200190f35b346100005761016261047b565b60408051918252519081900360200190f35b3461000057610181610482565b60408051600160a060020a039092168252519081900360200190f35b34610000576101ad600435610491565b60408051600160a060020a039687168152949095166020850152838501929092526060830152608082015290519081900360a00190f35b34610000576101ad6004356024356044356104e0565b60408051600160a060020a039687168152949095166020850152838501929092526060830152608082015290519081900360a00190f35b346100005761018161066c565b60408051600160a060020a039092168252519081900360200190f35b600280546001808201808455600090815260086020526040808220849055845482528082209092018054600160a060020a031916606060020a338082029190910491909117909155845482528282206003018790558454825282822060040182905593548152818120600501859055905190928392839290919087908790610a808061067b8339018084600160a060020a031681526020018381526020018281526020019350505050604051809103906000f080156100005760018054600160a060020a031916606060020a928302929092049190911790819055604051600160a060020a0390911690620f4240906706f05b59d3b20000906000818181858888f150505050505b60018054600280546000908152600860209081526040918290209092018054600160a060020a031916606060020a600160a060020a039586168102041790559254835133841681529216908201528082018890526060810187905290517f3c41d33ccb4fcfac569448e9c19055f678a8f980ddf34dfaad3c8538a8764d36916080908290030190a1600154600160a060020a031693508592508491505b509250925092565b6008602052600090815260409020805460018201546002830154600384015460048501546005909501549394600160a060020a03938416949290931692909186565b60005433600160a060020a039081169116141561046e57600054600160a060020a0316ff5b5b5b565b60015b92915050565b6002545b90565b600154600160a060020a031681565b60008181526008602052604090206001810154600282015460038301546004840154600590940154600160a060020a03938416949390921692909184848484845b505050505091939590929450565b600583815560068054606060020a808602819004600160a060020a031992831617835560078581556000888152600860209081526040808320600490810180548b01905588548452818420600181810154600283015493830154600384015493909c01548254600160a060020a03958616808c029b909b049b169a909a1790915598549554835196831687529386018790528583019390935290519297889788978897889792909416959394929390917f9d1524e96a43e681c32903b13a998b424cadaf54a52b47421357ba439c9fd207919081900360600190a1600154600654600754604080517f7b1837de000000000000000000000000000000000000000000000000000000008152600160a060020a0393841660048201526024810192909252519190921691637b1837de91604480830192600092919082900301818387803b156100005760325a03f11561000057505050600660009054906101000a9004600160a060020a0316846007548585995099509950995099505b5050505050939792965093509350565b600054600160a060020a0316815660606040523461000057604051606080610a808339810160409081528151602083015191909201515b600080546c01000000000000000000000000338102819004600160a060020a031992831617909255600580548684029390930492909116919091179055600682905560088190556009805460ff191660011790555b5050505b6109f18061008f6000396000f3606060405236156100cf5760e060020a6000350463117de2fd811461010b5780631594614f146101205780631f6d4942146101495780633ab3d4f61461017c5780633f19d0431461018b578063410085df146101be5780636e57b700146101d35780637a497b7a146102175780637b1837de146102365780638105c0021461024b5780638da5cb5b1461027457806391e13a7a1461029d578063bae628c8146102bc578063cd654c20146102db578063ddaeadaf146102fa578063f5669e7514610323578063f77b23b014610342575b6101095b60003411156101065734600481905560028054600160a060020a031916606060020a338102041790556007805490910190555b5b565b005b3461000057610109600435602435610363565b005b346100005761012d6104b1565b60408051600160a060020a039092168252519081900360200190f35b34610000576101596004356104c0565b60408051600160a060020a03909316835260208301919091528051918290030190f35b34610000576101096104e5565b005b346100005761015960043561050e565b60408051600160a060020a03909316835260208301919091528051918290030190f35b3461000057610109600435602435610538565b005b34610000576101e061081b565b60408051600160a060020a039096168652602086019490945284840192909252606084015215156080830152519081900360a00190f35b3461000057610224610843565b60408051918252519081900360200190f35b3461000057610109600435602435610849565b005b346100005761012d6109a3565b60408051600160a060020a039092168252519081900360200190f35b346100005761012d6109b2565b60408051600160a060020a039092168252519081900360200190f35b34610000576102246109c1565b60408051918252519081900360200190f35b34610000576102246109c7565b60408051918252519081900360200190f35b34610000576102246109cd565b60408051918252519081900360200190f35b346100005761012d6109d3565b60408051600160a060020a039092168252519081900360200190f35b34610000576102246109e2565b60408051918252519081900360200190f35b346100005761034f6109e8565b604080519115158252519081900360200190f35b600654600754106104aa5760408051600160a060020a03841681526020810183905281517f05ccd5e3de7d0e51467778b05ac36bfb952fa2e122e854d8fe31f40ad316b6b1929181900390910190a1604051600160a060020a03831690620f42409083906000818181858888f1935050505015610449576040805160208082526011908201527f7061796f7574207375636365737366756c0000000000000000000000000000008183015290517f049859dcbad5f30fc53e063e822d4ae13b1f4022db0f779b2555cf41c0cd6bb79181900360600190a16009805460ff191690556104aa565b6040805160208082526013908201527f7061796f757420756e7375636365737366756c000000000000000000000000008183015290517fe272d68d2551c3bb078050f05542a06863e4eb2ca44d2793fecf77563808ee1d9181900360600190a15b5b5b5b5050565b600154600160a060020a031681565b600a6020526000908152604090208054600190910154600160a060020a039091169082565b60005433600160a060020a039081169116141561010657600054600160a060020a0316ff5b5b5b565b600160a060020a038082166000908152600a6020526040902080546001909101549116905b915091565b60085442106106a45760028054600160a060020a031916606060020a848102041790819055600482905560408051600160a060020a0390921682526020820183905280517fcb1ed30c8a84603cc9cd35d8ffd0eb9298b137e6ade703816a297932f375f51d9281900390910190a1600254600454604051600160a060020a0390921691620f424091906000818181858888f1935050505015610643576009805460ff191690556040805160208082526011908201527f726566756e64207375636365737366756c0000000000000000000000000000008183015290517f049859dcbad5f30fc53e063e822d4ae13b1f4022db0f779b2555cf41c0cd6bb79181900360600190a16106a4565b6040805160208082526013908201527f7061796f757420756e7375636365737366756c000000000000000000000000008183015290517fe272d68d2551c3bb078050f05542a06863e4eb2ca44d2793fecf77563808ee1d9181900360600190a15b5b5b600654600754106104aa5760028054600160a060020a031916606060020a848102041790819055600482905560408051600160a060020a0390921682526020820183905280517fcb1ed30c8a84603cc9cd35d8ffd0eb9298b137e6ade703816a297932f375f51d9281900390910190a1600254600454604051600160a060020a0390921691620f424091906000818181858888f1935050505015610449576009805460ff191690556040805160208082526011908201527f726566756e64207375636365737366756c0000000000000000000000000000008183015290517f049859dcbad5f30fc53e063e822d4ae13b1f4022db0f779b2555cf41c0cd6bb79181900360600190a16104aa565b6040805160208082526013908201527f7061796f757420756e7375636365737366756c000000000000000000000000008183015290517fe272d68d2551c3bb078050f05542a06863e4eb2ca44d2793fecf77563808ee1d9181900360600190a15b5b5b5b5050565b600554600654600754600854600954600160a060020a039094169360ff16845b509091929394565b60065481565b600654600754106108b85760055460075460408051600160a060020a039093168352602083019190915280517f5867e74c7e42acac8dd729797ff1222d84388dd740fdf17643bd5b351bc0cf779281900390910190a16005546007546108b891600160a060020a031690610363565b5b60085442106109105760408051600160a060020a03841681526020810183905281517f68956f48b0b6a7b97afac6b79e1516348ccab75d176b6556244b3b946c297faf929181900390910190a16109108282610538565b5b600854421080156109255750600654600754105b156104aa5760075460408051918252517f43cbdea690264ce795e23f1fc2964dea6a26151ce77f1932ea691d97189da80f9181900360200190a1600160a060020a0382166000908152600a602052604090208054600160a060020a031916606060020a808502041781556001018054820190556104aa565b5b5b5050565b600554600160a060020a031681565b600054600160a060020a031681565b60085481565b60035481565b60075481565b600254600160a060020a031681565b60045481565b60095460ff168156",
    "events": {
      "0x1d4af9c6aef9b93c676a54b94bbd1aac1d92dd1700ed076ce78358019769aad4": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "_id",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "_owner",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "_addr",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "_goal",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "_balance",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "_deadline",
            "type": "uint256"
          }
        ],
        "name": "createProjectDone",
        "type": "event"
      },
      "0x23f24e66b18d4317888ed4ba2ecd906f2ecef71d38b208dffeaa39bd42276d15": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "_addr",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "_contributor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "_contribution",
            "type": "uint256"
          }
        ],
        "name": "contributeProjectDone",
        "type": "event"
      },
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
      },
      "0x9316279f9aef5e79009e014b560910949b6db301bd553a42dcad21815a474cab": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "funding_project_address",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "funding_project_goal",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "funding_project_deadline",
            "type": "uint256"
          }
        ],
        "name": "proj_created_event",
        "type": "event"
      },
      "0x9d1524e96a43e681c32903b13a998b424cadaf54a52b47421357ba439c9fd207": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "funding_project_contributor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "project",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "funding_project_contribution",
            "type": "uint256"
          }
        ],
        "name": "proj_contribution_event",
        "type": "event"
      },
      "0x3c41d33ccb4fcfac569448e9c19055f678a8f980ddf34dfaad3c8538a8764d36": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "funding_project_owner",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "funding_project_address",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "funding_project_goal",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "funding_project_deadline",
            "type": "uint256"
          }
        ],
        "name": "proj_created_event",
        "type": "event"
      }
    },
    "updated_at": 1482611513015,
    "links": {},
    "address": "0xfca21572f8a0cb6cdbede8521fbd807b7b2d5991"
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
