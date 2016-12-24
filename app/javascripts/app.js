// some defauls from truffle
var accounts;
var account;
var balance;

// custom stuff
var FHcontract;
var FHcontract_addr;

function _getBalance() {
  console.log("_getBalance");
  var proj_contributor = document.getElementById("proj_contributor").value;
  var to_addr = document.getElementById("to_addr").value;
  var amount = document.getElementById("contribution").value;

  console.log("Contract Balance: " + web3.eth.getBalance(proj_contributor));

  for (i = 0; i < accounts.length; i++) {
    console.log("Account " + web3.eth.accounts[i] + ": " + web3.eth.getBalance(web3.eth.accounts[i]));
  }
}

function getProject() {
  if (!project) {
    var project = Project.at(document.getElementById("project_address").innerText);
    project.getProject.call().then(function(value) {
      console.log("getProject: " + value.valueOf());
      var project_data = value.valueOf();
      if (project_data[4] == false) { document.getElementById("project_status").innerHTML = "Ended"; }
      else { document.getElementById("project_status").innerHTML = "Active"; }
    });
  }
}

function _contributeProject() {
  var proj_contributor = document.getElementById("proj_contributor").value;
  var to_addr = document.getElementById("to_addr").value;
  var amount = document.getElementById("contribution").value;
  var prjid = document.getElementById("project_id");
  var project_id = prjid.options[prjid.selectedIndex].text;

  //var fundingProject = Project.at(to_addr);

  if (!project) {
    var project = Project.at(to_addr);
    project.allEvents(function (error, result) { 
      if (error) {
        console.log("Error: ");
        console.log(error);
      } else {
        if (result.event == "payoutEvent") { console.log("payoutEvent: " + result.event + " / " + result.args.proj_owner + " / " + result.args.proj_balance); }
        if (result.event == "doPayoutEvent") { console.log("doPayoutEvent: " + result.event + " / " + result.args.proj_owner + " / " + result.args.proj_balance); }
        if (result.event == "refundEvent") { console.log("refundEvent: " + result.event + " / " + result.args.contributor_address + " / " + result.args.contribution_amount); }
        if (result.event == "doDeadlineEvent") { console.log("doDeadlineEvent: " + result.event + " / " + result.args.contributor_address + " / " + result.args.contribution_amount); }
        if (result.event == "doContributionEvent") { console.log("doContributionEvent: " + result.event + " / " + result.args.proj_balance); }
        //else console.log("Event: " + result.event); // result.event, result.args.<arg>
        //console.log(result);
      }
    });
  }

  console.log("Contribute: " + project_id + "/" + proj_contributor + "/" + amount);

  FHcontract.contribute(project_id, proj_contributor, amount, {from: proj_contributor, gas: 1000000}).then(function(value) {
    console.log("Contribute: " + project_id + ", " + value.valueOf());
  });
  
  var txn = web3.eth.sendTransaction({ from: proj_contributor, to: to_addr, value: amount, gas: 1000000 });
  _getTransactionReceiptMined(txn, 500);
}

function _createProject() {
  var proj_owner = document.getElementById("proj_owner").value;
  var proj_goal = document.getElementById("proj_goal").value;
  var proj_deadline = new Date(document.getElementById("proj_deadline").value).getTime() / 1000;

  console.log("To Raise/Deadline: " + proj_goal + ", " + proj_deadline);

  document.getElementById("status").innerHTML = "Project creation in progress!";
  FHcontract.createProject(proj_goal, proj_deadline, {from: proj_owner, gas: 1000000}).then(function(value) {
    console.log(value.valueOf());
    console.log(web3.eth.getTransactionReceipt(value));
    document.getElementById("status").innerHTML = "Project created!";

  }).catch(function(e) {
      document.getElementById("status").innerHTML = e;
      console.log(e);
  }).then(function() { _getProjectCount(); });
};

function _getProjectCount() {
  FHcontract.getProjectCount.call().then(function(value) {
    document.getElementById("projectNumber").innerHTML = value;
    console.log("Number of contracts: " + value.toNumber());
  });
  web3.eth.getAccounts(function(err, accs) {
    if (err != null) {
      alert("There was an error fetching your accounts.");
      return;
    }

    if (accs.length == 0) {
      alert("Couldn't get any accounts! Make sure your Ethereum client is configured correctly.");
      return;
    }

    accounts = accs;
    account = accounts[0];

    console.log("All accounts: ");
    console.log(accounts);
    
    // only remove if options exist
    if ((document.getElementById("proj_owner").options).length > 0) {
      var e1 = document.getElementById("proj_owner").options.length = 0;
    }
    if ((document.getElementById("proj_contributor").options).length > 0) {
      var e1 = document.getElementById("proj_contributor").options.length = 0;
    }

    for (i = 0; i < accounts.length; i++) {
      console.log("Account " + web3.eth.accounts[i] + ": " + web3.eth.getBalance(web3.eth.accounts[i]));
      var _accounts = document.getElementById("proj_owner");
      var _options = document.createElement("option");
      _accounts.options.add(_options);
      _options.text = web3.eth.accounts[i];
      document.getElementById("proj_owner_balance").innerHTML = "Balance: " + web3.eth.getBalance(web3.eth.accounts[i]);

      var _accounts = document.getElementById("proj_contributor");
      var _options = document.createElement("option");
      _accounts.options.add(_options);
      _options.text = web3.eth.accounts[i];
      document.getElementById("proj_contributor_balance").innerHTML = "Balance: " + web3.eth.getBalance(web3.eth.accounts[i]);
    }

  });
  _getAllProjects();
};

function _getProject() {
  var prjid = document.getElementById("project_id");
  var prjnum = prjid.options[prjid.selectedIndex].text;
  FHcontract.getProjectDetails.call(prjnum).then(function(value) {
    console.log(value.valueOf());
    document.getElementById("project_owner").innerHTML = value.valueOf()[0];
    document.getElementById("project_address").innerHTML = value.valueOf()[1];
    document.getElementById("project_goal").innerHTML = value.valueOf()[2].c[0];
    document.getElementById("project_raised").innerHTML = value.valueOf()[3].c[0];
    document.getElementById("project_deadline").innerHTML = new Date(value.valueOf()[4].c[0] * 1000).toString();
  }).then(function() { 
    getProject();
    document.getElementById("project_balance").innerHTML = web3.eth.getBalance(document.getElementById("project_address").innerText);
  });
};

function _getAllProjects() {
  FHcontract.getProjectCount.call().then(function(value) {
    document.getElementById("projectNumber").innerHTML = value;
    console.log("Number of contracts: " + value.toNumber());
    
    // only remove if options exist
    if ((document.getElementById("project_id").options).length > 0) {
      var e1 = document.getElementById("project_id").options.length = 0;
    }

    var total_projects = value.toNumber();
    for (var i = 1; i <= total_projects; i++) {
      var _project = document.getElementById("project_id");
      var _options = document.createElement("option");
      _project.options.add(_options);
      _options.text = i;    
    };
    _getProject();
  });
};

function _getTransactionReceiptMined(txn, interval) {
    var transactionReceiptAsync;
    interval |= 500;
    transactionReceiptAsync = function(txn, resolve, reject) {
      try {
        document.getElementById("status").innerHTML = "Busy...";
        var receipt = web3.eth.getTransactionReceipt(txn);
        if (receipt == null) {
            setTimeout(function () {
              transactionReceiptAsync(txn, resolve, reject);
            }, interval);
        } else {
          document.getElementById("status").innerHTML = "Done!";
          //_getBalance();
          _getAllProjects();
          resolve(receipt);
        }
      } catch(e) {
          reject(e);
      }
    };

    return new Promise(function (resolve, reject) {
      transactionReceiptAsync(txn, resolve, reject);
    });
};

function _updateBalance(do_update) {
  if (do_update == "proj_owner") {
    var _account = document.getElementById("proj_owner");
    var _account = _account.options[_account.selectedIndex].text;
    document.getElementById("proj_owner_balance").innerHTML = "Balance: " + web3.eth.getBalance(_account);
  }
  if (do_update == "proj_contributor") {
    var _account = document.getElementById("proj_contributor");
    var _account = _account.options[_account.selectedIndex].text;
    document.getElementById("proj_contributor_balance").innerHTML = "Balance: " + web3.eth.getBalance(_account);
  }
}

window.onload = function() {
  FHcontract = FundingHub.deployed();
  FHcontract_addr = FHcontract.address;

  FHcontract.allEvents(function (error, result) { 
    if (error) {
      console.log("Error: ");
      console.log(error);
    } else {
      if (result.event == "proj_created_event") { console.log("proj_created_event: " + result.event + " / " + result.args.funding_project_owner + " / " + result.args.funding_project_address + " / " + result.args.funding_project_goal + " / " + result.args.funding_project_deadline); }
    }
  });

  FHcontract.getProjectCount.call().then(function(value) {
    document.getElementById("projectNumber").innerHTML = value;
    console.log("Number of contracts: " + value.toNumber());
  });

  console.log(FHcontract);
  console.log(FHcontract_addr);

  web3.eth.getAccounts(function(err, accs) {
    if (err != null) {
      alert("There was an error fetching your accounts.");
      return;
    }

    if (accs.length == 0) {
      alert("Couldn't get any accounts! Make sure your Ethereum client is configured correctly.");
      return;
    }

    accounts = accs;
    account = accounts[0];

    console.log("All accounts: ");
    console.log(accounts);

    for (i = 0; i < accounts.length; i++) {
      console.log("Account " + web3.eth.accounts[i] + ": " + web3.eth.getBalance(web3.eth.accounts[i]));
      var _accounts = document.getElementById("proj_owner");
      var _options = document.createElement("option");
      _accounts.options.add(_options);
      _options.text = web3.eth.accounts[i];
      document.getElementById("proj_owner_balance").innerHTML = "Balance: " + web3.eth.getBalance(web3.eth.accounts[i]);

      var _accounts = document.getElementById("proj_contributor");
      var _options = document.createElement("option");
      _accounts.options.add(_options);
      _options.text = web3.eth.accounts[i];
      document.getElementById("proj_contributor_balance").innerHTML = "Balance: " + web3.eth.getBalance(web3.eth.accounts[i]);
    }

  });
  _getAllProjects();
}
