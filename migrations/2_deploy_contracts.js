module.exports = function(deployer) {
  deployer.autolink();
  deployer.deploy(Project);
  deployer.deploy(FundingHub).then(function() {
  	FHcontract = FundingHub.deployed();
  	return FHcontract.createProject(1000000000000000000, 1485817200, {from: web3.eth.coinbase, gas: 1000000}).then(function(value) {
  		console.log(value);
  		// send some ethers to the newly created contract else the contract cannot perform sends etc.
  		return FHcontract.getProjectDetails.call(1).then(function(value) {
  			console.log(value);
  			var txn = web3.eth.sendTransaction({ from: web3.eth.coinbase, to: value.valueOf()[1], value: web3.toWei(1, "ether"), gas: 500000 });
  		});
  	});
  });
};
