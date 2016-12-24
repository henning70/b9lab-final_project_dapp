/*contract('Project', function(accounts) {
  it("should assert true", function(done) {
    var project = Project.at(Project.deployed);
    var acc_bal_bef = web3.eth.getBalance(web3.eth.accounts[1]);
    return project.refund(web3.eth.accounts[1], 1000000000000000000).then(function(value) {
        assert.equal(web3.eth.getBalance(web3.eth.accounts[1]), web3.eth.getBalance(web3.eth.accounts[1]) - acc_bal_bef, "Sent OK");
        done();
    });
  });
});*/

contract('Project', function(accounts) {
  it("Should perform a refund", function(done) {
    //var p = Project.deployed;

    var acc1 = accounts[1];
    var acc2 = accounts[2];

    var proj_owner = acc1;
    var proj_goal = 1000000000000000000;
    var proj_deadline = new Date("2016-12-20 23:00:00.000").getTime() / 1000;

    var proj_contributor = acc2;
    var proj_contribution = 1000000000000000000;

    var project_owner;
    var project_address;
    var project_goal;
    var project_raised;
    var project_deadline;
    var project_balance;

    // deploy new project contract with outdated deadline
    Project.new(proj_owner, proj_goal, proj_deadline, { from: web3.eth.coinbase, gas: 1000000 }).then(
      function(project) {
        project_balance = web3.eth.getBalance(project.address);
        console.log("Project address: " + project.address + ", Project balance: " + project_balance);
        
        // get deployed project details
        return project.getProject.call().then(function(value) {
          var project_data = value.valueOf();
          
          project_owner = project_data[0];
          project_goal = project_data[1];
          project_raised = project_data[2];
          project_deadline = new Date(project_data[3] * 1000).toString();
          project_active = project_data[4];
          console.log("getProject- owner: " + project_owner + ", goal: " + project_goal + ", raised: " + project_raised + ", deadline: " + proj_deadline + ", active: " + project_active);
        }).then(function() {
          
          // add some wei to contract
          web3.eth.sendTransaction({ from: web3.eth.coinbase, to: project.address, value: web3.toWei(1, "ether"), gas: 500000 });
            project_balance = web3.eth.getBalance(project.address);
            acc1_balance = web3.eth.getBalance(acc1);
            acc2_balance = web3.eth.getBalance(acc2);

            console.log("After add wei- acc1: " + acc1_balance + ", acc2: " + acc2_balance);
        }).then(function() {
          
          // send funds to project to trigger refund
          project.fund(proj_contributor, proj_contribution, { from: proj_contributor, gas: 500000 }).then(function(value) {
            project_balance = web3.eth.getBalance(project.address);
            acc1_balance = web3.eth.getBalance(acc1);
            acc2_balance = web3.eth.getBalance(acc2);

            console.log("Fund: project- project: " + project_balance + ", acc1: " + acc1_balance + ", acc2: " + acc2_balance);
          });
        }).then(function() {
          done();
          //return project.fund().then(function() {
          //});
        });
        project.refund(acc2, contribution).then( 
          function(transaction) {
            var acc2_bal = web3.eth.getBalance(acc2).toNumber();
            assert.equal(contribution + acc2_bal, acc2_bal + 1000000000000000000, "Refund not successful!"); 
          }).then( function() {
            done();
          }).catch(done);
      }).catch(done);
  });
});